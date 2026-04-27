import { z } from "zod";

export const sourceSideSchema = z.enum(["BUY", "SELL"]);
export type SourceSide = z.infer<typeof sourceSideSchema>;

export const kalshiSideSchema = z.enum(["yes", "no"]);
export type KalshiSide = z.infer<typeof kalshiSideSchema>;

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
  watchers: z.array(watcherConfigSchema).min(1),
  markets: z.array(marketMappingSchema)
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
