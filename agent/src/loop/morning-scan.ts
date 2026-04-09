/**
 * morning-scan.ts — Daily Top 10 Watchlist Generator.
 *
 * Runs once at 5 AM PST. Performs a deep analysis of the full Solana token
 * universe and produces a ranked watchlist of the 10 best trading candidates
 * for the day. Each entry includes a full thesis, price targets, and signals.
 *
 * Throughout the day, regular loops reference and re-score this watchlist
 * rather than scanning blind each iteration.
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type { AgentConfig, MarketSnapshot, Portfolio, WatchlistEntry } from '../types';
import { WatchlistRepository } from '../db/watchlist';
import { logActivity } from '../db/activity';
import { createLogger } from '../utils/logger';

const logger = createLogger('morning-scan');

// ─── System prompt for the deep daily analysis ───────────────────────────────

function buildMorningScanSystemPrompt(): string {
  return `You are a senior portfolio manager at a quantitative Solana DeFi trading firm. Every morning you produce a ranked watchlist of the 10 best trading candidates for the day.

## Your task
Analyze the full market snapshot and produce exactly 10 ranked trade candidates. Rank #1 is the strongest opportunity, #10 is the weakest (but still tradeable).

## Ranking criteria (in priority order)
1. **NEW CEX LISTINGS** — Freshly listed on major exchanges = highest priority. These see 20-100%+ moves.
2. **Volume + momentum confluence** — High relative volume (vs 24h avg) combined with clear directional momentum.
3. **Social mindshare** — Tokens trending in social buzz with positive sentiment. Top 5 social rank + bullish sentiment = strong signal.
4. **On-chain strength** — Whale accumulation, holder growth, exchange outflows > inflows.
5. **Technical setup** — Clear support/resistance, consolidation breakouts, higher lows.
6. **Risk/reward quality** — Minimum 1.5:1 R/R ratio. Prefer setups with 2:1+ R/R.
7. **Prediction market catalysts** — High-volume crypto prediction markets with extreme probabilities signal upcoming moves.

## Output format
Return a JSON array of exactly 10 objects, ranked 1-10:

[
  {
    "rank": 1,
    "token": { "symbol": "...", "mint": "...", "name": "..." },
    "direction": "buy",
    "entryPriceUsd": 1.234,
    "takeProfitUsd": 1.420,
    "stopLossUsd": 1.134,
    "confidence": 0.85,
    "score": 92.5,
    "thesis": "Professional 4-6 sentence analysis paragraph (see writing guidelines)",
    "signals": {
      "priceAction": "Specific technical observation with price levels",
      "volume": "Quantified volume analysis relative to averages",
      "socialSentiment": "Current market positioning and sentiment read",
      "onChainMetrics": "Specific on-chain data points supporting the thesis"
    }
  }
]

## Writing guidelines for thesis
Write each thesis as a senior trader would in a morning research note:
- Open with the specific setup or catalyst
- Reference concrete data points (price levels, volume multiples, holder counts)
- Explain why TODAY is the day — what makes this actionable now
- State the risk/reward clearly
- Write with conviction — no hedging words

## Score calculation
The "score" field (0-100) represents overall trade quality:
- 90-100: Exceptional setup (CEX listing + volume + social = trifecta)
- 80-89: Strong setup (clear catalyst with volume confirmation)
- 70-79: Good setup (solid technicals/volume but fewer confluences)
- 60-69: Moderate setup (tradeable but fewer confirming signals)

## Constraints
- Only Solana tokens with >$50k liquidity
- Risk/reward must be ≥ 1.5:1 for all entries
- No meme coins under 24h old unless volume >$5M/1h
- Jupiter minimum order is $10 — all entries must be tradeable

Return ONLY the JSON array — no preamble, no markdown fences.`;
}

function buildMorningScanUserPrompt(snapshot: MarketSnapshot, portfolio: Portfolio): string {
  const tokens = [...snapshot.tokens]
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 30)
    .map((t) => ({
      symbol: t.symbol,
      mint: t.mint,
      name: t.name,
      price: t.priceUsd,
      change1h: t.priceChange1h?.toFixed(2) + '%',
      change24h: t.priceChange24h?.toFixed(2) + '%',
      vol24h: formatUsd(t.volume24h),
      volChange: t.volumeChange24h?.toFixed(0) + '%',
      mcap: formatUsd(t.marketCap),
      liquidity: formatUsd(t.liquidity),
      holders: t.holderCount,
      buySellRatio: t.buyVolume24h && t.sellVolume24h
        ? (t.buyVolume24h / t.sellVolume24h).toFixed(2)
        : 'n/a',
    }));

  const prompt: Record<string, unknown> = {
    timestamp: new Date(snapshot.timestamp).toISOString(),
    scanType: 'MORNING_DEEP_SCAN',
    portfolio: {
      totalValueUsd: portfolio.totalValueUsd,
      availableUsd: portfolio.usdcBalance + portfolio.solBalance * (snapshot.globalMetrics.solPriceUsd || 0),
      openPositions: portfolio.holdings.length,
    },
    globalMetrics: snapshot.globalMetrics,
    tokens,
    recentEvents: snapshot.recentEvents.slice(0, 10).map((e) => ({
      type: e.type,
      token: e.tokenSymbol || e.token.slice(0, 8),
      details: e.details,
    })),
  };

  if (snapshot.newListings?.length > 0) {
    prompt.NEW_CEX_LISTINGS = snapshot.newListings.map((l) => ({
      exchange: l.exchange,
      baseAsset: l.baseAsset,
      quoteAsset: l.quoteAsset,
      detectedMinutesAgo: Math.round((Date.now() - l.detectedAt) / 60000),
    }));
  }

  if (snapshot.socialRankings?.length) {
    prompt.socialMindshare = snapshot.socialRankings.slice(0, 15).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      rank: s.rank,
      sentiment: s.sentiment,
      sentimentScore: s.sentimentScore,
    }));
  }

  if (snapshot.predictionSignals?.length) {
    prompt.predictionMarkets = snapshot.predictionSignals.slice(0, 10).map((p) => ({
      market: p.title,
      probability: p.probability,
      volume: p.volume,
    }));
  }

  let header = `=== DAILY MORNING SCAN ===\n`;
  header += `Analyze the full Solana market and produce a ranked Top 10 watchlist for today.\n`;
  header += `Include the BEST 10 trade candidates — ranked by overall opportunity quality.\n\n`;
  header += `Portfolio: $${portfolio.totalValueUsd.toFixed(0)} total, ${portfolio.holdings.length} open positions\n\n`;

  if (snapshot.newListings?.length > 0) {
    header += `*** NEW CEX LISTING(S) DETECTED — PRIORITIZE THESE ***\n\n`;
  }

  return header + `Market data:\n${JSON.stringify(prompt, null, 2)}`;
}

// ─── LLM call ─────────────────────────────────────────────────────────────────

interface RawWatchlistCandidate {
  rank: number;
  token: { symbol: string; mint: string; name: string };
  direction: string;
  entryPriceUsd: number;
  takeProfitUsd: number;
  stopLossUsd: number;
  confidence: number;
  score: number;
  thesis: string;
  signals: {
    priceAction: string;
    volume: string;
    socialSentiment: string;
    onChainMetrics: string;
  };
}

async function callLLMForWatchlist(
  systemPrompt: string,
  userPrompt: string,
  config: AgentConfig
): Promise<RawWatchlistCandidate[]> {
  let raw: string;

  if (config.llmProvider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 4096,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });
    const block = response.content[0];
    raw = block.type === 'text' ? block.text : '[]';
  } else {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 4096,
      response_format: { type: 'json_object' },
    });
    raw = response.choices[0].message.content || '[]';
  }

  const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim();
  const parsed = JSON.parse(cleaned);
  const candidates: RawWatchlistCandidate[] = Array.isArray(parsed) ? parsed : parsed.watchlist ?? parsed.candidates ?? [];

  return candidates
    .filter((c) => c.token?.symbol && c.entryPriceUsd > 0 && c.takeProfitUsd > c.stopLossUsd)
    .slice(0, 10);
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Run the full morning scan. Requires an already-collected MarketSnapshot.
 * Writes results to daily_watchlist table and logs activity.
 */
export async function runMorningScan(
  snapshot: MarketSnapshot,
  portfolio: Portfolio,
  config: AgentConfig
): Promise<void> {
  logger.info('=== MORNING SCAN STARTING ===');
  const startTime = Date.now();

  try {
    const systemPrompt = buildMorningScanSystemPrompt();
    const userPrompt = buildMorningScanUserPrompt(snapshot, portfolio);

    const candidates = await callLLMForWatchlist(systemPrompt, userPrompt, config);

    if (candidates.length === 0) {
      logger.warn('Morning scan: LLM returned no candidates');
      await logActivity(config, 'no_trade', 'Morning scan: No watchlist candidates identified', 'LLM returned empty watchlist');
      return;
    }

    // Convert to watchlist entries
    const entries = candidates.map((c, idx) => {
      const rrRatio = Math.abs(c.takeProfitUsd - c.entryPriceUsd) / Math.abs(c.entryPriceUsd - c.stopLossUsd);
      return {
        scanDate: '', // Set by repo
        rank: idx + 1,
        token: c.token,
        thesis: c.thesis,
        signals: c.signals,
        confidence: Math.min(Math.max(c.confidence, 0), 1),
        rrRatio,
        entryPriceTarget: c.entryPriceUsd,
        tpTarget: c.takeProfitUsd,
        slTarget: c.stopLossUsd,
        currentPrice: c.entryPriceUsd,
        lastScore: c.score ?? (c.confidence * 100),
        status: 'watching' as const,
      };
    });

    // Write to DB
    const repo = new WatchlistRepository(config);
    await repo.writeMorningScan(entries);

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    const topSymbols = entries.slice(0, 5).map((e) => e.token.symbol).join(', ');

    logger.info(`Morning scan complete in ${elapsed}s — Top 5: ${topSymbols}`);
    await logActivity(
      config,
      'scan',
      `Morning scan: Top 10 watchlist generated`,
      `Top 5: ${topSymbols}. ${candidates.length} candidates ranked from ${snapshot.tokens.length} tokens.`,
      undefined,
      {
        scanType: 'morning_scan',
        candidateCount: candidates.length,
        tokensAnalyzed: snapshot.tokens.length,
        top5: entries.slice(0, 5).map((e) => ({ symbol: e.token.symbol, score: e.lastScore, confidence: e.confidence })),
        elapsedSeconds: parseFloat(elapsed),
      }
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Morning scan failed: ${message}`);
    await logActivity(config, 'error', `Morning scan failed: ${message}`);
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
