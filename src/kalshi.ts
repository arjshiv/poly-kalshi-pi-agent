import { createPrivateKey, createSign, constants } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { BestAsk, KalshiMarket, KalshiOrderPayload, KalshiSide, OrderProposal } from "./types.js";

export class KalshiAuthError extends Error {}

type KalshiClientOptions = {
  baseUrl: string;
  apiKeyId?: string | undefined;
  privateKeyPath?: string | undefined;
  privateKeyPem?: string | undefined;
  timeoutMs: number;
};

export class KalshiClient {
  private cachedPrivateKeyPem?: string;

  constructor(private readonly options: KalshiClientOptions) {}

  validateAuthConfig(): void {
    if (!this.options.apiKeyId) {
      throw new KalshiAuthError("KALSHI_API_KEY_ID is required for authenticated Kalshi calls");
    }
    if (!this.options.privateKeyPath && !this.options.privateKeyPem) {
      throw new KalshiAuthError(
        "KALSHI_PRIVATE_KEY_PATH or KALSHI_PRIVATE_KEY_PEM is required for Kalshi calls"
      );
    }
  }

  async getBalance(): Promise<unknown> {
    return this.request("GET", "/portfolio/balance");
  }

  async getMarkets(params: {
    status?: "unopened" | "open" | "paused" | "closed" | "settled";
    tickers?: string[];
    seriesTicker?: string;
    limit?: number;
    cursor?: string;
  } = {}): Promise<{ markets: KalshiMarket[]; cursor?: string }> {
    const search = new URLSearchParams();
    if (params.status) search.set("status", params.status);
    if (params.tickers && params.tickers.length > 0) search.set("tickers", params.tickers.join(","));
    if (params.seriesTicker) search.set("series_ticker", params.seriesTicker);
    if (params.limit) search.set("limit", String(params.limit));
    if (params.cursor) search.set("cursor", params.cursor);

    const suffix = search.size > 0 ? `?${search.toString()}` : "";
    const response = (await this.publicRequest("GET", `/markets${suffix}`)) as KalshiMarketsResponse;
    return {
      markets: response.markets.map(parseMarket),
      ...(response.cursor ? { cursor: response.cursor } : {})
    };
  }

  async getMarketOrderbook(ticker: string): Promise<KalshiOrderbook> {
    const response = (await this.publicRequest(
      "GET",
      `/markets/${encodeURIComponent(ticker)}/orderbook`
    )) as KalshiOrderbookResponse;
    return response.orderbook;
  }

  async getBestAsk(ticker: string, side: KalshiSide): Promise<BestAsk | undefined> {
    const book = await this.getMarketOrderbook(ticker);
    return bestAskFromOrderbook(ticker, side, book);
  }

  async createOrder(proposal: OrderProposal): Promise<unknown> {
    return this.request("POST", "/portfolio/orders", proposalToKalshiPayload(proposal));
  }

  async sign(timestampMs: string, method: string, path: string): Promise<string> {
    const keyPem = await this.loadPrivateKeyPem();
    const pathOnly = new URL(path, "https://example.invalid").pathname;
    const payload = `${timestampMs}${method.toUpperCase()}${pathOnly}`;
    const signer = createSign("RSA-SHA256");
    signer.update(payload);
    signer.end();
    return signer.sign(
      {
        key: createPrivateKey(keyPem),
        padding: constants.RSA_PKCS1_PSS_PADDING,
        saltLength: 32
      },
      "base64"
    );
  }

  private async request(method: "GET" | "POST", path: string, body?: unknown): Promise<unknown> {
    this.validateAuthConfig();
    const timestamp = String(Date.now());
    const signature = await this.sign(timestamp, method, path);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.options.baseUrl), {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          "KALSHI-ACCESS-KEY": this.options.apiKeyId ?? "",
          "KALSHI-ACCESS-SIGNATURE": signature,
          "KALSHI-ACCESS-TIMESTAMP": timestamp
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) })
      });
      if (!response.ok) {
        throw new Error(`Kalshi request failed ${response.status}: ${await response.text()}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async publicRequest(method: "GET", path: string): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.options.timeoutMs);
    try {
      const response = await fetch(new URL(path, this.options.baseUrl), {
        method,
        signal: controller.signal,
        headers: { "Content-Type": "application/json" }
      });
      if (!response.ok) {
        throw new Error(`Kalshi public request failed ${response.status}: ${await response.text()}`);
      }
      return response.json();
    } finally {
      clearTimeout(timeout);
    }
  }

  private async loadPrivateKeyPem(): Promise<string> {
    if (this.cachedPrivateKeyPem) return this.cachedPrivateKeyPem;
    if (this.options.privateKeyPem) {
      this.cachedPrivateKeyPem = this.options.privateKeyPem.replaceAll("\\n", "\n");
      return this.cachedPrivateKeyPem;
    }
    if (!this.options.privateKeyPath) {
      throw new KalshiAuthError("missing Kalshi private key");
    }
    this.cachedPrivateKeyPem = await readFile(this.options.privateKeyPath, "utf8");
    return this.cachedPrivateKeyPem;
  }
}

type RawKalshiMarket = {
  ticker: string;
  event_ticker?: string;
  title?: string;
  subtitle?: string;
  yes_sub_title?: string;
  no_sub_title?: string;
  status?: string;
  close_time?: string;
  yes_ask_dollars?: string;
  no_ask_dollars?: string;
};

type KalshiMarketsResponse = {
  markets: RawKalshiMarket[];
  cursor?: string;
};

type RawOrderbookLevel = [number | string, number | string];

export type KalshiOrderbook = {
  yes?: RawOrderbookLevel[];
  no?: RawOrderbookLevel[];
  yes_dollars?: RawOrderbookLevel[];
  no_dollars?: RawOrderbookLevel[];
};

type KalshiOrderbookResponse = {
  orderbook: KalshiOrderbook;
};

function parseMarket(raw: RawKalshiMarket): KalshiMarket {
  return {
    ticker: raw.ticker,
    ...(raw.event_ticker ? { eventTicker: raw.event_ticker } : {}),
    ...(raw.title ? { title: raw.title } : {}),
    ...(raw.subtitle ? { subtitle: raw.subtitle } : {}),
    ...(raw.yes_sub_title ? { yesSubTitle: raw.yes_sub_title } : {}),
    ...(raw.no_sub_title ? { noSubTitle: raw.no_sub_title } : {}),
    ...(raw.status ? { status: raw.status } : {}),
    ...(raw.close_time ? { closeTime: raw.close_time } : {}),
    ...(raw.yes_ask_dollars ? { yesAskCents: dollarsToCents(raw.yes_ask_dollars) } : {}),
    ...(raw.no_ask_dollars ? { noAskCents: dollarsToCents(raw.no_ask_dollars) } : {})
  };
}

export function bestAskFromOrderbook(
  ticker: string,
  side: KalshiSide,
  book: KalshiOrderbook
): BestAsk | undefined {
  // Kalshi orderbook arrays are bid books. Buying YES crosses the best NO bid at 100 - noBid.
  const opposingLevels = side === "yes" ? (book.no_dollars ?? book.no) : (book.yes_dollars ?? book.yes);
  if (!opposingLevels || opposingLevels.length === 0) return undefined;

  const bestOpposingBid = opposingLevels
    .map(([price, size]) => ({ priceCents: priceToCents(price), size: Number(size) }))
    .filter((level) => Number.isFinite(level.priceCents) && Number.isFinite(level.size) && level.size > 0)
    .sort((left, right) => right.priceCents - left.priceCents)[0];
  if (!bestOpposingBid) return undefined;

  return {
    ticker,
    side,
    priceCents: Math.max(1, Math.min(99, 100 - bestOpposingBid.priceCents)),
    size: Math.floor(bestOpposingBid.size)
  };
}

function dollarsToCents(value: string): number {
  return Math.round(Number(value) * 100);
}

function priceToCents(value: number | string): number {
  const parsed = Number(value);
  return parsed > 1 ? Math.round(parsed) : Math.round(parsed * 100);
}

export function proposalToKalshiPayload(proposal: OrderProposal): KalshiOrderPayload {
  return {
    ticker: proposal.kalshiTicker,
    action: proposal.action,
    side: proposal.side,
    count: proposal.count,
    type: "limit",
    client_order_id: proposal.clientOrderId,
    ...(proposal.yesPrice !== undefined ? { yes_price: proposal.yesPrice } : {}),
    ...(proposal.noPrice !== undefined ? { no_price: proposal.noPrice } : {})
  };
}
