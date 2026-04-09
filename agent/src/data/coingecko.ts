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

// Tokens to always include in scans, even if not in the solana-ecosystem category.
// These get fetched separately and merged into the token list.
const ALWAYS_INCLUDE_IDS = ['hyperliquid', 'zcash', 'wormhole-bridged-hype', 'omnibridge-bridged-zcash-solana'];

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
  async getSolanaTokenMarkets(limit = 100): Promise<TokenData[]> {
    try {
      // Fetch Solana ecosystem tokens by category — CoinGecko's category filter
      // gives us 100+ tokens sorted by volume, much broader than a hardcoded list
      const allTokens: TokenData[] = [];
      const pages = Math.ceil(limit / 100); // CoinGecko max per_page is 250

      for (let page = 1; page <= pages; page++) {
        const perPage = Math.min(100, limit - allTokens.length);
        const response = await axios.get<CoinGeckoMarketItem[]>(
          `${this.baseUrl}/coins/markets`,
          {
            params: {
              vs_currency: 'usd',
              category: 'solana-ecosystem',
              order: 'volume_desc',
              per_page: perPage,
              page,
              sparkline: false,
              price_change_percentage: '1h,24h',
            },
            headers: this.headers,
            timeout: 15_000,
          }
        );

        if (!response.data || response.data.length === 0) break;

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

        allTokens.push(...tokens);

        // Rate limit: CoinGecko free tier allows ~10-30 req/min
        if (page < pages) await new Promise((r) => setTimeout(r, 1500));
      }

      // Fetch always-include tokens that may not be in the solana-ecosystem category
      const existingIds = new Set(allTokens.map((t) => t.mint));
      const missingIds = ALWAYS_INCLUDE_IDS.filter((id) => !existingIds.has(id));

      if (missingIds.length > 0) {
        try {
          await new Promise((r) => setTimeout(r, 1500)); // rate limit
          const supplemental = await axios.get<CoinGeckoMarketItem[]>(
            `${this.baseUrl}/coins/markets`,
            {
              params: {
                vs_currency: 'usd',
                ids: missingIds.join(','),
                order: 'volume_desc',
                sparkline: false,
                price_change_percentage: '1h,24h',
              },
              headers: this.headers,
              timeout: 15_000,
            }
          );

          if (supplemental.data) {
            const extras: TokenData[] = supplemental.data.map((coin) => ({
              mint: coin.id,
              symbol: coin.symbol.toUpperCase(),
              name: coin.name,
              priceUsd: coin.current_price ?? 0,
              priceChange1h: coin.price_change_percentage_1h_in_currency ?? 0,
              priceChange24h: coin.price_change_percentage_24h ?? 0,
              volume24h: coin.total_volume ?? 0,
              volumeChange24h: 0,
              marketCap: coin.market_cap ?? 0,
              liquidity: coin.total_volume ?? 0,
              holderCount: 0,
              createdAt: coin.atl_date ? new Date(coin.atl_date).getTime() : 0,
            }));
            allTokens.push(...extras);
            logger.info(`getSolanaTokenMarkets: added ${extras.length} supplemental tokens (${extras.map(t => t.symbol).join(', ')})`);
          }
        } catch (suppErr) {
          logger.debug(`Supplemental token fetch failed: ${suppErr}`);
        }
      }

      // Filter out tokens with negligible volume
      const filtered = allTokens.filter((t) => t.volume24h >= 10_000);

      logger.info(`getSolanaTokenMarkets: fetched ${allTokens.length} tokens, ${filtered.length} with >$10K volume`);
      return filtered;
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
