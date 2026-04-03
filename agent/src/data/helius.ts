/**
 * helius.ts — Helius Enhanced WebSocket + REST API client.
 *
 * Used for:
 *  - Real-time transaction streaming (logsSubscribe, accountSubscribe)
 *  - Whale trade detection via enhanced transaction parsing
 *  - New token detection
 *  - Webhook registration for position monitoring
 *
 * Docs: https://docs.helius.dev/
 */

import axios from 'axios';
import { Connection } from '@solana/web3.js';
import type { AgentConfig, MarketEvent } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('data/helius');

// Enhanced transaction category types from Helius
type HeliusTransactionType =
  | 'SWAP'
  | 'TRANSFER'
  | 'TOKEN_MINT'
  | 'BURN'
  | 'NFT_SALE'
  | 'UNKNOWN';

interface HeliusEnhancedTransaction {
  signature: string;
  timestamp: number;
  type: HeliusTransactionType;
  description: string;
  fee: number;
  feePayer: string;
  tokenTransfers: Array<{
    mint: string;
    tokenAmount: number;
    decimals: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  nativeTransfers: Array<{
    amount: number;
    fromUserAccount: string;
    toUserAccount: string;
  }>;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      mint: string;
      rawTokenAmount: { tokenAmount: string; decimals: number };
      userAccount: string;
    }>;
  }>;
}

interface HeliusWebhookConfig {
  webhookURL: string;
  accountAddresses: string[];
  transactionTypes: string[];
  webhookType: 'enhanced' | 'raw';
}

const WHALE_THRESHOLD_USD = 50_000;

export class HeliusClient {
  private readonly apiKey: string;
  private readonly rpcUrl: string;
  private readonly wsUrl: string;
  private readonly connection: Connection;

  constructor(config: AgentConfig) {
    this.apiKey = config.heliusApiKey;
    this.rpcUrl = config.heliusRpcUrl;
    this.wsUrl = config.heliusWsUrl;
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
  }

  private get baseApiUrl(): string {
    return `https://api.helius.xyz/v0`;
  }

  /**
   * Fetch recent enhanced transactions for a set of addresses.
   * Returns parsed MarketEvent[] for whale trades and large transfers.
   */
  async getRecentEvents(limit = 50): Promise<MarketEvent[]> {
    try {
      // Fetch enhanced transactions from high-activity DeFi programs
      const programAddresses = [
        'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4', // Jupiter v6
        '675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8', // Raydium AMM v4
      ];

      const results: MarketEvent[] = [];
      for (const address of programAddresses) {
        try {
          const response = await axios.get<HeliusEnhancedTransaction[]>(
            `${this.baseApiUrl}/addresses/${address}/transactions`,
            {
              params: { 'api-key': this.apiKey, limit: Math.ceil(limit / programAddresses.length), type: 'SWAP' },
              timeout: 10_000,
            }
          );
          const txs = response.data;
          if (Array.isArray(txs)) {
            // Get SOL price for rough value estimates
            const solPrice = await this.getSolPrice();
            results.push(...this.parseTransactionsToEvents(txs, solPrice));
          }
        } catch (err) {
          logger.debug(`getRecentEvents for ${address.slice(0, 8)}: ${err}`);
        }
      }
      return results.slice(0, limit);
    } catch (err) {
      logger.warn(`getRecentEvents failed: ${err}`);
      return [];
    }
  }

  /**
   * Quick SOL/USD price fetch for value estimates.
   */
  private async getSolPrice(): Promise<number> {
    try {
      const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
        params: { ids: 'solana', vs_currencies: 'usd' },
        timeout: 5000,
      });
      return res.data?.solana?.usd ?? 150;
    } catch {
      return 150; // fallback
    }
  }

  /**
   * Parses raw Helius enhanced transactions into MarketEvent objects.
   */
  private parseTransactionsToEvents(
    txs: HeliusEnhancedTransaction[],
    solPrice: number
  ): MarketEvent[] {
    const events: MarketEvent[] = [];

    for (const tx of txs) {
      // Detect whale swaps
      for (const transfer of tx.tokenTransfers) {
        // Rough USD value estimate (needs price lookup for accuracy)
        // TODO: cross-reference with Birdeye price data
        const roughValueUsd = transfer.tokenAmount / (10 ** transfer.decimals) * 1; // placeholder

        if (tx.type === 'SWAP' && roughValueUsd >= WHALE_THRESHOLD_USD) {
          events.push({
            type: 'whale_trade',
            token: transfer.mint,
            details: tx.description || `Large swap detected`,
            valueUsd: roughValueUsd,
            txSignature: tx.signature,
            timestamp: tx.timestamp * 1000,
          });
        }
      }
    }

    return events;
  }

  /**
   * Register a webhook to receive real-time notifications for addresses.
   * Used to track OCO order fills and position-related wallets.
   *
   * TODO: implement and store webhook ID for later deletion/update
   */
  async registerWebhook(config: HeliusWebhookConfig): Promise<string> {
    const response = await axios.post(
      `${this.baseApiUrl}/webhooks`,
      config,
      { params: { 'api-key': this.apiKey } }
    );
    const webhookId = response.data.webhookID;
    logger.info(`Webhook registered: ${webhookId}`);
    return webhookId;
  }

  /**
   * Parse an incoming Helius webhook payload into MarketEvents.
   * Call this from an Express route that receives webhook POST requests.
   */
  parseWebhookPayload(payload: HeliusEnhancedTransaction[]): MarketEvent[] {
    // TODO: implement full parsing
    return this.parseTransactionsToEvents(payload, 0);
  }

  /**
   * Subscribe to real-time logs for program activity.
   * Returns an unsubscribe function.
   *
   * TODO: implement using @solana/web3.js logsSubscribe with Helius WS URL
   */
  async subscribeToLogs(
    programId: string,
    onEvent: (event: MarketEvent) => void
  ): Promise<() => void> {
    const { PublicKey } = await import('@solana/web3.js');
    const subId = this.connection.onLogs(
      new PublicKey(programId),
      (logs) => {
        // Filter for swap-related log lines
        const hasSwap = logs.logs.some(
          (l) => l.includes('Swap') || l.includes('swap') || l.includes('Route')
        );
        if (hasSwap) {
          onEvent({
            type: 'whale_trade',
            token: programId,
            details: `Swap detected on ${programId.slice(0, 8)}`,
            txSignature: logs.signature,
            timestamp: Date.now(),
          });
        }
      },
      'confirmed'
    );

    logger.info(`Subscribed to logs for program ${programId.slice(0, 8)} (subId=${subId})`);
    return () => {
      this.connection.removeOnLogsListener(subId);
      logger.info(`Unsubscribed from logs for ${programId.slice(0, 8)}`);
    };
  }
}
