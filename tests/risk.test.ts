import { describe, expect, it } from "vitest";
import { buildProposal, probabilityToCents, SignalRejected } from "../src/risk.js";
import type { MarketMapping, RiskConfig, TradeSignal } from "../src/types.js";

const mapping: MarketMapping = {
  name: "test",
  enabled: true,
  polymarketConditionId: `0x${"a".repeat(64)}`,
  kalshiTicker: "TEST-26DEC31-Y",
  outcomeMap: { Yes: "yes" },
  notes: ""
};

const risk: RiskConfig = {
  dryRun: true,
  maxContractsPerOrder: 1,
  maxNotionalCentsPerOrder: 100,
  maxOrdersPerCycle: 2,
  minSourceTradeSize: 1,
  maxSourceTradeAgeSeconds: 180,
  priceImprovementCents: 1,
  allowedSides: ["BUY"]
};

const signal: TradeSignal = {
  proxyWallet: `0x${"b".repeat(40)}`,
  side: "BUY",
  conditionId: `0x${"a".repeat(64)}`,
  size: 10,
  price: 0.55,
  timestamp: 1_700_000_000,
  outcome: "Yes",
  transactionHash: "0xabc"
};

describe("risk", () => {
  it("normalizes probabilities to cents", () => {
    expect(probabilityToCents(0.52)).toBe(52);
    expect(probabilityToCents(52)).toBe(52);
    expect(probabilityToCents(0)).toBe(1);
    expect(probabilityToCents(1)).toBe(99);
  });

  it("builds a yes limit proposal with price improvement", () => {
    const proposal = buildProposal({
      signal,
      mapping,
      risk,
      nowSeconds: 1_700_000_010
    });

    expect(proposal.kalshiTicker).toBe("TEST-26DEC31-Y");
    expect(proposal.side).toBe("yes");
    expect(proposal.count).toBe(1);
    expect(proposal.yesPrice).toBe(54);
    expect(proposal.clientOrderId).toMatch(/^pkpa-/);
  });

  it("rejects stale signals", () => {
    expect(() =>
      buildProposal({
        signal,
        mapping,
        risk: { ...risk, maxSourceTradeAgeSeconds: 1 },
        nowSeconds: 1_700_000_100
      })
    ).toThrow(SignalRejected);
  });
});
