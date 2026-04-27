import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clearStopFile, onboard, writeServiceFile } from "../src/onboard.js";
import type { Settings } from "../src/settings.js";

let tempDirs: string[] = [];
let originalCwd: string;

const settings: Settings = {
  kalshiEnv: "demo",
  kalshiApiKeyId: undefined,
  kalshiPrivateKeyPath: undefined,
  kalshiPrivateKeyPem: undefined,
  liveTradingEnabled: false,
  polymarketDataBaseUrl: "https://data-api.polymarket.com",
  kalshiBaseUrl: "https://demo-api.kalshi.co/trade-api/v2",
  requestTimeoutMs: 1_000
};

beforeEach(() => {
  originalCwd = process.cwd();
});

afterEach(async () => {
  process.chdir(originalCwd);
  delete process.env.PKPA_LAUNCHD_DIR;
  delete process.env.PKPA_SYSTEMD_USER_DIR;
  await Promise.all(tempDirs.map((path) => rm(path, { recursive: true, force: true })));
  tempDirs = [];
});

describe("onboard", () => {
  it("blocks executable arbitrage rules without complement notes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pkpa-onboard-"));
    tempDirs.push(dir);
    process.chdir(dir);
    await writeFile(".env.example", "", "utf8");
    await writeFile(
      "config.yaml",
      `
poll_interval_seconds: 20
risk:
  dry_run: true
rules:
  arbitrage_pairs:
    - name: bad notes
      enabled: true
      execute: false
      leg_a:
        ticker: A
        side: yes
      leg_b:
        ticker: B
        side: yes
      notes: ""
`,
      "utf8"
    );

    const result = await onboard("config.yaml", settings);

    expect(result.blockers).toContain(
      'Arbitrage rule "bad notes" needs notes proving the legs are complementary.'
    );
  });

  it("blocks onboarding when the configured stop file already exists", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pkpa-onboard-"));
    tempDirs.push(dir);
    process.chdir(dir);
    await writeFile(".env.example", "", "utf8");
    await writeFile(
      "config.yaml",
      `
poll_interval_seconds: 20
stop:
  stop_file: state/STOP
`,
      "utf8"
    );
    await mkdir("state", { recursive: true });
    await writeFile("state/STOP", "", "utf8");

    const result = await onboard("config.yaml", settings);

    expect(result.blockers).toContain(
      "Stop file state/STOP exists; the run loop will exit immediately. Run pnpm dev clear-stop --config config.yaml to clear it."
    );
    await expect(clearStopFile("config.yaml")).resolves.toEqual({
      stopFile: "state/STOP",
      removed: true
    });
  });

  it("blocks executable arbitrage rules without sequential execution acknowledgment", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pkpa-onboard-"));
    tempDirs.push(dir);
    process.chdir(dir);
    await writeFile(".env.example", "", "utf8");
    await writeFile(
      "config.yaml",
      `
poll_interval_seconds: 20
risk:
  dry_run: true
rules:
  arbitrage_pairs:
    - name: sequential risk
      enabled: true
      execute: true
      acknowledge_sequential_execution_risk: false
      leg_a:
        ticker: A
        side: yes
      leg_b:
        ticker: B
        side: yes
      notes: "Exactly one side settles to yes based on verified rules."
`,
      "utf8"
    );

    const result = await onboard("config.yaml", settings);

    expect(result.blockers).toContain(
      'Arbitrage rule "sequential risk" has execute=true but acknowledge_sequential_execution_risk is not true. Pair execution is sequential and can leave one leg unhedged if the second order fails.'
    );
  });

  it("writes launchd service that executes tsx directly", async () => {
    const dir = await mkdtemp(join(tmpdir(), "pkpa-onboard-"));
    tempDirs.push(dir);
    process.chdir(dir);
    process.env.PKPA_LAUNCHD_DIR = join(dir, "LaunchAgents");

    const servicePath = await writeServiceFile({ target: "launchd", configPath: "config/local.yaml" });
    const plist = await readFile(servicePath, "utf8");

    expect(plist).toContain("<string>run</string>");
    expect(plist).toContain("node_modules/.bin/tsx");
    expect(plist).not.toContain(`<string>${process.execPath}</string>`);
  });
});
