/**
 * cex-listings.ts — CEX listing scanner.
 *
 * Polls Binance, Coinbase, Backpack, and Gemini for new trading pairs.
 * On first run, sets baseline. Subsequent runs detect new additions.
 * New listings are passed to the LLM as high-priority buy signals.
 */

import axios from 'axios';
import { createLogger } from '../utils/logger';

const logger = createLogger('data/cex-listings');

export interface CEXListing {
  exchange: string;
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
  detectedAt: number;
}

interface SymbolInfo {
  symbol: string;
  baseAsset: string;
  quoteAsset: string;
}

// Module-level state persists across loop iterations
const knownSymbols: Record<string, Set<string>> = {};
let baselineSet = false;

/**
 * Scans all exchanges for new trading pairs.
 * Returns empty array on first call (baseline), then only new additions.
 */
export async function scanCEXListings(): Promise<CEXListing[]> {
  const scanners: [string, () => Promise<SymbolInfo[]>][] = [
    ['binance', fetchBinanceSymbols],
    ['coinbase', fetchCoinbaseProducts],
    ['backpack', fetchBackpackMarkets],
    ['gemini', fetchGeminiSymbols],
  ];

  const results = await Promise.allSettled(
    scanners.map(async ([exchange, fetcher]) => {
      const symbols = await fetcher();
      return { exchange, symbols };
    })
  );

  const newListings: CEXListing[] = [];

  for (const result of results) {
    if (result.status !== 'fulfilled') continue;
    const { exchange, symbols } = result.value;

    if (!knownSymbols[exchange]) {
      knownSymbols[exchange] = new Set();
    }

    for (const s of symbols) {
      if (!knownSymbols[exchange].has(s.symbol)) {
        if (baselineSet) {
          newListings.push({
            exchange,
            ...s,
            detectedAt: Date.now(),
          });
          logger.info(`NEW LISTING DETECTED: ${exchange} → ${s.baseAsset}/${s.quoteAsset}`);
        }
        knownSymbols[exchange].add(s.symbol);
      }
    }
  }

  if (!baselineSet) {
    baselineSet = true;
    const counts = Object.entries(knownSymbols)
      .map(([e, s]) => `${e}=${s.size}`)
      .join(', ');
    logger.info(`CEX listing baseline: ${counts}`);
  } else if (newListings.length > 0) {
    logger.info(`CEX scan: ${newListings.length} new listing(s) detected`);
  }

  return newListings;
}

// ─── Exchange fetchers ───────────────────────────────────────────────────

async function fetchBinanceSymbols(): Promise<SymbolInfo[]> {
  const { data } = await axios.get('https://api.binance.com/api/v3/exchangeInfo', {
    timeout: 10_000,
  });
  return (data.symbols || [])
    .filter((s: Record<string, unknown>) => s.status === 'TRADING')
    .map((s: Record<string, unknown>) => ({
      symbol: String(s.symbol),
      baseAsset: String(s.baseAsset),
      quoteAsset: String(s.quoteAsset),
    }));
}

async function fetchCoinbaseProducts(): Promise<SymbolInfo[]> {
  const { data } = await axios.get('https://api.exchange.coinbase.com/products', {
    timeout: 10_000,
    headers: { 'User-Agent': 'DownbadTrading/1.0' },
  });
  return (data || [])
    .filter((p: Record<string, unknown>) => !p.trading_disabled)
    .map((p: Record<string, unknown>) => ({
      symbol: `${p.base_currency}-${p.quote_currency}`,
      baseAsset: String(p.base_currency),
      quoteAsset: String(p.quote_currency),
    }));
}

async function fetchBackpackMarkets(): Promise<SymbolInfo[]> {
  const { data } = await axios.get('https://api.backpack.exchange/api/v1/markets', {
    timeout: 10_000,
  });
  return (data || []).map((m: Record<string, unknown>) => ({
    symbol: String(m.symbol),
    baseAsset: String(m.baseSymbol ?? String(m.symbol).split('_')[0]),
    quoteAsset: String(m.quoteSymbol ?? String(m.symbol).split('_')[1]),
  }));
}

async function fetchGeminiSymbols(): Promise<SymbolInfo[]> {
  const { data } = await axios.get('https://api.gemini.com/v1/symbols', {
    timeout: 10_000,
  });
  return (data || []).map((s: string) => {
    // Gemini uses formats like "btcusd", "ethbtc"
    const upper = s.toUpperCase();
    // Common quote currencies
    for (const q of ['USD', 'USDT', 'BTC', 'ETH', 'EUR', 'GBP', 'SGD']) {
      if (upper.endsWith(q)) {
        return {
          symbol: upper,
          baseAsset: upper.slice(0, -q.length),
          quoteAsset: q,
        };
      }
    }
    return { symbol: upper, baseAsset: upper, quoteAsset: 'USD' };
  });
}

/** Returns tracked symbol counts per exchange (for health/debug) */
export function getBaselineCounts(): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const [exchange, symbols] of Object.entries(knownSymbols)) {
    counts[exchange] = symbols.size;
  }
  return counts;
}
