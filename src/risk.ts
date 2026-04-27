import { createHash } from "node:crypto";
import type { MarketMapping, OrderProposal, RiskConfig, TradeSignal } from "./types.js";

export class SignalRejected extends Error {}

export function buildProposal(args: {
  signal: TradeSignal;
  mapping: MarketMapping;
  risk: RiskConfig;
  nowSeconds?: number;
}): OrderProposal {
  const { signal, mapping, risk } = args;
  const nowSeconds = args.nowSeconds ?? Math.floor(Date.now() / 1000);

  if (!risk.allowedSides.includes(signal.side)) {
    throw new SignalRejected(`source side ${signal.side} is not allowed`);
  }
  if (signal.size < risk.minSourceTradeSize) {
    throw new SignalRejected(`source trade size ${signal.size} below minimum`);
  }
  if (nowSeconds - signal.timestamp > risk.maxSourceTradeAgeSeconds) {
    throw new SignalRejected("source trade is stale");
  }

  const targetSide = mapping.outcomeMap[signal.outcome];
  if (!targetSide) {
    throw new SignalRejected(`outcome ${signal.outcome} is not mapped`);
  }

  const sourceCents = probabilityToCents(signal.price);
  const limitCents = clamp(sourceCents - risk.priceImprovementCents, 1, 99);
  let count = Math.min(risk.maxContractsPerOrder, Math.floor(signal.size));
  if (count < 1) throw new SignalRejected("computed order count is below 1");

  if (count * limitCents > risk.maxNotionalCentsPerOrder) {
    count = Math.floor(risk.maxNotionalCentsPerOrder / limitCents);
  }
  if (count < 1 || count * limitCents > risk.maxNotionalCentsPerOrder) {
    throw new SignalRejected("order exceeds max notional after sizing");
  }

  const clientOrderId = `pkpa-${stableId(idempotencyKey(signal))}`;
  return {
    sourceSignal: signal,
    kalshiTicker: mapping.kalshiTicker,
    action: "buy",
    side: targetSide,
    count,
    ...(targetSide === "yes" ? { yesPrice: limitCents } : { noPrice: limitCents }),
    clientOrderId
  };
}

export function idempotencyKey(signal: TradeSignal): string {
  return `${signal.transactionHash}:${signal.conditionId}:${signal.outcome}:${signal.side}`;
}

export function probabilityToCents(price: number): number {
  const cents = price > 1 ? Math.round(price) : Math.round(price * 100);
  return clamp(cents, 1, 99);
}

function stableId(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 32);
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
