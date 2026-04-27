import { access, copyFile, mkdir, rm, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { loadConfig } from "./config.js";
import type { AgentConfig } from "./types.js";
import type { Settings } from "./settings.js";

export type OnboardResult = {
  created: string[];
  warnings: string[];
  blockers: string[];
  nextSteps: string[];
};

export async function onboard(configPath: string, settings: Settings): Promise<OnboardResult> {
  const created: string[] = [];
  const warnings: string[] = [];
  const blockers: string[] = [];
  const nextSteps: string[] = [];

  if (!(await exists(".env"))) {
    await copyFile(".env.example", ".env");
    created.push(".env");
    warnings.push("Created .env from .env.example; fill in Kalshi credentials before live trading.");
  }

  if (!(await exists(configPath))) {
    await mkdir(dirname(configPath), { recursive: true });
    await copyFile("config/example.yaml", configPath);
    created.push(configPath);
    warnings.push(`Created ${configPath} from config/example.yaml; review every enabled rule.`);
  }

  await mkdir("logs", { recursive: true });
  await mkdir("state", { recursive: true });

  let config: AgentConfig | undefined;
  try {
    config = await loadConfig(configPath);
  } catch (error) {
    blockers.push(`Config does not parse: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (config) {
    const enabledMarkets = config.markets.filter((market) => market.enabled);
    const enabledArbRules = config.rules.arbitragePairs.filter((rule) => rule.enabled);
    const enabledDiscovery = config.rules.marketDiscovery.filter((rule) => rule.enabled);

    if (enabledMarkets.length === 0 && enabledArbRules.length === 0 && enabledDiscovery.length === 0) {
      warnings.push("No enabled markets or rules yet. Enable discovery or add explicit arbitrage pairs.");
    }

    if (config.stop.stopFile && (await exists(config.stop.stopFile))) {
      blockers.push(
        `Stop file ${config.stop.stopFile} exists; the run loop will exit immediately. Run pnpm dev clear-stop --config ${configPath} to clear it.`
      );
    }

    for (const rule of enabledArbRules) {
      if (!rule.notes || rule.notes.length < 20) {
        blockers.push(`Arbitrage rule "${rule.name}" needs notes proving the legs are complementary.`);
      }
      if (rule.execute && config.risk.dryRun) {
        warnings.push(`Rule "${rule.name}" has execute=true but global dry_run is still true.`);
      }
      if (rule.execute && !rule.acknowledgeSequentialExecutionRisk) {
        blockers.push(
          `Arbitrage rule "${rule.name}" has execute=true but acknowledge_sequential_execution_risk is not true. Pair execution is sequential and can leave one leg unhedged if the second order fails.`
        );
      }
    }

    if (!config.risk.dryRun || settings.liveTradingEnabled) {
      if (!settings.kalshiApiKeyId) blockers.push("KALSHI_API_KEY_ID is required for live/auth checks.");
      if (!settings.kalshiPrivateKeyPath && !settings.kalshiPrivateKeyPem) {
        blockers.push("Kalshi private key is required for live/auth checks.");
      }
      if (!settings.liveTradingEnabled) blockers.push("LIVE_TRADING_ENABLED=true is required for live orders.");
      if (config.risk.dryRun) blockers.push("risk.dry_run: false is required for live orders.");
    }
  }

  nextSteps.push(`pnpm dev check --config ${configPath}`);
  nextSteps.push(`pnpm dev once --config ${configPath}`);
  nextSteps.push(`pnpm dev supervise --config ${configPath}`);
  nextSteps.push(`pnpm dev clear-stop --config ${configPath}`);
  nextSteps.push(`pnpm dev install-service --target ${process.platform === "darwin" ? "launchd" : "systemd"} --config ${configPath}`);

  return { created, warnings, blockers, nextSteps };
}

export async function writePiSupervisorPrompt(configPath: string): Promise<string> {
  const path = ".pi/prompts/live-supervisor.md";
  const content = `# Live Supervisor

You are supervising poly-kalshi-pi-agent with Codex/Pi.

Config: \`${configPath}\`

Loop command:

\`\`\`bash
pnpm dev run --config ${configPath}
\`\`\`

Every review cycle:

1. Run \`pnpm dev check --config ${configPath}\`.
2. Read the last 200 lines of \`logs/agent.log\`.
3. Report detected opportunities, rejects, stops, and unexpected behavior.
4. Do not enable live trading or \`execute: true\` unless the human explicitly asks.
5. If risk looks wrong, run \`mkdir -p state && touch state/STOP\`.

Never directly call Kalshi order endpoints. The TypeScript agent is the only execution path.
`;
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content, "utf8");
  return path;
}

export async function writeServiceFile(args: {
  target: "launchd" | "systemd";
  configPath: string;
}): Promise<string> {
  const cwd = process.cwd();
  const tsx = resolve("node_modules/.bin/tsx");
  const command = `${tsx} ${resolve("src/cli.ts")} run --config ${resolve(args.configPath)}`;

  if (args.target === "launchd") {
    const label = "ai.openclaw.poly-kalshi-pi-agent";
    const launchdDir = process.env.PKPA_LAUNCHD_DIR ?? join(homedir(), "Library/LaunchAgents");
    const plistPath = join(launchdDir, `${label}.plist`);
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>${label}</string>
  <key>WorkingDirectory</key><string>${cwd}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${tsx}</string>
    <string>${resolve("src/cli.ts")}</string>
    <string>run</string>
    <string>--config</string>
    <string>${resolve(args.configPath)}</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>${resolve("logs/launchd.out.log")}</string>
  <key>StandardErrorPath</key><string>${resolve("logs/launchd.err.log")}</string>
  <key>EnvironmentVariables</key>
  <dict>
    <key>PATH</key><string>${process.env.PATH ?? ""}</string>
  </dict>
</dict>
</plist>
`;
    await mkdir(dirname(plistPath), { recursive: true });
    await writeFile(plistPath, plist, "utf8");
    return plistPath;
  }

  const systemdDir = process.env.PKPA_SYSTEMD_USER_DIR ?? join(homedir(), ".config/systemd/user");
  const servicePath = join(systemdDir, "poly-kalshi-pi-agent.service");
  const service = `[Unit]
Description=Poly Kalshi Pi Agent
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${cwd}
ExecStart=${command}
Restart=always
RestartSec=10
Environment=PATH=${process.env.PATH ?? ""}

[Install]
WantedBy=default.target
`;
  await mkdir(dirname(servicePath), { recursive: true });
  await writeFile(servicePath, service, "utf8");
  return servicePath;
}

export async function readOnboardingSummary(configPath: string): Promise<Record<string, unknown>> {
  const config = await loadConfig(configPath);
  return {
    configPath,
    pollIntervalSeconds: config.pollIntervalSeconds,
    stop: config.stop,
    dryRun: config.risk.dryRun,
    stopFileExists: config.stop.stopFile ? await exists(config.stop.stopFile) : false,
    enabledMarketMappings: config.markets.filter((market) => market.enabled).map((market) => market.name),
    enabledDiscoveryRules: config.rules.marketDiscovery.filter((rule) => rule.enabled).map((rule) => rule.name),
    enabledArbitrageRules: config.rules.arbitragePairs.filter((rule) => rule.enabled).map((rule) => ({
      name: rule.name,
      execute: rule.execute,
      legs: [rule.legA, rule.legB]
    }))
  };
}

export async function clearStopFile(configPath: string): Promise<{ stopFile?: string; removed: boolean }> {
  const config = await loadConfig(configPath);
  const stopFile = config.stop.stopFile;
  if (!stopFile) return { removed: false };
  const existed = await exists(stopFile);
  await rm(stopFile, { force: true });
  return { stopFile, removed: existed };
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
