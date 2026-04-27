#!/usr/bin/env node
import { loadConfig } from "./config.js";
import { CopySignalAgent } from "./agent.js";
import { loadSettings } from "./settings.js";
import {
  onboard,
  clearStopFile,
  readOnboardingSummary,
  writePiSupervisorPrompt,
  writeServiceFile
} from "./onboard.js";

type Command =
  | "check"
  | "once"
  | "run"
  | "onboard"
  | "supervise"
  | "install-service"
  | "write-pi-prompt"
  | "clear-stop";

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const { command, configPath } = parsedArgs;
  const settings = loadSettings();

  if (command === "onboard") {
    const result = await onboard(configPath, settings);
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.blockers.length > 0 ? 2 : 0;
    return;
  }

  if (command === "write-pi-prompt") {
    const path = await writePiSupervisorPrompt(configPath);
    console.log(JSON.stringify({ ok: true, path }, null, 2));
    return;
  }

  if (command === "clear-stop") {
    const result = await clearStopFile(configPath);
    console.log(JSON.stringify({ ok: true, ...result }, null, 2));
    return;
  }

  if (command === "install-service") {
    const target = parsedArgs.target ?? (process.platform === "darwin" ? "launchd" : "systemd");
    const path = await writeServiceFile({ target, configPath });
    console.log(JSON.stringify({ ok: true, target, path, next: serviceNextSteps(target, path) }, null, 2));
    return;
  }

  if (command === "supervise") {
    const result = await onboard(configPath, settings);
    const promptPath = await writePiSupervisorPrompt(configPath);
    const summary = await readOnboardingSummary(configPath);
    console.log(JSON.stringify({ ...result, promptPath, summary }, null, 2));
    process.exitCode = result.blockers.length > 0 ? 2 : 0;
    return;
  }

  const config = await loadConfig(configPath);
  const agent = new CopySignalAgent(config, settings);

  if (command === "check") {
    await agent.check();
    console.log(
      JSON.stringify(
        {
          ok: true,
          kalshiEnv: settings.kalshiEnv,
          enabledMarkets: config.markets.filter((market) => market.enabled).length,
          enabledArbitrageRules: config.rules.arbitragePairs.filter((rule) => rule.enabled).length,
          enabledDiscoveryRules: config.rules.marketDiscovery.filter((rule) => rule.enabled).length,
          stop: config.stop,
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

function parseArgs(args: string[]): {
  command: Command;
  configPath: string;
  target?: "launchd" | "systemd";
} {
  const command = args[0];
  if (
    command !== "check" &&
    command !== "once" &&
    command !== "run" &&
    command !== "onboard" &&
    command !== "supervise" &&
    command !== "install-service" &&
    command !== "write-pi-prompt" &&
    command !== "clear-stop"
  ) {
    throw new Error(
      "usage: poly-kalshi-agent <onboard|supervise|check|once|run|clear-stop|install-service|write-pi-prompt> --config config/local.yaml"
    );
  }

  const configFlagIndex = args.indexOf("--config");
  const configPath = configFlagIndex >= 0 ? args[configFlagIndex + 1] : "config/local.yaml";
  if (!configPath) throw new Error("--config requires a path");
  const targetFlagIndex = args.indexOf("--target");
  const rawTarget = targetFlagIndex >= 0 ? args[targetFlagIndex + 1] : undefined;
  const target = rawTarget === "launchd" || rawTarget === "systemd" ? rawTarget : undefined;
  return { command, configPath, ...(target ? { target } : {}) };
}

function serviceNextSteps(target: "launchd" | "systemd", path: string): string[] {
  if (target === "launchd") {
    return [
      `launchctl load ${path}`,
      "launchctl start ai.openclaw.poly-kalshi-pi-agent",
      "launchctl stop ai.openclaw.poly-kalshi-pi-agent"
    ];
  }
  return [
    "systemctl --user daemon-reload",
    "systemctl --user enable --now poly-kalshi-pi-agent.service",
    "systemctl --user status poly-kalshi-pi-agent.service"
  ];
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.stack : error);
  process.exitCode = 1;
});
