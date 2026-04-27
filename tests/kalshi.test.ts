import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { KalshiClient, proposalToKalshiPayload } from "../src/kalshi.js";
import type { OrderProposal } from "../src/types.js";

describe("kalshi", () => {
  it("creates a base64 rsa-pss signature", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const client = new KalshiClient({
      baseUrl: "https://demo-api.kalshi.co/trade-api/v2",
      apiKeyId: "key-id",
      privateKeyPem: pem,
      timeoutMs: 1_000
    });

    const signature = await client.sign("1710000000000", "GET", "/portfolio/balance?ignored=true");

    expect(signature).toEqual(expect.any(String));
    expect(signature.length).toBeGreaterThan(100);
  });

  it("serializes proposals to Kalshi order payloads", () => {
    const proposal: OrderProposal = {
      sourceSignal: {
        proxyWallet: "",
        side: "BUY",
        conditionId: `0x${"a".repeat(64)}`,
        size: 1,
        price: 0.5,
        timestamp: 1,
        outcome: "Yes",
        transactionHash: "0xabc"
      },
      kalshiTicker: "TEST",
      action: "buy",
      side: "yes",
      count: 2,
      yesPrice: 51,
      clientOrderId: "client-id"
    };

    expect(proposalToKalshiPayload(proposal)).toEqual({
      ticker: "TEST",
      action: "buy",
      side: "yes",
      count: 2,
      type: "limit",
      client_order_id: "client-id",
      yes_price: 51
    });
  });
});
