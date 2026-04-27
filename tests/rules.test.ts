import { describe, expect, it } from "vitest";
import {
  arbitrageOpportunityKey,
  arbitrageOrderProposals,
  discoverMarkets,
  findArbitrageOpportunity
} from "../src/rules.js";
import type { ArbitragePairRule, MarketDiscoveryRule } from "../src/types.js";

describe("rules", () => {
  it("finds complement arbitrage when two asks sum below $1", async () => {
    const rule: ArbitragePairRule = {
      name: "tennis example",
      enabled: true,
      category: "tennis",
      maxCombinedPriceCents: 99,
      minProfitCents: 1,
      minSize: 1,
      maxContracts: 3,
      execute: false,
      acknowledgeSequentialExecutionRisk: false,
      legA: { ticker: "TENNIS-A-WINS", side: "yes" },
      legB: { ticker: "TENNIS-B-WINS", side: "yes" },
      notes: ""
    };
    const client = {
      async getBestAsk(ticker: string) {
        return ticker === "TENNIS-A-WINS"
          ? { ticker, side: "yes" as const, priceCents: 47, size: 10 }
          : { ticker, side: "yes" as const, priceCents: 48, size: 2 };
      },
      async getMarkets() {
        return { markets: [] };
      }
    };

    const opportunity = await findArbitrageOpportunity(client, rule);

    expect(opportunity?.combinedPriceCents).toBe(95);
    expect(opportunity?.profitCents).toBe(5);
    expect(opportunity?.size).toBe(2);
    expect(arbitrageOpportunityKey(opportunity!)).toContain("tennis example");
  });

  it("turns an opportunity into two limit order proposals", async () => {
    const opportunity = {
      ruleName: "tennis example",
      legA: { ticker: "TENNIS-A-WINS", side: "yes" as const, priceCents: 47, size: 10 },
      legB: { ticker: "TENNIS-B-WINS", side: "yes" as const, priceCents: 48, size: 2 },
      combinedPriceCents: 95,
      profitCents: 5,
      size: 2
    };

    const [left, right] = arbitrageOrderProposals(opportunity);

    expect(left).toMatchObject({
      kalshiTicker: "TENNIS-A-WINS",
      side: "yes",
      count: 2,
      yesPrice: 47
    });
    expect(right).toMatchObject({
      kalshiTicker: "TENNIS-B-WINS",
      side: "yes",
      count: 2,
      yesPrice: 48
    });
  });

  it("filters discovered markets by keyword", async () => {
    const rule: MarketDiscoveryRule = {
      name: "tennis",
      enabled: true,
      includeKeywords: ["tennis"],
      excludeKeywords: ["closed"],
      status: "open",
      limit: 100
    };
    const client = {
      async getBestAsk() {
        return undefined;
      },
      async getMarkets() {
        return {
          markets: [
            { ticker: "TENNIS-MATCH", title: "Tennis: Player A vs Player B" },
            { ticker: "NBA-GAME", title: "Basketball game" }
          ]
        };
      }
    };

    await expect(discoverMarkets(client, rule)).resolves.toEqual([
      { ticker: "TENNIS-MATCH", title: "Tennis: Player A vs Player B" }
    ]);
  });
});
