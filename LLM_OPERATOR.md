# LLM Operator Guide

This repo is designed so an LLM coding agent can set up and supervise the bot without becoming the trading engine.

Use this guide with Codex, Claude Code, OpenClaw/Pi, or any tool-capable agent.

## Mental Model

```text
LLM agent = operator
this repo = deterministic trading system
launchd/systemd = process keeper
Kalshi = execution venue
Polymarket = read-only signal/data source
```

The LLM should run commands, inspect logs, review config, and stop the process when needed. It should not directly call Kalshi order APIs or invent live trades from chat context.

## First Instruction To Give An LLM

```text
You are operating this repo as a deterministic Kalshi trading agent. Read README.md and LLM_OPERATOR.md first. Keep Polymarket read-only. Do not enable live trading, execute=true, or risk.dry_run=false unless I explicitly ask. Use the repo commands only: onboard, supervise, check, once, run, clear-stop, and install-service. If anything looks unsafe, stop the loop with state/STOP and report.
```

## One-Touch Setup

The agent should run:

```bash
./scripts/one-touch.sh
```

Then it should ask the human to fill `.env` if credentials are missing:

```bash
KALSHI_ENV=demo
KALSHI_API_KEY_ID=...
KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/key.pem
LIVE_TRADING_ENABLED=false
```

Secrets stay in `.env`, which is ignored by git.

## Every-Time Preflight

Before any run:

```bash
pnpm dev supervise --config config/local.yaml
pnpm dev check --config config/local.yaml
```

If `supervise` reports blockers, do not run the bot. Fix the blockers or ask the human.

If a previous stop file exists:

```bash
pnpm dev clear-stop --config config/local.yaml
```

Only clear the stop file when the human wants a new run and the preflight is clean.

## Dry-Run Workflow

Use this for setup and testing:

```bash
pnpm dev once --config config/local.yaml
tail -n 200 logs/agent.log
```

Review:

- discovered market candidates
- arbitrage alerts
- rejected signals
- malformed config
- stale data
- duplicate behavior
- unexpected live-trading gates

## Continuous Run

Foreground:

```bash
pnpm dev run --config config/local.yaml
```

Mac service:

```bash
pnpm dev install-service --target launchd --config config/local.yaml
launchctl load ~/Library/LaunchAgents/ai.openclaw.poly-kalshi-pi-agent.plist
launchctl start ai.openclaw.poly-kalshi-pi-agent
```

VPS service:

```bash
pnpm dev install-service --target systemd --config config/local.yaml
systemctl --user daemon-reload
systemctl --user enable --now poly-kalshi-pi-agent.service
```

## Stop Procedure

To request a clean stop:

```bash
mkdir -p state
touch state/STOP
```

Then inspect logs:

```bash
tail -n 200 logs/agent.log
```

## What The LLM May Change

Allowed:

- `config/local.yaml`
- docs
- tests
- source code after explaining the reason

Be careful:

- `.env` can be created or checked for missing values, but never printed.
- `config/local.yaml` is ignored by git and can contain local strategy configuration.

Do not change without explicit human approval:

- `risk.dry_run: false`
- `LIVE_TRADING_ENABLED=true`
- `execute: true`
- `acknowledge_sequential_execution_risk: true`
- service installation on a VPS or Mac

## Live Trading Gates

Live order placement requires all relevant gates:

```yaml
risk:
  dry_run: false
```

```bash
LIVE_TRADING_ENABLED=true
```

For arbitrage rules:

```yaml
execute: true
acknowledge_sequential_execution_risk: true
```

The LLM must not enable these unless the human explicitly asks.

## Review Checklist

Before approving a market mapping or arbitrage rule:

- Same event.
- Same participants.
- Same settlement source.
- Same cutoff time and timezone.
- Exactly one complementary leg should settle to 100.
- Cancellation, retirement, walkover, void, recount, or tie edge cases are understood.
- Liquidity is enough for `max_contracts`.
- Sequential execution risk is understood for live arbitrage.
- Dry-run logs look sane.

## Verification

After edits:

```bash
pnpm check
pnpm test
pnpm lint
pnpm build
pnpm audit --audit-level moderate
pnpm dev check --config config/example.yaml
```

## Agent-Agnostic Use

This repo does not depend on Pi specifically. It can be operated by:

- Codex
- Claude Code
- OpenClaw/Pi
- Cursor agent
- a human shell session

The stable interface is the command set and the files in `logs/`, `state/`, `.env`, and `config/local.yaml`.
