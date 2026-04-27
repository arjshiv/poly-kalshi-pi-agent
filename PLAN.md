# Plan

## Goal

Run a small TypeScript agent on a MacBook or VPS that reads public Polymarket data and optionally places tightly gated Kalshi limit orders.

## Boundaries

- Polymarket is read-only.
- No VPN/geofence bypass.
- Kalshi is the only execution venue.
- Live orders require deterministic config plus the explicit `LIVE_TRADING_ENABLED=true` env gate.
- Pi/OpenClaw supervises operation and config review; it does not invent markets or bypass risk controls.
- Rule-based scanners are allowed when every executable rule is deterministic and configured explicitly.

## Flow

1. Poll watcher wallet trades from Polymarket Data API.
2. Filter trades to manually mapped condition IDs.
3. Reject stale, undersized, unmapped, or disallowed-side signals.
4. Convert accepted signals to Kalshi limit-order proposals.
5. Enforce max contracts, max notional, max orders per cycle, and price improvement.
6. Log dry-run proposals or submit live orders to Kalshi.
7. Record source transaction idempotency keys in local state to prevent duplicate orders.
8. Exit cleanly when configured stop conditions are met.

## Rule Flow

1. Optionally discover open Kalshi markets matching keywords such as `tennis`.
2. Manually configure exact complementary pairs.
3. Read current Kalshi orderbooks.
4. Convert opposing bids into executable asks.
5. Alert when configured asks sum below 100 cents after thresholds.
6. Execute only if the pair has `execute: true`, sequential execution risk is acknowledged, and the global live gates are enabled.

## Market Mapping Rule

Every active market mapping must be manually checked before enabling:

- Same event.
- Same cutoff time and timezone.
- Same settlement source.
- Same treatment of ambiguity, cancellation, recounts, revisions, and edge cases.
- Enough Kalshi liquidity for limit-order execution.

## First Run

```bash
cd ~/GitHub/poly-kalshi-pi-agent
./scripts/one-touch.sh
pnpm dev supervise --config config/local.yaml
pnpm dev once --config config/local.yaml
```

## Pi Operator Loop

Use `.pi/prompts/operator.md` with OpenClaw/Pi to:

- Check process health.
- Tail `logs/agent.log`.
- Review dry-run proposals.
- Suggest mapping changes.
- Stop the process on unexpected rejects, duplicate behavior, or position growth.
