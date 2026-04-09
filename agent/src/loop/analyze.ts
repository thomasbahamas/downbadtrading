/**
 * analyze.ts — ANALYZE node.
 *
 * Multi-layer cost optimization:
 *  1. Deterministic pre-filter — skip LLM entirely in dead markets
 *  2. Material change detection — cache no-trade, skip if nothing moved
 *  3. Haiku screening — cheap first pass on top tokens
 *  4. Sonnet full analysis — only called when Haiku flags something
 *
 * On quiet days, layers 1-2 handle ~80% of loops at $0 LLM cost.
 * Layer 3 catches another 15% for ~$0.001/call.
 * Layer 4 (Sonnet) only fires when there's a real opportunity.
 *
 * Returns: { thesis } (null = no-trade)
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type { AgentState, AgentConfig, TradeThesis, MarketSnapshot, Portfolio } from '../types';
import { logActivity } from '../db/activity';
import { createLogger } from '../utils/logger';

const logger = createLogger('analyze');

// ─── Market state cache (module-level, persists across loops) ─────────────

interface MarketStateCache {
  fearGreedIndex: number;
  tokenPrices: Map<string, number>;
  hadCexListings: boolean;
  noTradeReason: string | null;
  timestamp: number;
}

let lastMarketState: MarketStateCache | null = null;
let consecutiveSkips = 0;
const MAX_CONSECUTIVE_SKIPS = 5; // Force a full check every 5 skips (~15 min at 3-min loops)

// ─── Deterministic pre-filter thresholds ──────────────────────────────────

const EXTREME_FEAR_THRESHOLD = 20;
const HOT_TOKEN_MOVE_PCT = 5;          // 5% 1h move = worth looking at
const MATERIAL_PRICE_CHANGE_PCT = 0.03; // 3% price move = material change
const MATERIAL_FG_SHIFT = 5;           // 5-point F&G shift = material change

// ─── Layer 1: Deterministic pre-filter ────────────────────────────────────
// No LLM call at all — pure code decision

function shouldSkipAnalysis(snapshot: MarketSnapshot): { skip: boolean; reason: string } {
  const fg = snapshot.globalMetrics.fearGreedIndex;
  const hasHotToken = snapshot.tokens.some(
    (t) => Math.abs(t.priceChange1h) > HOT_TOKEN_MOVE_PCT
  );
  const hasCexListing = (snapshot.newListings?.length ?? 0) > 0;

  if (fg > 0 && fg < EXTREME_FEAR_THRESHOLD && !hasHotToken && !hasCexListing) {
    return {
      skip: true,
      reason: `Extreme fear (F&G=${fg}), no ${HOT_TOKEN_MOVE_PCT}%+ movers, no CEX listings`,
    };
  }

  return { skip: false, reason: '' };
}

// ─── Layer 2: Material change detection ───────────────────────────────────
// Reuse cached no-trade if nothing material changed

function hasMarketChanged(snapshot: MarketSnapshot, cached: MarketStateCache): boolean {
  // F&G shifted enough
  if (Math.abs(snapshot.globalMetrics.fearGreedIndex - cached.fearGreedIndex) >= MATERIAL_FG_SHIFT) {
    return true;
  }

  // Any token moved 3%+
  for (const token of snapshot.tokens.slice(0, 20)) {
    const oldPrice = cached.tokenPrices.get(token.symbol);
    if (oldPrice && oldPrice > 0) {
      const change = Math.abs((token.priceUsd - oldPrice) / oldPrice);
      if (change >= MATERIAL_PRICE_CHANGE_PCT) return true;
    }
  }

  // New CEX listing appeared
  if ((snapshot.newListings?.length ?? 0) > 0 && !cached.hadCexListings) return true;

  return false;
}

function cacheMarketState(snapshot: MarketSnapshot, noTradeReason: string | null): void {
  const tokenPrices = new Map<string, number>();
  for (const t of snapshot.tokens.slice(0, 30)) {
    tokenPrices.set(t.symbol, t.priceUsd);
  }
  lastMarketState = {
    fearGreedIndex: snapshot.globalMetrics.fearGreedIndex,
    tokenPrices,
    hadCexListings: (snapshot.newListings?.length ?? 0) > 0,
    noTradeReason,
    timestamp: Date.now(),
  };
}

// ─── Layer 3: Haiku screening prompt ──────────────────────────────────────

function buildScreeningPrompt(snapshot: MarketSnapshot): string {
  const tokens = [...snapshot.tokens]
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 15)
    .map((t) => `${t.symbol}: $${t.priceUsd.toPrecision(4)} (1h:${t.priceChange1h?.toFixed(1)}% 24h:${t.priceChange24h?.toFixed(1)}% vol:${formatUsd(t.volume24h)})`);

  let prompt = `Solana token screener. F&G: ${snapshot.globalMetrics.fearGreedIndex}. SOL: $${snapshot.globalMetrics.solPriceUsd.toFixed(2)}.\n\n`;
  prompt += tokens.join('\n');

  if (snapshot.newListings?.length) {
    prompt += `\n\nNEW CEX LISTINGS: ${snapshot.newListings.map((l) => `${l.baseAsset} on ${l.exchange}`).join(', ')}`;
  }

  prompt += `\n\nWhich tokens (if any) show a clear short-term setup? Return JSON: {"tokens":["SYM1"]} or {"tokens":[]}. Be very selective — only flag strong volume + momentum.`;

  return prompt;
}

async function runHaikuScreening(
  snapshot: MarketSnapshot,
  config: AgentConfig
): Promise<string[]> {
  const prompt = buildScreeningPrompt(snapshot);

  try {
    let raw: string;

    if (config.llmProvider === 'anthropic') {
      const client = new Anthropic({ apiKey: config.anthropicApiKey });
      const response = await client.messages.create({
        model: config.anthropicScreeningModel,
        max_tokens: 128,
        messages: [{ role: 'user', content: prompt }],
        system: 'You are a fast market screener. Return only JSON. Be very selective.',
      });
      const block = response.content[0];
      raw = block.type === 'text' ? block.text : '{"tokens":[]}';
    } else {
      const client = new OpenAI({ apiKey: config.openaiApiKey });
      const response = await client.chat.completions.create({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: 'You are a fast market screener. Return only JSON. Be very selective.' },
          { role: 'user', content: prompt },
        ],
        max_tokens: 128,
        response_format: { type: 'json_object' },
      });
      raw = response.choices[0].message.content || '{"tokens":[]}';
    }

    const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim();
    const parsed = JSON.parse(cleaned);
    const flagged = Array.isArray(parsed.tokens) ? parsed.tokens as string[] : [];

    logger.info(`ANALYZE: Haiku screening flagged ${flagged.length} tokens: ${flagged.join(', ') || 'none'}`);
    return flagged;
  } catch (err) {
    logger.warn(`ANALYZE: Haiku screening failed: ${err instanceof Error ? err.message : String(err)}`);
    // On screening failure, fall through to full analysis
    return ['FALLBACK'];
  }
}

// ─── Layer 4: Full Sonnet analysis (existing logic, optimized) ────────────

function buildSystemPrompt(): string {
  return `You are a senior portfolio manager at a quantitative trading firm specializing in Solana DeFi markets. You write with precision and authority. Your job is to analyze on-chain market data, identify high-confidence short-term trading opportunities, and produce institutional-grade trade recommendations.

## Your constraints
- Only suggest trades on Solana tokens with sufficient liquidity (>$50k USD)
- Jupiter has a $10 minimum order size. Your positionSizePct MUST result in at least $10 given the available capital. For small portfolios, use a higher percentage (15-25%).
- Focus on tokens showing clear technical or on-chain signals
- You must provide specific, measurable price targets
- Risk/reward ratio MUST be at least 1.5:1 — your TP should be at least 1.5x further from entry than your SL. E.g. entry=$1.00, SL=$0.92 (8% risk) → TP must be ≥$1.12 (12% reward). This is a hard requirement — trades below 1.5 R/R will be automatically rejected.
- If no clear opportunity exists, return a no-trade signal

## Output format
You MUST return valid JSON matching exactly one of these schemas:

### Trade signal:
{
  "signal": "trade",
  "token": { "symbol": "...", "mint": "...", "name": "..." },
  "direction": "buy",
  "entryPriceUsd": 1.234,
  "takeProfitUsd": 1.420,
  "stopLossUsd": 1.134,
  "positionSizePct": 5,
  "confidenceScore": 0.82,
  "reasoning": "PROFESSIONAL ANALYSIS (see writing guidelines below)",
  "signals": {
    "priceAction": "Specific technical observation with price levels",
    "volume": "Quantified volume analysis relative to averages",
    "socialSentiment": "Current market positioning and sentiment read",
    "onChainMetrics": "Specific on-chain data points supporting the thesis"
  }
}

### No-trade signal:
{
  "signal": "no_trade",
  "reason": "Brief reason why no trade is recommended now"
}

## Writing guidelines for the "reasoning" field
Write a single polished paragraph (4-6 sentences) as a senior trader would in a morning research note. This paragraph will be published on a public dashboard. Requirements:
- Open with the specific setup or pattern you identified (e.g. "accumulation at support", "breakout from consolidation", "volume divergence")
- Reference concrete data points from the snapshot (price levels, volume multiples, percentage changes, holder counts)
- Explain WHY now is the entry — what catalyst or confluence makes this the right moment
- State the risk/reward in plain terms (e.g. "risking 6.8% for a 10.2% upside")
- Write with conviction — no hedging words like "might" or "could potentially"
- Sound like Bloomberg or a prop desk research note, not a chatbot

## Writing guidelines for the "signals" fields
Each signal field should be a specific, data-backed observation — not generic. Examples:
- priceAction: "Consolidating at $2.02 support after -15% pullback; 1h candles printing higher lows since 14:00 UTC"
- volume: "24h volume $4.2M is 2.1x the 7-day average; buy/sell ratio 1.15 indicating net accumulation"
- socialSentiment: "Fear & Greed at 35 (fear); contrarian opportunity as retail exits while smart money accumulates"
- onChainMetrics: "Top 10 holders increased positions by 1.2% in 24h; exchange outflows exceed inflows by $800K"

## Signal weighting (in order of priority)
1. **NEW CEX LISTINGS** (highest priority): When a token gets newly listed on Binance, Coinbase, Robinhood, Backpack, or Gemini, this is often your strongest signal. New listings frequently see 20-100%+ pumps. Set confidence high (0.8+), TP aggressive (15-30%), SL tighter (5-8%).
2. On-chain: whale movements, holder growth, large transfers vs. exchange deposits
3. Volume: volume spikes relative to 24h average, buy/sell volume ratio
4. Price action: trend, support/resistance, momentum
5. Sentiment: social signals (low weight — easily manipulated)

Do not suggest meme coins under 24 hours old unless volume is exceptional (>$5M in 1h).

## Important behavioral notes
- Even in extreme fear/greed markets, there are opportunities — contrarian entries during extreme fear can have excellent risk/reward
- Missing data fields (buy/sell ratio = "n/a", volumeChange = "0%") are expected for some data sources — do not refuse to trade solely because a field is unavailable. Work with what you have and note any data limitations in your analysis.
- If you see 3+ tokens with strong price action and healthy volume, pick the best one rather than defaulting to no-trade

Return ONLY the JSON object — no preamble, no explanation, no markdown code fences.`;
}

function buildUserPrompt(
  snapshot: MarketSnapshot,
  portfolio: Portfolio,
  focusTokens?: string[]
): string {
  let tokenList = [...snapshot.tokens]
    .sort((a, b) => b.volume24h - a.volume24h);

  // If Haiku flagged specific tokens, prioritize those but include a few extra for context
  if (focusTokens && focusTokens.length > 0 && !focusTokens.includes('FALLBACK')) {
    const flagged = tokenList.filter((t) =>
      focusTokens.includes(t.symbol)
    );
    const others = tokenList.filter((t) =>
      !focusTokens.includes(t.symbol)
    ).slice(0, 5);
    tokenList = [...flagged, ...others];
  }

  const topTokens = tokenList
    .slice(0, 10)
    .map((t) => ({
      symbol: t.symbol,
      mint: t.mint,
      price: t.priceUsd,
      change1h: t.priceChange1h?.toFixed(2) + '%',
      change24h: t.priceChange24h?.toFixed(2) + '%',
      vol24h: formatUsd(t.volume24h),
      volChange: t.volumeChange24h?.toFixed(0) + '%',
      mcap: formatUsd(t.marketCap),
      liquidity: formatUsd(t.liquidity),
      holders: t.holderCount,
      ageHours: Math.round((Date.now() - t.createdAt) / 3600000),
      buySellRatio:
        t.buyVolume24h && t.sellVolume24h
          ? (t.buyVolume24h / t.sellVolume24h).toFixed(2)
          : 'n/a',
    }));

  const recentEvents = snapshot.recentEvents.slice(0, 5).map((e) => ({
    type: e.type,
    token: e.tokenSymbol || e.token.slice(0, 8),
    details: e.details,
  }));

  const portfolioSummary = {
    totalValueUsd: portfolio.totalValueUsd,
    availableUsd: portfolio.usdcBalance + portfolio.solBalance * (snapshot.globalMetrics.solPriceUsd || 0),
    dailyPnlPct: portfolio.dailyPnlPct,
    openPositions: portfolio.holdings.length,
  };

  const prompt: Record<string, unknown> = {
    timestamp: new Date(snapshot.timestamp).toISOString(),
    portfolio: portfolioSummary,
    globalMetrics: snapshot.globalMetrics,
    tokens: topTokens,
    recentEvents,
  };

  if (snapshot.newListings?.length > 0) {
    prompt.NEW_CEX_LISTINGS = snapshot.newListings.map((l) => ({
      exchange: l.exchange,
      baseAsset: l.baseAsset,
      quoteAsset: l.quoteAsset,
      detectedMinutesAgo: Math.round((Date.now() - l.detectedAt) / 60000),
    }));
  }

  let header =
    `Analyze the following Solana market data and identify the single best trade opportunity, ` +
    `or return a no-trade signal if conditions don't warrant a position.\n\n` +
    `Portfolio: $${portfolio.totalValueUsd.toFixed(0)} total, ` +
    `$${portfolioSummary.availableUsd.toFixed(0)} available, ` +
    `${portfolioSummary.openPositions} open positions\n\n`;

  if (focusTokens && focusTokens.length > 0 && !focusTokens.includes('FALLBACK')) {
    header += `*** SCREENER FLAGGED: ${focusTokens.join(', ')} — prioritize these ***\n\n`;
  }

  if (snapshot.newListings?.length > 0) {
    header += `*** NEW CEX LISTING(S) DETECTED — CHECK IF ANY MATCH SOLANA TOKENS BELOW ***\n\n`;
  }

  return header + `Market data:\n${JSON.stringify(prompt, null, 2)}`;
}

// ─── LLM call ─────────────────────────────────────────────────────────────

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  config: AgentConfig,
  model?: string
): Promise<string> {
  if (config.llmProvider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: model ?? config.anthropicModel,
      max_tokens: 1024,
      messages: [{ role: 'user', content: userPrompt }],
      system: systemPrompt,
    });
    const block = response.content[0];
    if (block.type !== 'text') throw new Error('Unexpected Anthropic response type');
    return block.text;
  } else {
    const client = new OpenAI({ apiKey: config.openaiApiKey });
    const response = await client.chat.completions.create({
      model: config.openaiModel,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      max_tokens: 1024,
      response_format: { type: 'json_object' },
    });
    return response.choices[0].message.content || '{"signal":"no_trade","reason":"Empty LLM response"}';
  }
}

// ─── Parse LLM response ───────────────────────────────────────────────────

function parseLLMResponse(
  raw: string,
  snapshot: MarketSnapshot,
  config: AgentConfig,
  portfolio: Portfolio
): TradeThesis | null {
  let parsed: Record<string, unknown>;
  try {
    const cleaned = raw.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    logger.error(`Failed to parse LLM JSON: ${raw.slice(0, 200)}`);
    return null;
  }

  if (parsed.signal === 'no_trade') {
    logger.info(`LLM: no-trade signal. Reason: ${parsed.reason}`);
    return null;
  }

  if (parsed.signal !== 'trade') {
    logger.warn(`LLM: unexpected signal value: ${parsed.signal}`);
    return null;
  }

  const tokenIn = parsed.token as { symbol: string; mint: string; name: string };

  const entryPrice = Number(parsed.entryPriceUsd);
  const tp = Number(parsed.takeProfitUsd);
  const sl = Number(parsed.stopLossUsd);
  const positionPct = Number(parsed.positionSizePct);
  const confidence = Number(parsed.confidenceScore);

  if (!entryPrice || !tp || !sl || tp <= sl) {
    logger.warn(`LLM: invalid price targets — entry=${entryPrice} tp=${tp} sl=${sl}`);
    return null;
  }
  if (confidence < 0 || confidence > 1) {
    logger.warn(`LLM: invalid confidence score: ${confidence}`);
    return null;
  }

  const direction = parsed.direction as 'buy' | 'sell';
  const riskRewardRatio = Math.abs(tp - entryPrice) / Math.abs(entryPrice - sl);
  const availableUsd = portfolio.usdcBalance + portfolio.solBalance * (snapshot.globalMetrics.solPriceUsd || 0);
  const rawSize = (positionPct / 100) * availableUsd;
  const positionSizeUsd = Math.min(
    Math.max(rawSize, 10),
    config.maxAutoTradeUsd
  );

  const thesis: TradeThesis = {
    id: uuidv4(),
    timestamp: Date.now(),
    token: tokenIn,
    direction,
    entryPriceUsd: entryPrice,
    takeProfitUsd: tp,
    stopLossUsd: sl,
    positionSizeUsd,
    positionSizePct: positionPct,
    confidenceScore: confidence,
    reasoning: String(parsed.reasoning),
    signals: (parsed.signals as TradeThesis['signals']) || {
      priceAction: '',
      volume: '',
      socialSentiment: '',
      onChainMetrics: '',
    },
    riskRewardRatio,
  };

  logger.info(
    `LLM thesis: ${direction.toUpperCase()} ${tokenIn.symbol} @ $${entryPrice} ` +
      `TP=$${tp} SL=$${sl} RR=${riskRewardRatio.toFixed(2)} confidence=${confidence}`
  );

  return thesis;
}

// ─── Node ─────────────────────────────────────────────────────────────────

export async function analyzeNode(
  state: AgentState,
  config: AgentConfig,
  _runConfig?: unknown
): Promise<Partial<AgentState>> {
  if (!state.marketSnapshot) {
    logger.warn('ANALYZE: no market snapshot available, skipping');
    return { thesis: null };
  }

  const snapshot = state.marketSnapshot;

  // ── Layer 1: Deterministic pre-filter ─────────────────────────────
  const preFilter = shouldSkipAnalysis(snapshot);
  if (preFilter.skip && consecutiveSkips < MAX_CONSECUTIVE_SKIPS) {
    consecutiveSkips++;
    logger.info(`ANALYZE: skipped (deterministic) — ${preFilter.reason} [skip ${consecutiveSkips}/${MAX_CONSECUTIVE_SKIPS}]`);
    await logActivity(config, 'no_trade',
      `No trade: ${preFilter.reason}`,
      `Skipped LLM — deterministic filter (${consecutiveSkips} consecutive skips)`,
      undefined,
      { tokensAnalyzed: snapshot.tokens.length, skipReason: 'deterministic_filter' }
    );
    cacheMarketState(snapshot, preFilter.reason);
    return { thesis: null };
  }

  // ── Layer 2: Material change detection ────────────────────────────
  if (
    lastMarketState?.noTradeReason &&
    !hasMarketChanged(snapshot, lastMarketState) &&
    consecutiveSkips < MAX_CONSECUTIVE_SKIPS
  ) {
    consecutiveSkips++;
    logger.info(
      `ANALYZE: skipped (no material change) — reusing: "${lastMarketState.noTradeReason}" ` +
        `[skip ${consecutiveSkips}/${MAX_CONSECUTIVE_SKIPS}]`
    );
    await logActivity(config, 'no_trade',
      `No trade: ${lastMarketState.noTradeReason} (cached — no material change)`,
      `Skipped LLM — market unchanged since last analysis`,
      undefined,
      { tokensAnalyzed: snapshot.tokens.length, skipReason: 'no_material_change' }
    );
    return { thesis: null };
  }

  // Reset skip counter — we're doing a real analysis
  consecutiveSkips = 0;

  logger.info('ANALYZE: market changed or forced check — running LLM pipeline…');

  try {
    // ── Layer 3: Haiku screening ──────────────────────────────────────
    const flaggedTokens = await runHaikuScreening(snapshot, config);

    if (flaggedTokens.length === 0) {
      // Haiku says nothing interesting — skip Sonnet entirely
      const noTradeReason = 'Screening found no actionable setups';
      logger.info(`ANALYZE: Haiku found nothing, skipping Sonnet`);
      await logActivity(config, 'no_trade',
        `No trade: ${noTradeReason}`,
        `Haiku screened ${snapshot.tokens.length} tokens — none flagged`,
        undefined,
        { tokensAnalyzed: snapshot.tokens.length, skipReason: 'haiku_no_flags' }
      );
      cacheMarketState(snapshot, noTradeReason);
      return { thesis: null };
    }

    // ── Layer 4: Sonnet full analysis ─────────────────────────────────
    logger.info(`ANALYZE: Haiku flagged ${flaggedTokens.join(', ')} — calling Sonnet for full analysis`);

    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(snapshot, state.portfolio, flaggedTokens);

    const rawResponse = await callLLM(systemPrompt, userPrompt, config);
    const thesis = parseLLMResponse(rawResponse, snapshot, config, state.portfolio);

    if (thesis) {
      await logActivity(config, 'thesis',
        `Generated thesis: BUY ${thesis.token.symbol} @ $${thesis.entryPriceUsd.toFixed(4)}`,
        thesis.reasoning, thesis.token.symbol,
        { confidence: thesis.confidenceScore, rr: thesis.riskRewardRatio, tp: thesis.takeProfitUsd, sl: thesis.stopLossUsd }
      );
      // Clear no-trade cache since we have a thesis
      cacheMarketState(snapshot, null);
    } else {
      let noTradeReason = 'No clear opportunity identified';
      try {
        const cleaned = rawResponse.replace(/^```[a-z]*\n?/gm, '').replace(/^```$/gm, '').trim();
        const parsed = JSON.parse(cleaned);
        if (parsed.reason) noTradeReason = String(parsed.reason);
      } catch { /* use default */ }
      await logActivity(config, 'no_trade',
        `No trade: ${noTradeReason}`,
        `Sonnet analyzed flagged tokens (${flaggedTokens.join(', ')}) — passed`,
        undefined,
        { tokensAnalyzed: snapshot.tokens.length, flaggedTokens, skipReason: 'sonnet_no_trade' }
      );
      cacheMarketState(snapshot, noTradeReason);
    }

    return { thesis };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`ANALYZE failed: ${message}`);
    return { thesis: null, error: `analyze: ${message}` };
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────

function formatUsd(n: number): string {
  if (n >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `$${(n / 1_000).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}
