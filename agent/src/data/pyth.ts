/**
 * pyth.ts — Pyth Network oracle price feed client.
 *
 * Fetches high-confidence price data from Pyth's on-chain accounts.
 * Used to cross-reference Birdeye prices and filter low-confidence feeds.
 *
 * Pyth SDK: @pythnetwork/client
 * Price feed IDs: https://pyth.network/developers/price-feed-ids#solana-mainnet-beta
 */

import { Connection, PublicKey } from '@solana/web3.js';
import type { AgentConfig, TokenData, PythPriceData } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('data/pyth');

// Well-known Pyth price feed accounts on Solana mainnet
// These are the Pyth Price Account pubkeys (not feed IDs)
export const PYTH_PRICE_ACCOUNTS: Record<string, string> = {
  // SOL/USD
  So11111111111111111111111111111111111111112:
    'H6ARHf6YXhGYeQfUzQNGk6rDNnLBQKrenN712K4AQJEG',
  // BTC/USD (mapped to WBTC on Solana)
  '9n4nbM75f5Ui33ZbPYXn59EwSgE8CGsHtAeTH5YFeJ9E':
    'GVXRSBjFk6e6J3NbVPXohDJetcTjaeeuykUpbQF8UoMU',
  // ETH/USD (Wormhole ETH)
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs':
    'JBu1AL4obBcCMqKBBxhpWCNUt136ijcuMZLFvTP7iWdB',
  // USDC/USD
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v:
    'Gnt27xtC473ZT2Mw5u8wZ68Z3gULkSTb5DuxJy7eJotD',
};

export class PythClient {
  private readonly connection: Connection;

  constructor(config: AgentConfig) {
    this.connection = new Connection(config.heliusRpcUrl, 'confirmed');
  }

  /**
   * Augments a TokenData array with Pyth price data for tokens that
   * have known Pyth price accounts. Tokens without a Pyth feed are
   * returned unchanged.
   */
  async augmentWithPythPrices(tokens: TokenData[]): Promise<TokenData[]> {
    const mintsWithFeeds = tokens.filter((t) => PYTH_PRICE_ACCOUNTS[t.mint]);
    if (mintsWithFeeds.length === 0) return tokens;

    const accountPubkeys = mintsWithFeeds.map(
      (t) => new PublicKey(PYTH_PRICE_ACCOUNTS[t.mint])
    );

    try {
      // Batch fetch all Pyth price accounts in one RPC call
      const accountInfos = await this.connection.getMultipleAccountsInfo(accountPubkeys);

      const pythPriceMap = new Map<string, PythPriceData>();
      for (let i = 0; i < mintsWithFeeds.length; i++) {
        const accountInfo = accountInfos[i];
        if (!accountInfo) continue;

        // TODO: parse Pyth price account data using @pythnetwork/client
        // The raw account data is 3312 bytes with a specific binary format.
        // Use parsePriceData() from @pythnetwork/client to decode it.
        //
        // Example (after installing @pythnetwork/client):
        //   import { parsePriceData } from '@pythnetwork/client';
        //   const priceData = parsePriceData(accountInfo.data);
        //   if (priceData.status === PriceStatus.Trading) {
        //     pythPriceMap.set(mintsWithFeeds[i].mint, {
        //       price: priceData.price,
        //       confidence: priceData.confidence,
        //       publishTime: priceData.timestamp * 1000,
        //       emaPrice: priceData.emaPrice?.price,
        //     });
        //   }

        // Placeholder until @pythnetwork/client is wired up:
        logger.debug(`Pyth account info fetched for ${mintsWithFeeds[i].symbol}`);
      }

      return tokens.map((t) => {
        const pythPrice = pythPriceMap.get(t.mint);
        if (pythPrice) {
          return { ...t, pythPrice };
        }
        return t;
      });
    } catch (err) {
      logger.warn(`augmentWithPythPrices failed: ${err}`);
      return tokens;
    }
  }

  /**
   * Fetch Pyth price for a single token mint.
   * Returns null if no feed is available or feed is stale (>30s old).
   */
  async getPrice(mint: string): Promise<PythPriceData | null> {
    const feedAccount = PYTH_PRICE_ACCOUNTS[mint];
    if (!feedAccount) return null;

    try {
      const accountInfo = await this.connection.getAccountInfo(new PublicKey(feedAccount));
      if (!accountInfo) return null;

      // TODO: parse with @pythnetwork/client parsePriceData()
      // Check publishTime staleness: reject if > 30 seconds old

      return null; // placeholder
    } catch (err) {
      logger.debug(`getPrice(${mint.slice(0, 8)}) failed: ${err}`);
      return null;
    }
  }
}
