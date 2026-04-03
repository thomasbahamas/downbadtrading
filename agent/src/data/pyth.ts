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
        if (!accountInfo || !accountInfo.data) continue;

        try {
          const priceData = parsePythPriceAccount(accountInfo.data as Buffer);
          if (priceData) {
            pythPriceMap.set(mintsWithFeeds[i].mint, priceData);
            logger.debug(
              `Pyth price for ${mintsWithFeeds[i].symbol}: $${priceData.price.toFixed(4)} ` +
              `(conf: $${priceData.confidence.toFixed(4)})`
            );
          }
        } catch (err) {
          logger.debug(`Pyth parse failed for ${mintsWithFeeds[i].symbol}: ${err}`);
        }
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
      if (!accountInfo || !accountInfo.data) return null;

      const priceData = parsePythPriceAccount(accountInfo.data as Buffer);
      if (!priceData) return null;

      // Reject stale feeds (>30 seconds old)
      const ageMs = Date.now() - priceData.publishTime;
      if (ageMs > 30_000) {
        logger.debug(`Pyth feed stale for ${mint.slice(0, 8)}: ${(ageMs / 1000).toFixed(0)}s old`);
        return null;
      }

      return priceData;
    } catch (err) {
      logger.debug(`getPrice(${mint.slice(0, 8)}) failed: ${err}`);
      return null;
    }
  }
}

/**
 * Parse Pyth V2 price account binary data.
 * Layout reference: https://docs.pyth.network/price-feeds/pythnet-price-feeds/on-chain-programs
 *
 * Key offsets (all little-endian):
 *   - Byte 0-3: magic (0xa1b2c3d4)
 *   - Byte 208-215: aggregate price (i64)
 *   - Byte 216-223: aggregate confidence (u64)
 *   - Byte 224-227: aggregate status (u32) — 1 = Trading
 *   - Byte 232-235: exponent (i32)
 *   - Byte 240-247: publish time (i64, unix seconds)
 *   - Byte 248-255: EMA price (i64)
 */
function parsePythPriceAccount(data: Buffer): PythPriceData | null {
  if (data.length < 260) return null;

  // Verify magic number
  const magic = data.readUInt32LE(0);
  if (magic !== 0xa1b2c3d4) return null;

  const exponent = data.readInt32LE(232);
  const scaleFactor = 10 ** exponent;

  const aggregatePrice = Number(data.readBigInt64LE(208));
  const aggregateConfidence = Number(data.readBigUInt64LE(216));
  const status = data.readUInt32LE(224);

  // Status 1 = Trading (active and reliable)
  if (status !== 1) return null;

  const publishTimeSec = Number(data.readBigInt64LE(240));
  const emaPrice = Number(data.readBigInt64LE(248));

  return {
    price: aggregatePrice * scaleFactor,
    confidence: aggregateConfidence * scaleFactor,
    publishTime: publishTimeSec * 1000,
    emaPrice: emaPrice * scaleFactor,
  };
}
