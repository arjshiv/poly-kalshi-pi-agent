import "dotenv/config";

export type KalshiEnv = "demo" | "prod";

export type Settings = {
  kalshiEnv: KalshiEnv;
  kalshiApiKeyId: string | undefined;
  kalshiPrivateKeyPath: string | undefined;
  kalshiPrivateKeyPem: string | undefined;
  liveTradingEnabled: boolean;
  polymarketDataBaseUrl: string;
  kalshiBaseUrl: string;
  requestTimeoutMs: number;
};

export function loadSettings(env: NodeJS.ProcessEnv = process.env): Settings {
  const kalshiEnv = parseKalshiEnv(env.KALSHI_ENV);
  const kalshiDemoBaseUrl = env.KALSHI_DEMO_BASE_URL ?? "https://demo-api.kalshi.co/trade-api/v2";
  const kalshiProdBaseUrl =
    env.KALSHI_PROD_BASE_URL ?? "https://api.elections.kalshi.com/trade-api/v2";

  return {
    kalshiEnv,
    kalshiApiKeyId: blankToUndefined(env.KALSHI_API_KEY_ID),
    kalshiPrivateKeyPath: blankToUndefined(env.KALSHI_PRIVATE_KEY_PATH),
    kalshiPrivateKeyPem: blankToUndefined(env.KALSHI_PRIVATE_KEY_PEM),
    liveTradingEnabled: env.LIVE_TRADING_ENABLED === "true",
    polymarketDataBaseUrl: env.POLYMARKET_DATA_BASE_URL ?? "https://data-api.polymarket.com",
    kalshiBaseUrl: kalshiEnv === "prod" ? kalshiProdBaseUrl : kalshiDemoBaseUrl,
    requestTimeoutMs: Number(env.REQUEST_TIMEOUT_MS ?? 15_000)
  };
}

function parseKalshiEnv(value: string | undefined): KalshiEnv {
  if (value === "prod") return "prod";
  return "demo";
}

function blankToUndefined(value: string | undefined): string | undefined {
  return value && value.trim().length > 0 ? value : undefined;
}
