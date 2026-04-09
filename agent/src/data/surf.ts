/**
 * surf.ts — Surf CLI data client.
 *
 * Provides social sentiment and prediction market data via the `surf` CLI.
 * Used to enrich the market snapshot with signals the agent currently lacks:
 *  - Social mindshare/sentiment rankings (which tokens are being talked about)
 *  - Polymarket crypto prediction signals
 *
 * Surf is read-only — no wallet access, no execution.
 * 30 free credits/day without auth, unlimited with API key.
 */

import { execFile } from 'child_process';
import { promisify } from 'util';
import { createLogger } from '../utils/logger';

const logger = createLogger('data/surf');
const execFileAsync = promisify(execFile);

const SURF_BIN = `${process.env.HOME}/.local/bin/surf`;
const SURF_TIMEOUT_MS = 10_000;

// Module-level cache
const surfCache = new Map<string, { data: unknown; expiry: number }>();
const CACHE_TTL_MS = 300_000; // 5 minutes — social data doesn't change fast

function getCached<T>(key: string): T | null {
  const entry = surfCache.get(key);
  if (entry && Date.now() < entry.expiry) return entry.data as T;
  surfCache.delete(key);
  return null;
}

function setCache(key: string, data: unknown): void {
  surfCache.set(key, { data, expiry: Date.now() + CACHE_TTL_MS });
}

// ─── Types ─────────────────────────────────────────────────────────────

export interface SocialRanking {
  symbol: string;
  name: string;
  rank: number;
  sentiment: string;
  sentimentScore: number;
  tags: string[];
}

export interface PredictionMarketSignal {
  title: string;
  outcome: string;
  probability: number;
  volume: number;
  category: string;
}

export interface SurfEnrichment {
  socialRankings: SocialRanking[];
  predictionSignals: PredictionMarketSignal[];
}

// ─── CLI runner ─────────────────────────────────────────────────────────

async function runSurf(args: string[]): Promise<unknown> {
  try {
    const { stdout } = await execFileAsync(SURF_BIN, [...args, '-o', 'json', '-f', 'body.data'], {
      timeout: SURF_TIMEOUT_MS,
      env: { ...process.env, PATH: `${process.env.HOME}/.local/bin:${process.env.PATH}` },
    });
    return JSON.parse(stdout);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.debug(`surf command failed: surf ${args.join(' ')} — ${msg}`);
    return null;
  }
}

// ─── Public API ─────────────────────────────────────────────────────────

/**
 * Fetches social mindshare rankings (top crypto projects by social buzz).
 */
export async function getSocialRankings(limit = 15): Promise<SocialRanking[]> {
  const cached = getCached<SocialRanking[]>('social_rankings');
  if (cached) return cached;

  const data = await runSurf(['social-ranking', '--limit', String(limit), '--time-range', '24h']);
  if (!Array.isArray(data)) return [];

  const rankings: SocialRanking[] = data.map((item: Record<string, unknown>) => {
    const token = item.token as Record<string, unknown> | undefined;
    return {
      symbol: (token?.symbol as string) ?? '',
      name: (token?.name as string) ?? (item.project as Record<string, unknown>)?.name as string ?? '',
      rank: (item.rank as number) ?? 0,
      sentiment: (item.sentiment as string) ?? 'neutral',
      sentimentScore: (item.sentiment_score as number) ?? 0,
      tags: Array.isArray(item.tags) ? item.tags as string[] : [],
    };
  }).filter((r) => r.symbol);

  logger.info(`surf: fetched ${rankings.length} social rankings`);
  setCache('social_rankings', rankings);
  return rankings;
}

/**
 * Fetches social sentiment detail for a specific token/project.
 */
export async function getSocialDetail(query: string): Promise<{ sentiment: string; sentimentScore: number; tweetCount: number } | null> {
  const cacheKey = `social_detail_${query}`;
  const cached = getCached<{ sentiment: string; sentimentScore: number; tweetCount: number }>(cacheKey);
  if (cached) return cached;

  const data = await runSurf(['social-detail', '--q', query, '--time-range', '24h']);
  if (!data || typeof data !== 'object') return null;

  const d = data as Record<string, unknown>;
  const result = {
    sentiment: (d.sentiment as string) ?? 'neutral',
    sentimentScore: (d.sentiment_score as number) ?? 0,
    tweetCount: (d.tweet_count as number) ?? 0,
  };

  setCache(cacheKey, result);
  return result;
}

/**
 * Fetches crypto-related prediction market signals from Polymarket.
 */
export async function getPredictionMarketSignals(): Promise<PredictionMarketSignal[]> {
  const cached = getCached<PredictionMarketSignal[]>('prediction_signals');
  if (cached) return cached;

  const data = await runSurf(['search-prediction-market', '--category', 'crypto', '--status', 'active', '--sort-by', 'volume', '--limit', '10']);
  if (!Array.isArray(data)) return [];

  const signals: PredictionMarketSignal[] = data.map((item: Record<string, unknown>) => ({
    title: (item.title as string) ?? (item.question as string) ?? '',
    outcome: (item.outcome as string) ?? '',
    probability: (item.probability as number) ?? (item.price as number) ?? 0,
    volume: (item.volume as number) ?? (item.total_volume as number) ?? 0,
    category: (item.category as string) ?? 'crypto',
  })).filter((s) => s.title);

  logger.info(`surf: fetched ${signals.length} prediction market signals`);
  setCache('prediction_signals', signals);
  return signals;
}

/**
 * Get all Surf enrichment data in one call (social + prediction markets).
 * Used by observe.ts to enrich the market snapshot.
 */
export async function getSurfEnrichment(): Promise<SurfEnrichment> {
  const [socialRankings, predictionSignals] = await Promise.allSettled([
    getSocialRankings(),
    getPredictionMarketSignals(),
  ]);

  return {
    socialRankings: socialRankings.status === 'fulfilled' ? socialRankings.value : [],
    predictionSignals: predictionSignals.status === 'fulfilled' ? predictionSignals.value : [],
  };
}
