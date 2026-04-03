/**
 * birdeye.ts — Birdeye API client.
 *
 * Docs: https://docs.birdeye.so/
 * Base URL: https://public-api.birdeye.so
 *
 * Key endpoints used:
 *  - GET /defi/tokenlist         — full token list with price/volume
 *  - GET /defi/token_overview    — detailed data for one token
 *  - GET /defi/history_price     — OHLCV history
 *  - GET /defi/trending_tokens   — trending tokens by volume
 */

import axios from 'axios';
import type { AgentConfig, TokenData } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('data/birdeye');

// Supported Birdeye chains
const CHAIN = 'solana';

interface BirdeyeTokenListItem {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  priceChange24hPercent: number;
  volume24h: number;
  volumeChangePercent: number;
  mc: number;
  liquidity: number;
  trade24h: number;
  buy24h: number;
  sell24h: number;
  uniqueWallet24h: number;
  lastTradeUnixTime: number;
  createdTime: number;
}

interface BirdeyeTokenOverview {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  price: number;
  priceChange1hPercent: number;
  priceChange24hPercent: number;
  volume24h: number;
  volumeChangePercent: number;
  mc: number;
  liquidity: number;
  holder: number;
  trade24h: number;
  buy24h: number;
  sell24h: number;
  buyVolume24h: number;
  sellVolume24h: number;
  uniqueWallet24h: number;
  createdTime: number;
}

interface BirdeyeTrendingResponse {
  data: {
    items: Array<{ address: string; symbol: string }>;
  };
}

export class BirdeyeClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AgentConfig) {
    this.baseUrl = config.birdeyeBaseUrl;
    this.apiKey = config.birdeyeApiKey;
  }

  private get headers() {
    return {
      'X-API-KEY': this.apiKey,
      'x-chain': CHAIN,
    };
  }

  /**
   * Returns the top N trending token mint addresses by volume.
   */
  async getTrendingTokens(limit = 20): Promise<string[]> {
    // TODO: verify exact Birdeye trending endpoint path and params
    try {
      const response = await axios.get<BirdeyeTrendingResponse>(
        `${this.baseUrl}/defi/trending_tokens`,
        {
          params: { sort_by: 'volume24hUSD', sort_type: 'desc', offset: 0, limit },
          headers: this.headers,
        }
      );
      return response.data.data.items.map((t) => t.address);
    } catch (err) {
      logger.warn(`getTrendingTokens failed: ${err}`);
      return [];
    }
  }

  /**
   * Fetch TokenData for an array of mint addresses.
   * Uses overview endpoint for individual tokens; batches via parallel requests
   * (Birdeye does not have a true multi-token batch endpoint for overview data).
   */
  async getTokenDataBatch(mints: string[], concurrency = 5): Promise<TokenData[]> {
    const results: TokenData[] = [];
    const chunks = chunk(mints, concurrency);

    for (const batch of chunks) {
      const settled = await Promise.allSettled(batch.map((mint) => this.getTokenData(mint)));
      for (const result of settled) {
        if (result.status === 'fulfilled' && result.value) {
          results.push(result.value);
        }
      }
    }

    return results;
  }

  /**
   * Fetch TokenData for a single mint.
   */
  async getTokenData(mint: string): Promise<TokenData | null> {
    // TODO: implement using Birdeye /defi/token_overview endpoint
    try {
      const response = await axios.get<{ data: BirdeyeTokenOverview }>(
        `${this.baseUrl}/defi/token_overview`,
        {
          params: { address: mint },
          headers: this.headers,
        }
      );

      const d = response.data.data;
      const tokenAge = d.createdTime ? d.createdTime * 1000 : 0; // convert to ms

      const tokenData: TokenData = {
        mint: d.address,
        symbol: d.symbol,
        name: d.name,
        priceUsd: d.price,
        priceChange1h: d.priceChange1hPercent ?? 0,
        priceChange24h: d.priceChange24hPercent ?? 0,
        volume24h: d.volume24h ?? 0,
        volumeChange24h: d.volumeChangePercent ?? 0,
        marketCap: d.mc ?? 0,
        liquidity: d.liquidity ?? 0,
        holderCount: d.holder ?? 0,
        createdAt: tokenAge,
        tradeCount24h: d.trade24h,
        buyVolume24h: d.buyVolume24h,
        sellVolume24h: d.sellVolume24h,
      };

      return tokenData;
    } catch (err) {
      logger.debug(`getTokenData(${mint.slice(0, 8)}) failed: ${err}`);
      return null;
    }
  }

  /**
   * Fetch OHLCV price history for a token.
   * type: '1m' | '5m' | '15m' | '1H' | '4H' | '1D' | '1W'
   */
  async getPriceHistory(
    mint: string,
    type: string = '1H',
    timeFrom: number = Math.floor((Date.now() - 7 * 24 * 3600 * 1000) / 1000),
    timeTo: number = Math.floor(Date.now() / 1000)
  ): Promise<Array<{ time: number; open: number; high: number; low: number; close: number; volume: number }>> {
    // TODO: implement using Birdeye /defi/history_price endpoint
    try {
      const response = await axios.get<{
        data: {
          items: Array<{
            unixTime: number;
            open: number;
            high: number;
            low: number;
            close: number;
            volume: number;
          }>;
        };
      }>(`${this.baseUrl}/defi/history_price`, {
        params: { address: mint, address_type: 'token', type, time_from: timeFrom, time_to: timeTo },
        headers: this.headers,
      });
      return response.data.data.items.map((item) => ({
        time: item.unixTime,
        open: item.open,
        high: item.high,
        low: item.low,
        close: item.close,
        volume: item.volume,
      }));
    } catch (err) {
      logger.warn(`getPriceHistory(${mint.slice(0, 8)}) failed: ${err}`);
      return [];
    }
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
