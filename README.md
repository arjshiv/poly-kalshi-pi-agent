# Poly Kalshi Pi Agent

Small TypeScript agent for running compliant, safe-by-default Kalshi automation with Pi/OpenClaw supervision.

Polymarket is read-only signal/data input only. The agent does **not** trade on Polymarket and does not attempt to bypass Polymarket geographic restrictions. Kalshi is the execution venue.

## Architecture

```text
Kalshi + read-only Polymarket data
  -> deterministic TypeScript agent
  -> JSON logs + local state + risk gates
  -> optional Kalshi limit orders

Pi / OpenClaw / Codex
  -> supervises logs and config
  -> judges market mappings and rule sanity
  -> can stop the loop
  -> does not directly place orders

launchd / systemd / local shell
  -> keeps the TypeScript loop running
```

The LLM is deliberately outside the hot execution path. Use Pi/Codex to review candidates, spot bad assumptions, and operate the repo. The TypeScript code decides what is allowed to become an order.

## What It Does

- Polls Polymarket public trade data for configured watcher wallets and mapped markets.
- Converts matching Polymarket `BUY Yes/No` signals into Kalshi limit-order proposals.
- Discovers Kalshi markets by keyword, for example open tennis markets.
- Supports explicit arbitrage rules, for example two mutually exclusive tennis legs where executable asks sum below $1.
- Applies risk gates before any order is created.
- Runs in dry-run mode by default.
- Places Kalshi orders only when all live-trading gates are enabled.
- Keeps local state to avoid duplicate execution.
- Stops cleanly when configured stop conditions are met.
- Generates Pi/OpenClaw supervisor prompts.
- Installs launchd or systemd service files for always-on operation.

## First-Time Setup

```bash
cd ~/GitHub/poly-kalshi-pi-agent
./scripts/one-touch.sh
```

This installs dependencies, creates `.env` and `config/local.yaml` if missing, runs onboarding checks, and writes `.pi/prompts/live-supervisor.md`.

Then edit `.env`:

```bash
KALSHI_ENV=demo
KALSHI_API_KEY_ID=your_key_id
KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/kalshi-private-key.pem
LIVE_TRADING_ENABLED=false
```

Start in `demo` and dry-run mode.

## Every-Time Run Flow

Use this when you want to run the bot:

```bash
./scripts/onboard-run.sh
```

That runs onboarding/supervisor preflight first, then starts the continuous loop only if there are no blockers.

Equivalent manual flow:

```bash
pnpm dev supervise --config config/local.yaml
pnpm dev check --config config/local.yaml
pnpm dev once --config config/local.yaml
pnpm dev run --config config/local.yaml
```

## Commands

```bash
pnpm dev onboard --config config/local.yaml
pnpm dev supervise --config config/local.yaml
pnpm dev check --config config/local.yaml
pnpm dev once --config config/local.yaml
pnpm dev run --config config/local.yaml
pnpm dev write-pi-prompt --config config/local.yaml
pnpm dev clear-stop --config config/local.yaml
pnpm dev install-service --target launchd --config config/local.yaml
pnpm dev install-service --target systemd --config config/local.yaml
```

Command meanings:

- `onboard`: creates missing local files and reports blockers/warnings.
- `supervise`: runs onboarding checks, writes `.pi/prompts/live-supervisor.md`, and prints the active config summary.
- `check`: validates config and auth gates without placing orders.
- `once`: runs one polling/scanning cycle.
- `run`: loops continuously until stopped.
- `write-pi-prompt`: writes the Pi/OpenClaw live supervisor prompt.
- `clear-stop`: removes the configured stop file if a previous run was stopped.
- `install-service`: writes a launchd or systemd service file.

## Pi / OpenClaw / Codex Harness

Pi is the supervisor harness. The trading loop is still the TypeScript daemon.

Pi should do:

- Run `pnpm dev supervise --config config/local.yaml`.
- Tail `logs/agent.log`.
- Review discovered markets and arbitrage alerts.
- Judge whether two markets are truly complementary.
- Suggest config edits.
- Stop the loop with `touch state/STOP` when behavior looks wrong.

Pi should **not** do:

- Directly call Kalshi order endpoints.
- Override risk limits.
- Invent live market pairs without human review.
- Decide a sub-second order from an LLM response.

Useful Pi prompt files:

- `.pi/prompts/operator.md`
- `.pi/prompts/live-supervisor.md`
- `LLM_OPERATOR.md`

The agent does not need a separate LLM API key. Pi/OpenClaw can use your Codex/ChatGPT subscription to supervise the repo.

## LLM Operator Setup

You can point Codex, Claude Code, OpenClaw/Pi, Cursor, or another tool-capable LLM at this repo. The correct instruction is:

```text
Read README.md and LLM_OPERATOR.md. Use this repo as the operating surface for a deterministic Kalshi agent. Run onboarding/preflight first. Keep Polymarket read-only. Do not enable live trading, execute=true, risk.dry_run=false, or acknowledge_sequential_execution_risk=true unless I explicitly ask. If anything looks unsafe, stop the loop with state/STOP and report.
```

The LLM should use commands and files, not chat-state trading decisions:

```bash
./scripts/one-touch.sh
pnpm dev supervise --config config/local.yaml
pnpm dev check --config config/local.yaml
pnpm dev once --config config/local.yaml
tail -n 200 logs/agent.log
pnpm dev clear-stop --config config/local.yaml
pnpm dev run --config config/local.yaml
touch state/STOP
```

This is agent-agnostic. Pi is a minimalist supervisor option, but Claude Code or Codex can operate the same command surface.

## Continuous Operation

Local foreground loop:

```bash
pnpm dev run --config config/local.yaml
```

Mac always-on mode:

```bash
pnpm dev install-service --target launchd --config config/local.yaml
launchctl load ~/Library/LaunchAgents/ai.openclaw.poly-kalshi-pi-agent.plist
launchctl start ai.openclaw.poly-kalshi-pi-agent
```

Stop Mac service:

```bash
launchctl stop ai.openclaw.poly-kalshi-pi-agent
launchctl unload ~/Library/LaunchAgents/ai.openclaw.poly-kalshi-pi-agent.plist
```

VPS always-on mode:

```bash
pnpm dev install-service --target systemd --config config/local.yaml
systemctl --user daemon-reload
systemctl --user enable --now poly-kalshi-pi-agent.service
```

Check/stop VPS service:

```bash
systemctl --user status poly-kalshi-pi-agent.service
systemctl --user stop poly-kalshi-pi-agent.service
```

## Stop Conditions

By default, `run` loops continuously. Add any stop condition to `config/local.yaml`:

```yaml
stop:
  max_cycles: 100
  max_runtime_seconds: 3600
  max_submitted_orders: 2
  max_detected_opportunities: 5
  stop_file: state/STOP
```

Manual stop:

```bash
mkdir -p state
touch state/STOP
```

Clear a previous stop before starting again:

```bash
pnpm dev clear-stop --config config/local.yaml
```

The agent checks stop conditions between cycles and exits cleanly.

## Configuring Rules

Edit `config/local.yaml`. Keep `execute: false` while reviewing.

Discovery example:

```yaml
rules:
  market_discovery:
    - name: Find open tennis markets
      enabled: true
      include_keywords: ["tennis"]
      exclude_keywords: ["closed", "settled"]
      status: open
      limit: 100
```

Tennis complement arbitrage example:

```yaml
rules:
  arbitrage_pairs:
    - name: Tennis A/B moneyline
      enabled: true
      max_combined_price_cents: 99
      min_profit_cents: 1
      min_size: 1
      max_contracts: 1
      execute: false
      acknowledge_sequential_execution_risk: false
      leg_a:
        ticker: "TENNIS-PLAYERA-WINS"
        side: yes
      leg_b:
        ticker: "TENNIS-PLAYERB-WINS"
        side: yes
      notes: "Exactly one of these two YES contracts should settle to 100; manually verified rules and settlement source."
```

The rule detects:

```text
leg_a_yes_ask + leg_b_yes_ask < 100 cents
```

Only enable a pair after checking:

- Same event.
- Same participants.
- Same settlement source.
- Same cutoff time/timezone.
- Exactly one leg should settle to 100.
- No cancellation, retirement, walkover, void, or tie edge case breaks the complement.
- Enough orderbook size exists for your configured `max_contracts`.

## Polymarket Wallet-Copy Signals

Polymarket signals are read-only. Add watcher wallets and market mappings:

```yaml
watchers:
  - name: example-wallet
    polymarket_user: "0x0000000000000000000000000000000000000000"

markets:
  - name: Example manually verified mapping
    enabled: false
    polymarket_condition_id: "0x0000000000000000000000000000000000000000000000000000000000000000"
    kalshi_ticker: "EXAMPLE-26DEC31-Y"
    outcome_map:
      "Yes": "yes"
      "No": "no"
    notes: "Only enable after manually verifying the resolution criteria match."
```

Keep mappings disabled until resolution rules match exactly.

## Live Trading Gate

Live Kalshi order placement requires all relevant gates:

```yaml
risk:
  dry_run: false
```

```bash
LIVE_TRADING_ENABLED=true
```

For arbitrage rules:

```yaml
rules:
  arbitrage_pairs:
    - execute: true
      acknowledge_sequential_execution_risk: true
```

Arbitrage orders are currently submitted as two sequential Kalshi limit orders. That means live execution can leave one leg unhedged if the second order fails or the book moves. Keep `execute: false` unless you explicitly accept that operational risk.

For normal signal copy:

- The market mapping must be `enabled: true`.
- The signal must pass size, staleness, side, notional, and order-count limits.

This double/triple gate is deliberate. Dry-run should be the default operating mode.

## Logs And State

Important local files:

```text
logs/agent.log       JSON event log
state/seen_trades.json
state/STOP           optional stop file
config/local.yaml    local config, ignored by git
.env                 local secrets, ignored by git
```

Inspect logs:

```bash
tail -f logs/agent.log
```

## Recommended Operating Pattern

1. Run `./scripts/one-touch.sh`.
2. Fill `.env`.
3. Enable discovery rules only.
4. Run `pnpm dev once --config config/local.yaml`.
5. Review discovered markets.
6. Add explicit arbitrage pair rules with notes.
7. Keep `execute: false` and run dry-run.
8. Let Pi/Codex review `logs/agent.log` and config.
9. Only then consider `execute: true`, `risk.dry_run: false`, and `LIVE_TRADING_ENABLED=true`.
10. Keep `stop_file: state/STOP` configured.

## Safety Boundaries

- No Polymarket trading.
- No VPN/geofence bypass.
- No LLM-driven direct execution.
- No live trading without config and env gates.
- No market pair is safe until the settlement rules are manually checked.
- No service mode without log monitoring and a kill switch.

## Verification

```bash
pnpm check
pnpm test
pnpm lint
pnpm build
pnpm dev check --config config/example.yaml
```
