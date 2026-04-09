/**
 * observe.ts — OBSERVE node.
 *
 * Collects market data from all data sources, builds a MarketSnapshot,
 * and fetches the current on-chain portfolio state.
 *
 * Primary token data: CoinGecko /coins/markets (Solana ecosystem)
 * Supplemental: Pyth oracle prices, Helius on-chain events
 *
 * Returns: { marketSnapshot, portfolio }
 */

import type { AgentState, AgentConfig, MarketSnapshot, TokenData, Portfolio, Position } from '../types';
import { CoinGeckoClient } from '../data/coingecko';
import { PythClient } from '../data/pyth';
import { HeliusClient } from '../data/helius';
import { scanCEXListings } from '../data/cex-listings';
import { TradingWallet } from '../wallet/trading';
import { TradeRepository } from '../db/trades';
import { logActivity } from '../db/activity';
import { createLogger } from '../utils/logger';

const logger = createLogger('observe');

// ─── CoinGecko ID → Solana mint mapping ──────────────────────────────────
// CoinGecko returns coin IDs (e.g. "solana"), not mint addresses.
// Map the major ones so the rest of the pipeline can reference mints.

const COINGECKO_ID_TO_MINT: Record<string, string> = {
  solana: 'So11111111111111111111111111111111111111112',
  'usd-coin': 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
  tether: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB',
  'wormhole-ethereum': '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs',
  'msol': 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So',
  jupiter: 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN',
  'jupiter-perpetuals-liquidity-provider-token': '27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4',
  blazestake: 'bSo13r4TkiE4KumL71LsHTPpL2euBYLFx6h9HP3piy1',
  raydium: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R',
  orca: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE',
  bonk: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
  'render-token': 'rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof',
  pyth: 'HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3',
  jito: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn',
  marinade: 'MNDEFzGvMt87ueuHvVU9VcTqsAP5b3fTGPsHuuPA5ey',
  tensor: 'TNSRxcUxoT9xBG3de7PiJyTDYu7kskLqcpddxnEJAS6',
  parcl: 'PARCLfHgFJBjKarK9YLo3g4Ln9i7VpZpPAJoB4tquua',
  sanctum: 'SANDrkY3p95a6MUzp7KhpqP4e4yEiHQ8VRj5s3bFEDW',
  wif: 'EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm',
  popcat: '7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr',
  hyperliquid: '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
  'wormhole-bridged-hype': '98sMhvDwXj1RQi5c5Mndm3vPe9cBqPrbLaufMXFNMh5g',
  zcash: 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
  'omnibridge-bridged-zcash-solana': 'A7bdiYdS5GjqGFtxf17ppRHtDKPkkRqbKtR27dxvQXaS',
};

// ─── Node ─────────────────────────────────────────────────────────────────

export async function observeNode(
  state: AgentState,
  config: AgentConfig,
  _runConfig?: unknown
): Promise<Partial<AgentState>> {
  logger.info('OBSERVE: collecting market data…');
  const startTime = Date.now();

  const coingecko = new CoinGeckoClient(config);
  const pyth = new PythClient(config);
  const helius = new HeliusClient(config);
  const wallet = new TradingWallet(config);
  const db = new TradeRepository(config);

  try {
    // ── Sync open positions from Supabase (source of truth) ───────────
    // This ensures deleted/closed positions don't linger in memory
    let syncedPositions: Position[] = state.activePositions;
    try {
      syncedPositions = await db.getOpenPositions();
      if (syncedPositions.length !== state.activePositions.length) {
        logger.info(`OBSERVE: synced positions from DB — ${syncedPositions.length} open (was ${state.activePositions.length} in memory)`);
      }
    } catch (syncErr) {
      logger.debug(`OBSERVE: position sync failed, using in-memory state: ${syncErr instanceof Error ? syncErr.message : String(syncErr)}`);
    }

    // ── Run data fetches in parallel ────────────────────────────────────
    const [portfolio, cgTokens, globalMetrics, recentEvents, cexListings] = await Promise.allSettled([
      fetchPortfolio(wallet),
      coingecko.getSolanaTokenMarkets(100),
      coingecko.getGlobalMetrics(),
      helius.getRecentEvents(50),
      scanCEXListings(),
    ]);

    let resolvedPortfolio =
      portfolio.status === 'fulfilled' ? portfolio.value : state.portfolio;

    // In paper trade mode, simulate starting capital if wallet is empty
    if (config.paperTrade && resolvedPortfolio.usdcBalance === 0 && resolvedPortfolio.holdings.length === 0) {
      const paperCapital = config.maxAutoTradeUsd * 5; // 5x max trade = $2500 simulated
      resolvedPortfolio = {
        ...resolvedPortfolio,
        usdcBalance: paperCapital,
        totalValueUsd: paperCapital,
      };
      logger.info(`OBSERVE: paper trade mode — simulated $${paperCapital} USDC balance`);
    }
    const resolvedCgTokens =
      cgTokens.status === 'fulfilled' ? cgTokens.value : [];
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
    const resolvedListings = cexListings.status === 'fulfilled' ? cexListings.value : [];

    // ── Map CoinGecko tokens to TokenData with Solana mints ─────────────
    const tokenDataList: TokenData[] = resolvedCgTokens.map((t) => {
      const knownMint = COINGECKO_ID_TO_MINT[t.mint]; // t.mint holds CG id from getSolanaTokenMarkets
      return {
        ...t,
        mint: knownMint || t.mint, // use real mint if known, else CG id as fallback
      };
    });

    // ── Augment with Pyth prices where available ────────────────────────
    const tokenDataWithPyth = await pyth.augmentWithPythPrices(tokenDataList);

    // Build trending list from top volume tokens
    const trendingTokens = tokenDataWithPyth
      .sort((a, b) => b.volume24h - a.volume24h)
      .slice(0, 10)
      .map((t) => t.mint);

    if (resolvedListings.length > 0) {
      logger.info(`OBSERVE: ${resolvedListings.length} new CEX listing(s) detected!`);
      for (const listing of resolvedListings) {
        await logActivity(config, 'listing',
          `New listing: ${listing.exchange} added ${listing.baseAsset}/${listing.quoteAsset}`,
          undefined, listing.baseAsset,
          { exchange: listing.exchange, quoteAsset: listing.quoteAsset }
        );
      }
    }

    await logActivity(config, 'scan',
      `Scanned ${tokenDataWithPyth.length} Solana tokens across 5 exchanges`,
      `${resolvedEvents.length} on-chain events, ${resolvedListings.length} new listings`,
      undefined,
      { tokensScanned: tokenDataWithPyth.length, events: resolvedEvents.length, newListings: resolvedListings.length }
    );

    const snapshot: MarketSnapshot = {
      timestamp: Date.now(),
      tokens: tokenDataWithPyth,
      globalMetrics: resolvedGlobals,
      trendingTokens,
      recentEvents: resolvedEvents,
      newListings: resolvedListings,
    };

    const elapsed = Date.now() - startTime;
    logger.info(
      `OBSERVE: collected ${snapshot.tokens.length} tokens, ` +
        `${snapshot.recentEvents.length} events in ${elapsed}ms`
    );

    return {
      marketSnapshot: snapshot,
      portfolio: resolvedPortfolio,
      activePositions: syncedPositions,
      lastObserveTime: Date.now(),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`OBSERVE failed: ${message}`);
    return { error: `observe: ${message}` };
  }
}

// ─── Portfolio fetch ──────────────────────────────────────────────────────

async function fetchPortfolio(wallet: TradingWallet): Promise<Portfolio> {
  return wallet.getPortfolio();
}
