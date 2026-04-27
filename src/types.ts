import { z } from "zod";

export const sourceSideSchema = z.enum(["BUY", "SELL"]);
export type SourceSide = z.infer<typeof sourceSideSchema>;

export const kalshiSideSchema = z.enum(["yes", "no"]);
export type KalshiSide = z.infer<typeof kalshiSideSchema>;

export const arbitrageLegSchema = z.object({
  ticker: z.string().min(1),
  side: kalshiSideSchema.default("yes")
});
export type ArbitrageLeg = z.infer<typeof arbitrageLegSchema>;

export const arbitragePairRuleSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  category: z.string().optional(),
  maxCombinedPriceCents: z.number().int().min(1).max(100).default(99),
  minProfitCents: z.number().int().min(0).default(1),
  minSize: z.number().int().positive().default(1),
  maxContracts: z.number().int().positive().default(1),
  execute: z.boolean().default(false),
  acknowledgeSequentialExecutionRisk: z.boolean().default(false),
  legA: arbitrageLegSchema,
  legB: arbitrageLegSchema,
  notes: z.string().default("")
});
export type ArbitragePairRule = z.infer<typeof arbitragePairRuleSchema>;

export const marketDiscoveryRuleSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  includeKeywords: z.array(z.string().min(1)).default([]),
  excludeKeywords: z.array(z.string().min(1)).default([]),
  status: z.enum(["unopened", "open", "paused", "closed", "settled"]).default("open"),
  limit: z.number().int().positive().max(1000).default(100),
  seriesTicker: z.string().optional()
});
export type MarketDiscoveryRule = z.infer<typeof marketDiscoveryRuleSchema>;

export const rulesConfigSchema = z
  .object({
    arbitragePairs: z.array(arbitragePairRuleSchema).default([]),
    marketDiscovery: z.array(marketDiscoveryRuleSchema).default([])
  })
  .default({});
export type RulesConfig = z.infer<typeof rulesConfigSchema>;

export const stopConfigSchema = z
  .object({
    maxCycles: z.number().int().positive().optional(),
    maxRuntimeSeconds: z.number().int().positive().optional(),
    maxSubmittedOrders: z.number().int().positive().optional(),
    maxDetectedOpportunities: z.number().int().positive().optional(),
    stopFile: z.string().optional()
  })
  .default({});
export type StopConfig = z.infer<typeof stopConfigSchema>;

export const watcherConfigSchema = z.object({
  name: z.string().min(1),
  polymarketUser: z.string().regex(/^0x[a-fA-F0-9]{40}$/)
});
export type WatcherConfig = z.infer<typeof watcherConfigSchema>;

export const marketMappingSchema = z.object({
  name: z.string().min(1),
  enabled: z.boolean().default(false),
  polymarketConditionId: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  polymarketSlug: z.string().optional(),
  kalshiTicker: z.string().min(1),
  outcomeMap: z.record(z.string().min(1), kalshiSideSchema),
  notes: z.string().default("")
});
export type MarketMapping = z.infer<typeof marketMappingSchema>;

export const riskConfigSchema = z.object({
  dryRun: z.boolean().default(true),
  maxContractsPerOrder: z.number().int().positive().default(1),
  maxNotionalCentsPerOrder: z.number().int().positive().default(100),
  maxOrdersPerCycle: z.number().int().positive().default(2),
  minSourceTradeSize: z.number().nonnegative().default(1),
  maxSourceTradeAgeSeconds: z.number().int().positive().default(180),
  priceImprovementCents: z.number().int().min(0).max(99).default(1),
  allowedSides: z.array(sourceSideSchema).default(["BUY"])
});
export type RiskConfig = z.infer<typeof riskConfigSchema>;

export const agentConfigSchema = z.object({
  pollIntervalSeconds: z.number().int().min(5).default(20),
  statePath: z.string().default("state/seen-trades.json"),
  logPath: z.string().default("logs/agent.log"),
  risk: riskConfigSchema.default({}),
  watchers: z.array(watcherConfigSchema).default([]),
  markets: z.array(marketMappingSchema).default([]),
  rules: rulesConfigSchema,
  stop: stopConfigSchema
});
export type AgentConfig = z.infer<typeof agentConfigSchema>;

export type TradeSignal = {
  proxyWallet: string;
  side: SourceSide;
  conditionId: string;
  size: number;
  price: number;
  timestamp: number;
  title?: string;
  slug?: string;
  outcome: string;
  transactionHash: string;
};

export type OrderProposal = {
  sourceSignal: TradeSignal;
  kalshiTicker: string;
  action: "buy";
  side: KalshiSide;
  count: number;
  yesPrice?: number;
  noPrice?: number;
  clientOrderId: string;
};

export type KalshiOrderPayload = {
  ticker: string;
  action: "buy";
  side: KalshiSide;
  count: number;
  type: "limit";
  client_order_id: string;
  yes_price?: number;
  no_price?: number;
};

export type KalshiMarket = {
  ticker: string;
  eventTicker?: string;
  title?: string;
  subtitle?: string;
  yesSubTitle?: string;
  noSubTitle?: string;
  status?: string;
  closeTime?: string;
  yesAskCents?: number;
  noAskCents?: number;
};

export type BestAsk = {
  ticker: string;
  side: KalshiSide;
  priceCents: number;
  size: number;
};

export type ArbitrageOpportunity = {
  ruleName: string;
  legA: BestAsk;
  legB: BestAsk;
  combinedPriceCents: number;
  profitCents: number;
  size: number;
};
