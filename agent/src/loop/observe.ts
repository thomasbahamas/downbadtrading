/**
 * observe.ts — OBSERVE node.
 *
 * Collects market data from all data sources, builds a MarketSnapshot,
 * and fetches the current on-chain portfolio state.
 *
 * Returns: { marketSnapshot, portfolio }
 */

import type { AgentState, AgentConfig, MarketSnapshot, Portfolio } from '../types';
import { BirdeyeClient } from '../data/birdeye';
import { CoinGeckoClient } from '../data/coingecko';
import { PythClient } from '../data/pyth';
import { HeliusClient } from '../data/helius';
import { TradingWallet } from '../wallet/trading';
import { createLogger } from '../utils/logger';

const logger = createLogger('observe');

// ─── Tokens to watch ──────────────────────────────────────────────────────
// These are the well-known mints the agent always includes in its universe.
// Birdeye trending tokens are added dynamically each loop.

export const WELL_KNOWN_MINTS: Record<string, { symbol: string; name: string }> = {
  So11111111111111111111111111111111111111112: { symbol: 'SOL', name: 'Solana' },
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: { symbol: 'USDC', name: 'USD Coin' },
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: { symbol: 'USDT', name: 'Tether' },
  '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': { symbol: 'ETH', name: 'Ethereum (Wormhole)' },
  mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So: { symbol: 'mSOL', name: 'Marinade staked SOL' },
  JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN: { symbol: 'JUP', name: 'Jupiter' },
  '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4': { symbol: 'JLP', name: 'Jupiter LP' },
  bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1: { symbol: 'bSOL', name: 'BlazeStake SOL' },
};

// ─── Node ─────────────────────────────────────────────────────────────────

export async function observeNode(
  state: AgentState,
  config: AgentConfig,
  _runConfig?: unknown
): Promise<Partial<AgentState>> {
  logger.info('OBSERVE: collecting market data…');
  const startTime = Date.now();

  const birdeye = new BirdeyeClient(config);
  const coingecko = new CoinGeckoClient(config);
  const pyth = new PythClient(config);
  const helius = new HeliusClient(config);
  const wallet = new TradingWallet(config);

  try {
    // ── Run data fetches in parallel ────────────────────────────────────
    const [portfolio, trendingMints, globalMetrics, recentEvents] = await Promise.allSettled([
      fetchPortfolio(wallet, helius, config.profitWalletAddress),
      birdeye.getTrendingTokens(20),
      coingecko.getGlobalMetrics(),
      helius.getRecentEvents(50),
    ]);

    const resolvedPortfolio =
      portfolio.status === 'fulfilled' ? portfolio.value : state.portfolio;
    const resolvedTrending = trendingMints.status === 'fulfilled' ? trendingMints.value : [];
    const resolvedGlobals =
      globalMetrics.status === 'fulfilled'
        ? globalMetrics.value
        : {
            solPriceUsd: 0,
            solVolume24h: 0,
            totalDexVolume24h: 0,
            fearGreedIndex: 50,
            btcDominancePct: 40,
            totalMarketCapUsd: 0,
          };
    const resolvedEvents = recentEvents.status === 'fulfilled' ? recentEvents.value : [];

    // ── Collect token universe ──────────────────────────────────────────
    const mintsToFetch = new Set<string>([
      ...Object.keys(WELL_KNOWN_MINTS),
      ...resolvedTrending,
      // Also include mints of current holdings
      ...resolvedPortfolio.holdings.map((h) => h.mint),
    ]);

    const tokenDataList = await birdeye.getTokenDataBatch([...mintsToFetch]);

    // ── Augment with Pyth prices where available ────────────────────────
    const tokenDataWithPyth = await pyth.augmentWithPythPrices(tokenDataList);

    const snapshot: MarketSnapshot = {
      timestamp: Date.now(),
      tokens: tokenDataWithPyth,
      globalMetrics: resolvedGlobals,
      trendingTokens: resolvedTrending,
      recentEvents: resolvedEvents,
    };

    const elapsed = Date.now() - startTime;
    logger.info(
      `OBSERVE: collected ${snapshot.tokens.length} tokens, ` +
        `${snapshot.recentEvents.length} events in ${elapsed}ms`
    );

    return {
      marketSnapshot: snapshot,
      portfolio: resolvedPortfolio,
      lastObserveTime: Date.now(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`OBSERVE failed: ${message}`);
    return { error: `observe: ${message}` };
  }
}

// ─── Portfolio fetch ──────────────────────────────────────────────────────

async function fetchPortfolio(
  wallet: TradingWallet,
  _helius: HeliusClient,
  _profitWallet: string
): Promise<Portfolio> {
  // TODO: implement using wallet.getBalances() + wallet.getTokenHoldings()
  // For now, return current wallet state
  return wallet.getPortfolio();
}
