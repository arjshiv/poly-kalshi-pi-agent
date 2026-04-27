import { createHash } from "node:crypto";
import type {
  ArbitrageOpportunity,
  ArbitragePairRule,
  KalshiMarket,
  MarketDiscoveryRule,
  OrderProposal
} from "./types.js";

export type RuleKalshiClient = {
  getBestAsk(
    ticker: string,
    side: "yes" | "no"
  ): Promise<{ ticker: string; side: "yes" | "no"; priceCents: number; size: number } | undefined>;
  getMarkets(params?: {
    status?: "unopened" | "open" | "paused" | "closed" | "settled";
    seriesTicker?: string;
    limit?: number;
  }): Promise<{ markets: KalshiMarket[]; cursor?: string }>;
};

export async function findArbitrageOpportunity(
  client: RuleKalshiClient,
  rule: ArbitragePairRule
): Promise<ArbitrageOpportunity | undefined> {
  const [legA, legB] = await Promise.all([
    client.getBestAsk(rule.legA.ticker, rule.legA.side),
    client.getBestAsk(rule.legB.ticker, rule.legB.side)
  ]);
  if (!legA || !legB) return undefined;

  const combinedPriceCents = legA.priceCents + legB.priceCents;
  const profitCents = 100 - combinedPriceCents;
  const size = Math.min(rule.maxContracts, legA.size, legB.size);

  if (combinedPriceCents > rule.maxCombinedPriceCents) return undefined;
  if (profitCents < rule.minProfitCents) return undefined;
  if (size < rule.minSize) return undefined;

  return {
    ruleName: rule.name,
    legA,
    legB,
    combinedPriceCents,
    profitCents,
    size
  };
}

export async function discoverMarkets(
  client: RuleKalshiClient,
  rule: MarketDiscoveryRule
): Promise<KalshiMarket[]> {
  const response = await client.getMarkets({
    status: rule.status,
    limit: rule.limit,
    ...(rule.seriesTicker ? { seriesTicker: rule.seriesTicker } : {})
  });
  return response.markets.filter((market) => marketMatchesDiscoveryRule(market, rule));
}

export function arbitrageOpportunityKey(opportunity: ArbitrageOpportunity): string {
  return [
    "arb",
    opportunity.ruleName,
    opportunity.legA.ticker,
    opportunity.legA.side,
    opportunity.legA.priceCents,
    opportunity.legB.ticker,
    opportunity.legB.side,
    opportunity.legB.priceCents
  ].join(":");
}

export function arbitrageOrderProposals(opportunity: ArbitrageOpportunity): [OrderProposal, OrderProposal] {
  const clientIdBase = createHash("sha256").update(arbitrageOpportunityKey(opportunity)).digest("hex");
  return [
    {
      sourceSignal: syntheticSignal(opportunity.legA.ticker, opportunity.legA.side),
      kalshiTicker: opportunity.legA.ticker,
      action: "buy",
      side: opportunity.legA.side,
      count: opportunity.size,
      ...(opportunity.legA.side === "yes"
        ? { yesPrice: opportunity.legA.priceCents }
        : { noPrice: opportunity.legA.priceCents }),
      clientOrderId: `pkpa-arb-a-${clientIdBase.slice(0, 24)}`
    },
    {
      sourceSignal: syntheticSignal(opportunity.legB.ticker, opportunity.legB.side),
      kalshiTicker: opportunity.legB.ticker,
      action: "buy",
      side: opportunity.legB.side,
      count: opportunity.size,
      ...(opportunity.legB.side === "yes"
        ? { yesPrice: opportunity.legB.priceCents }
        : { noPrice: opportunity.legB.priceCents }),
      clientOrderId: `pkpa-arb-b-${clientIdBase.slice(0, 24)}`
    }
  ];
}

function marketMatchesDiscoveryRule(market: KalshiMarket, rule: MarketDiscoveryRule): boolean {
  const haystack = [
    market.ticker,
    market.eventTicker,
    market.title,
    market.subtitle,
    market.yesSubTitle,
    market.noSubTitle
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  const includes = rule.includeKeywords.map((keyword) => keyword.toLowerCase());
  const excludes = rule.excludeKeywords.map((keyword) => keyword.toLowerCase());

  if (includes.length > 0 && !includes.every((keyword) => haystack.includes(keyword))) {
    return false;
  }
  return !excludes.some((keyword) => haystack.includes(keyword));
}

function syntheticSignal(ticker: string, side: "yes" | "no") {
  return {
    proxyWallet: "kalshi-rule-engine",
    side: "BUY" as const,
    conditionId: `rule:${ticker}:${side}`,
    size: 0,
    price: 0,
    timestamp: Math.floor(Date.now() / 1000),
    outcome: side,
    transactionHash: `rule:${ticker}:${side}`
  };
}
