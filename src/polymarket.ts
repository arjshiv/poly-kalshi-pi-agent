import { sourceSideSchema, type TradeSignal } from "./types.js";

type PolymarketTradeResponse = {
  proxyWallet: string;
  side: string;
  conditionId: string;
  size: number | string;
  price: number | string;
  timestamp: number | string;
  title?: string;
  slug?: string;
  outcome: string;
  transactionHash: string;
};

export class PolymarketDataClient {
  constructor(
    private readonly baseUrl: string,
    private readonly timeoutMs: number
  ) {}

  async getTrades(params: {
    user: string;
    conditionIds: string[];
    limit?: number;
    takerOnly?: boolean;
  }): Promise<TradeSignal[]> {
    if (params.conditionIds.length === 0) return [];

    const url = new URL("/trades", this.baseUrl);
    url.searchParams.set("user", params.user);
    url.searchParams.set("market", params.conditionIds.join(","));
    url.searchParams.set("limit", String(params.limit ?? 100));
    url.searchParams.set("takerOnly", String(params.takerOnly ?? true));

    const response = await fetchWithTimeout(url, this.timeoutMs);
    if (!response.ok) {
      throw new Error(`Polymarket trades request failed ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as PolymarketTradeResponse[];
    return body.map(parseTrade);
  }
}

function parseTrade(item: PolymarketTradeResponse): TradeSignal {
  return {
    proxyWallet: item.proxyWallet,
    side: sourceSideSchema.parse(item.side.toUpperCase()),
    conditionId: item.conditionId,
    size: Number(item.size),
    price: Number(item.price),
    timestamp: Number(item.timestamp),
    ...(item.title ? { title: item.title } : {}),
    ...(item.slug ? { slug: item.slug } : {}),
    outcome: item.outcome,
    transactionHash: item.transactionHash
  };
}

async function fetchWithTimeout(url: URL, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}
