import { Logger } from "./logger.js";
import { idempotencyKey, buildProposal, SignalRejected } from "./risk.js";
import { SeenTradeStore } from "./state.js";
import type { AgentConfig, MarketMapping, OrderProposal } from "./types.js";
import { KalshiClient, proposalToKalshiPayload } from "./kalshi.js";
import { PolymarketDataClient } from "./polymarket.js";
import type { Settings } from "./settings.js";

export class CopySignalAgent {
  private readonly store: SeenTradeStore;
  private readonly logger: Logger;

  constructor(
    private readonly config: AgentConfig,
    private readonly settings: Settings,
    private readonly polymarket = new PolymarketDataClient(
      settings.polymarketDataBaseUrl,
      settings.requestTimeoutMs
    ),
    private readonly kalshi = new KalshiClient({
      baseUrl: settings.kalshiBaseUrl,
      apiKeyId: settings.kalshiApiKeyId,
      privateKeyPath: settings.kalshiPrivateKeyPath,
      privateKeyPem: settings.kalshiPrivateKeyPem,
      timeoutMs: settings.requestTimeoutMs
    })
  ) {
    this.store = new SeenTradeStore(config.statePath);
    this.logger = new Logger(config.logPath);
  }

  async check(): Promise<void> {
    if (this.enabledMarkets().length === 0) {
      await this.logger.warn("no enabled markets configured");
    }
    if (!this.config.risk.dryRun || this.settings.liveTradingEnabled) {
      this.kalshi.validateAuthConfig();
    }
  }

  async runForever(): Promise<void> {
    await this.store.load();
    for (;;) {
      await this.runOnce();
      await sleep(this.config.pollIntervalSeconds * 1000);
    }
  }

  async runOnce(): Promise<number> {
    await this.store.load();
    const enabledMarkets = this.enabledMarkets();
    if (enabledMarkets.length === 0) {
      await this.logger.warn("skipping cycle because no markets are enabled");
      return 0;
    }

    const mappings = new Map(
      enabledMarkets.map((market) => [market.polymarketConditionId.toLowerCase(), market])
    );
    const conditionIds = [...mappings.keys()];
    let submitted = 0;

    for (const watcher of this.config.watchers) {
      const signals = await this.polymarket.getTrades({
        user: watcher.polymarketUser,
        conditionIds
      });
      signals.sort((left, right) => left.timestamp - right.timestamp);

      for (const signal of signals) {
        if (submitted >= this.config.risk.maxOrdersPerCycle) {
          await this.logger.info("max orders per cycle reached");
          await this.store.save();
          return submitted;
        }

        const key = idempotencyKey(signal);
        if (this.store.contains(key)) continue;

        const mapping = mappings.get(signal.conditionId.toLowerCase());
        if (!mapping) continue;

        try {
          const proposal = buildProposal({ signal, mapping, risk: this.config.risk });
          await this.handleProposal(proposal, mapping);
          submitted += 1;
        } catch (error) {
          if (error instanceof SignalRejected) {
            await this.logger.info("rejected signal", { key, reason: error.message });
          } else {
            throw error;
          }
        } finally {
          this.store.add(key);
        }
      }
    }

    await this.store.save();
    return submitted;
  }

  private async handleProposal(
    proposal: OrderProposal,
    mapping: MarketMapping
  ): Promise<void> {
    const dryRun = this.config.risk.dryRun || !this.settings.liveTradingEnabled;
    const payload = proposalToKalshiPayload(proposal);
    if (dryRun) {
      await this.logger.info("DRY_RUN would place Kalshi order", {
        mapping: mapping.name,
        payload,
        sourceTx: proposal.sourceSignal.transactionHash
      });
      return;
    }

    const response = await this.kalshi.createOrder(proposal);
    await this.logger.info("placed Kalshi order", { mapping: mapping.name, payload, response });
  }

  private enabledMarkets(): MarketMapping[] {
    return this.config.markets.filter((market) => market.enabled);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
