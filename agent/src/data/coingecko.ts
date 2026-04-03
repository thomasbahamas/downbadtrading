/**
 * coingecko.ts — CoinGecko Pro API client.
 *
 * Used primarily for global market metrics and fear/greed index.
 * Docs: https://docs.coingecko.com/v3.0.1/reference
 * Base URL: https://pro-api.coingecko.com/api/v3
 */

import axios from 'axios';
import type { AgentConfig, GlobalMetrics, TokenData } from '../types';
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

interface CoinGeckoMarketItem {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  market_cap: number | null;
  total_volume: number | null;
  price_change_percentage_24h: number | null;
  price_change_percentage_1h_in_currency: number | null;
  circulating_supply: number | null;
  ath: number | null;
  atl_date: string | null;
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
      'x-cg-demo-api-key': this.apiKey,
    };
  }

  /**
   * Returns global market metrics including SOL price, BTC dominance, etc.
   */
  async getGlobalMetrics(): Promise<GlobalMetrics> {
    // Sequential calls to avoid CoinGecko rate limiting
    const globalResp = await Promise.resolve().then(() => this.getGlobal()).then(
      v => ({ status: 'fulfilled' as const, value: v }),
      () => ({ status: 'rejected' as const })
    );
    const priceResp = await Promise.resolve().then(() => this.getPrices(['solana', 'bitcoin', 'ethereum'])).then(
      v => ({ status: 'fulfilled' as const, value: v }),
      () => ({ status: 'rejected' as const })
    );
    const fearGreedResp = await Promise.resolve().then(() => this.getFearGreedIndex()).then(
      v => ({ status: 'fulfilled' as const, value: v }),
      () => ({ status: 'rejected' as const })
    );

    const globalData = globalResp.status === 'fulfilled' ? globalResp.value : null;
    const prices = priceResp.status === 'fulfilled' ? priceResp.value : {};
    const fearGreed = fearGreedResp.status === 'fulfilled' ? fearGreedResp.value : 50;

    return {
      solPriceUsd: prices['solana']?.usd ?? 0,
      solVolume24h: prices['solana']?.usd_24h_vol ?? 0,
      totalDexVolume24h: 0,
      fearGreedIndex: fearGreed,
      btcDominancePct: globalData?.data.market_cap_percentage['btc'] ?? 40,
      totalMarketCapUsd: globalData?.data.total_market_cap['usd'] ?? 0,
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
  async getGlobal(): Promise<CoinGeckoGlobal> {
    const response = await axios.get<CoinGeckoGlobal>(`${this.baseUrl}/global`, {
      headers: this.headers,
    });
    return response.data;
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
   * Fetches top Solana ecosystem tokens by market cap from CoinGecko /coins/markets.
   * Returns TokenData[] compatible with the agent's token universe.
   */
  async getSolanaTokenMarkets(limit = 30): Promise<TokenData[]> {
    try {
      // Fetch by specific Solana ecosystem coin IDs — more reliable than category filter
      const solanaIds = [
        'solana', 'jupiter-exchange-solana', 'raydium', 'orca', 'bonk',
        'render-token', 'pyth-network', 'jito-governance-token', 'marinade',
        'tensor', 'parcl', 'dogwifcoin', 'popcat', 'helium', 'hivemapper',
        'sanctum-2', 'kamino', 'drift-protocol', 'marginfi', 'nosana',
        'access-protocol', 'meanfi', 'star-atlas', 'stepn', 'audius',
        'bonfida', 'serum', 'mango-markets', 'lido-staked-sol', 'jito-staked-sol',
      ].slice(0, limit);

      const response = await axios.get<CoinGeckoMarketItem[]>(
        `${this.baseUrl}/coins/markets`,
        {
          params: {
            vs_currency: 'usd',
            ids: solanaIds.join(','),
            order: 'volume_desc',
            per_page: limit,
            page: 1,
            sparkline: false,
            price_change_percentage: '1h,24h',
          },
          headers: this.headers,
          timeout: 15_000,
        }
      );

      const tokens: TokenData[] = response.data.map((coin) => ({
        mint: coin.id, // CoinGecko ID — observe.ts maps these to mints
        symbol: coin.symbol.toUpperCase(),
        name: coin.name,
        priceUsd: coin.current_price ?? 0,
        priceChange1h: coin.price_change_percentage_1h_in_currency ?? 0,
        priceChange24h: coin.price_change_percentage_24h ?? 0,
        volume24h: coin.total_volume ?? 0,
        volumeChange24h: 0,
        marketCap: coin.market_cap ?? 0,
        liquidity: coin.total_volume ?? 0, // rough proxy — CG doesn't expose on-chain liquidity
        holderCount: 0,
        createdAt: coin.atl_date ? new Date(coin.atl_date).getTime() : 0,
      }));

      logger.info(`getSolanaTokenMarkets: fetched ${tokens.length} tokens`);
      return tokens;
    } catch (err) {
      logger.warn(`getSolanaTokenMarkets failed: ${err}`);
      return [];
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
