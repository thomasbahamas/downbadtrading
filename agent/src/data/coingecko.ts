/**
 * coingecko.ts — CoinGecko Pro API client.
 *
 * Used primarily for global market metrics and fear/greed index.
 * Docs: https://docs.coingecko.com/v3.0.1/reference
 * Base URL: https://pro-api.coingecko.com/api/v3
 */

import axios from 'axios';
import type { AgentConfig, GlobalMetrics } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('data/coingecko');

interface CoinGeckoGlobal {
  data: {
    total_market_cap: Record<string, number>;
    total_volume: Record<string, number>;
    market_cap_percentage: Record<string, number>;
    active_cryptocurrencies: number;
    market_cap_change_percentage_24h_usd: number;
  };
}

interface CoinGeckoFearGreed {
  data: Array<{
    value: string;
    value_classification: string;
    timestamp: string;
  }>;
}

interface CoinGeckoPrice {
  [coinId: string]: {
    usd: number;
    usd_24h_vol: number;
    usd_24h_change: number;
  };
}

export class CoinGeckoClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AgentConfig) {
    this.baseUrl = config.coingeckoBaseUrl;
    this.apiKey = config.coingeckoApiKey;
  }

  private get headers() {
    return {
      'x-cg-pro-api-key': this.apiKey,
    };
  }

  /**
   * Returns global market metrics including SOL price, BTC dominance, etc.
   */
  async getGlobalMetrics(): Promise<GlobalMetrics> {
    const [globalResp, priceResp, fearGreedResp] = await Promise.allSettled([
      this.getGlobal(),
      this.getPrices(['solana', 'bitcoin', 'ethereum']),
      this.getFearGreedIndex(),
    ]);

    const global = globalResp.status === 'fulfilled' ? globalResp.value : null;
    const prices = priceResp.status === 'fulfilled' ? priceResp.value : {};
    const fearGreed = fearGreedResp.status === 'fulfilled' ? fearGreedResp.value : 50;

    return {
      solPriceUsd: prices['solana']?.usd ?? 0,
      solVolume24h: prices['solana']?.usd_24h_vol ?? 0,
      totalDexVolume24h: 0, // TODO: add DEX volume source
      fearGreedIndex: fearGreed,
      btcDominancePct: global?.data.market_cap_percentage['btc'] ?? 40,
      totalMarketCapUsd: global?.data.total_market_cap['usd'] ?? 0,
    };
  }

  /**
   * Simple price fetch for multiple coin IDs.
   */
  async getPrices(coinIds: string[]): Promise<CoinGeckoPrice> {
    // TODO: implement using /simple/price endpoint
    const response = await axios.get<CoinGeckoPrice>(`${this.baseUrl}/simple/price`, {
      params: {
        ids: coinIds.join(','),
        vs_currencies: 'usd',
        include_24hr_vol: true,
        include_24hr_change: true,
      },
      headers: this.headers,
    });
    return response.data;
  }

  /**
   * Global crypto market data (total market cap, volume, BTC dominance).
   */
  async getGlobal(): Promise<CoinGeckoGlobal['data']> {
    // TODO: implement using /global endpoint
    const response = await axios.get<CoinGeckoGlobal>(`${this.baseUrl}/global`, {
      headers: this.headers,
    });
    return response.data.data;
  }

  /**
   * Returns the Fear & Greed Index (0–100).
   * Note: CoinGecko doesn't directly provide this; use alternative.coingecko.com endpoint.
   */
  async getFearGreedIndex(): Promise<number> {
    // TODO: implement using CoinGecko's fear_and_greed endpoint or alternative-me API
    try {
      const response = await axios.get<CoinGeckoFearGreed>(
        'https://api.alternative.me/fng/?limit=1',
        { timeout: 5000 }
      );
      return parseInt(response.data.data[0].value, 10);
    } catch (err) {
      logger.debug(`getFearGreedIndex failed: ${err}`);
      return 50; // Neutral fallback
    }
  }

  /**
   * OHLCV market chart for a coin.
   * days: 1 | 7 | 30 | 90 | 180 | 365 | 'max'
   */
  async getMarketChart(
    coinId: string,
    days: number | 'max' = 7
  ): Promise<Array<{ time: number; price: number; volume: number }>> {
    // TODO: implement using /coins/{id}/market_chart
    const response = await axios.get<{
      prices: Array<[number, number]>;
      total_volumes: Array<[number, number]>;
    }>(`${this.baseUrl}/coins/${coinId}/market_chart`, {
      params: { vs_currency: 'usd', days },
      headers: this.headers,
    });

    return response.data.prices.map(([time, price], i) => ({
      time,
      price,
      volume: response.data.total_volumes[i]?.[1] ?? 0,
    }));
  }
}
