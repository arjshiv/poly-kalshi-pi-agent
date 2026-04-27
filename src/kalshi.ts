import { createPrivateKey, createSign, constants } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { KalshiOrderPayload, OrderProposal } from "./types.js";

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
