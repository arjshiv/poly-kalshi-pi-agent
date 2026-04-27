# Poly Kalshi Pi Agent

Small, safe-by-default agent for using public/read-only Polymarket trades as a signal and placing matching limit orders on Kalshi.

This does **not** trade on Polymarket and does not attempt to bypass Polymarket geographic restrictions. Polymarket is treated as an external public data source. Kalshi is the execution venue.

## What It Does

- Polls Polymarket `data-api.polymarket.com/trades` for configured watcher wallets and mapped markets.
- Converts matching Polymarket `BUY Yes/No` signals into Kalshi limit-order proposals.
- Applies risk gates before any order is created.
- Runs in dry-run mode by default.
- Places Kalshi orders only when both config `risk.dry_run: false` and env `LIVE_TRADING_ENABLED=true` are set.
- Keeps a local seen-trade state file to avoid duplicate orders.

## Setup

```bash
cd ~/GitHub/poly-kalshi-pi-agent
pnpm install
cp .env.example .env
cp config/example.yaml config/local.yaml
```

Edit `config/local.yaml`:

- Add watcher wallet addresses.
- Add exact market mappings.
- Keep `enabled: false` until you manually verify resolution rules.
- Keep `risk.dry_run: true` while testing.

Edit `.env`:

- Set `KALSHI_ENV=demo` first.
- Add `KALSHI_API_KEY_ID`.
- Set `KALSHI_PRIVATE_KEY_PATH=/absolute/path/to/kalshi.key`.

## Commands

```bash
pnpm dev check --config config/local.yaml
pnpm dev once --config config/local.yaml
pnpm dev run --config config/local.yaml
```

`check` validates config and Kalshi auth configuration without placing orders.

`once` runs one polling cycle.

`run` loops forever and is suitable for a MacBook, VPS, or `systemd` user service.

## Live Trading Gate

Live order placement requires both:

```yaml
risk:
  dry_run: false
```

and:

```bash
LIVE_TRADING_ENABLED=true
```

This double gate is deliberate.

## Pi / OpenClaw Use

The `.pi/prompts/operator.md` prompt tells a Pi/OpenClaw agent how to operate this repo. Use it for supervision, logs, config review, and dry-run analysis. Do not let an LLM freely choose markets or place trades without deterministic config and risk limits.

## Deployment Sketch

For a VPS:

```bash
cd ~/GitHub/poly-kalshi-pi-agent
pnpm install --prod
pnpm build
node dist/cli.js run --config config/local.yaml
```

For `systemd`, run the same command from a user service and store `.env`, `config/local.yaml`, and the Kalshi private key with user-only permissions.
