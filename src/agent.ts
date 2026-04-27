import { Logger } from "./logger.js";
import { access } from "node:fs/promises";
import { idempotencyKey, buildProposal, SignalRejected } from "./risk.js";
import {
  arbitrageOpportunityKey,
  arbitrageOrderProposals,
  discoverMarkets,
  findArbitrageOpportunity
} from "./rules.js";
import { SeenTradeStore } from "./state.js";
import type { AgentConfig, MarketMapping, OrderProposal } from "./types.js";
import { KalshiClient, proposalToKalshiPayload } from "./kalshi.js";
import { PolymarketDataClient } from "./polymarket.js";
import type { Settings } from "./settings.js";

export class CopySignalAgent {
  private readonly store: SeenTradeStore;
  private readonly logger: Logger;
  private detectedOpportunities = 0;
  private submittedOrders = 0;

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
    if (this.enabledMarkets().length === 0 && this.enabledArbitrageRules().length === 0) {
      await this.logger.warn("no enabled markets configured");
    }
    if (this.enabledArbitrageRules().length === 0) {
      await this.logger.warn("no enabled arbitrage pair rules configured");
    }
    if (!this.config.risk.dryRun || this.settings.liveTradingEnabled) {
      this.kalshi.validateAuthConfig();
    }
  }

  async runForever(): Promise<void> {
    await this.store.load();
    const startedAt = Date.now();
    let cycles = 0;
    while (!(await this.shouldStop(startedAt, cycles))) {
      const submitted = await this.runOnce();
      this.submittedOrders += submitted;
      cycles += 1;
      if (await this.shouldStop(startedAt, cycles)) break;
      await sleep(this.config.pollIntervalSeconds * 1000);
    }
    await this.logger.info("agent stopped", {
      cycles,
      submittedOrders: this.submittedOrders,
      detectedOpportunities: this.detectedOpportunities
    });
  }

  async runOnce(): Promise<number> {
    await this.store.load();
    const ruleSubmitted = await this.runRules();
    const enabledMarkets = this.enabledMarkets();
    if (enabledMarkets.length === 0) {
      await this.logger.warn("skipping cycle because no markets are enabled");
      await this.store.save();
      return ruleSubmitted;
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
    return submitted + ruleSubmitted;
  }

  private async runRules(): Promise<number> {
    let submitted = 0;

    for (const rule of this.config.rules.marketDiscovery.filter((item) => item.enabled)) {
      const markets = await discoverMarkets(this.kalshi, rule);
      await this.logger.info("market discovery rule matched markets", {
        rule: rule.name,
        count: markets.length,
        markets: markets.slice(0, 25)
      });
    }

    for (const rule of this.enabledArbitrageRules()) {
      const opportunity = await findArbitrageOpportunity(this.kalshi, rule);
      if (!opportunity) continue;

      const key = arbitrageOpportunityKey(opportunity);
      if (this.store.contains(key)) continue;

      this.detectedOpportunities += 1;
      await this.logger.info("arbitrage opportunity detected", { opportunity });
      if (rule.execute) {
        if (!rule.acknowledgeSequentialExecutionRisk) {
          await this.logger.warn("skipping arbitrage execution because sequential execution risk is not acknowledged", {
            rule: rule.name
          });
          this.store.add(key);
          continue;
        }
        for (const proposal of arbitrageOrderProposals(opportunity)) {
          await this.handleProposal(proposal, {
            name: rule.name,
            enabled: true,
            polymarketConditionId: `0x${"0".repeat(64)}`,
            kalshiTicker: proposal.kalshiTicker,
            outcomeMap: { [proposal.side]: proposal.side },
            notes: rule.notes
          });
          submitted += 1;
        }
      }
      this.store.add(key);
    }

    return submitted;
  }

  private async shouldStop(startedAt: number, cycles: number): Promise<boolean> {
    const stop = this.config.stop;
    if (stop.maxCycles !== undefined && cycles >= stop.maxCycles) return true;
    if (stop.maxRuntimeSeconds !== undefined && Date.now() - startedAt >= stop.maxRuntimeSeconds * 1000) {
      return true;
    }
    if (stop.maxSubmittedOrders !== undefined && this.submittedOrders >= stop.maxSubmittedOrders) {
      return true;
    }
    if (
      stop.maxDetectedOpportunities !== undefined &&
      this.detectedOpportunities >= stop.maxDetectedOpportunities
    ) {
      return true;
    }
    if (stop.stopFile && (await fileExists(stop.stopFile))) return true;
    return false;
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

  private enabledArbitrageRules() {
    return this.config.rules.arbitragePairs.filter((rule) => rule.enabled);
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return false;
    throw error;
  }
}
