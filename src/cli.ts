#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { CopySignalAgent } from "./agent.js";
import { loadSettings } from "./settings.js";

type Command = "check" | "once" | "run";

async function main(): Promise<void> {
  const { command, configPath } = parseArgs(process.argv.slice(2));
  const config = await loadConfig(configPath);
  const settings = loadSettings();
  const agent = new CopySignalAgent(config, settings);

  if (command === "check") {
    await agent.check();
    console.log(
      JSON.stringify(
        {
          ok: true,
          kalshiEnv: settings.kalshiEnv,
          enabledMarkets: config.markets.filter((market) => market.enabled).length,
          dryRun: config.risk.dryRun,
          liveEnvGate: settings.liveTradingEnabled
        },
        null,
        2
      )
    );
    return;
  }

  if (command === "once") {
    const submitted = await agent.runOnce();
    console.log(JSON.stringify({ ok: true, proposedOrSubmittedOrders: submitted }, null, 2));
    return;
  }

  await agent.check();
  await agent.runForever();
}

function parseArgs(args: string[]): { command: Command; configPath: string } {
  const command = args[0];
  if (command !== "check" && command !== "once" && command !== "run") {
    throw new Error("usage: poly-kalshi-agent <check|once|run> --config config/local.yaml");
  }

  const configFlagIndex = args.indexOf("--config");
  const configPath = configFlagIndex >= 0 ? args[configFlagIndex + 1] : "config/local.yaml";
  if (!configPath) throw new Error("--config requires a path");
  return { command, configPath };
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
