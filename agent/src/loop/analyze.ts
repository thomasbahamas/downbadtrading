/**
 * analyze.ts — ANALYZE node.
 *
 * Passes the market snapshot + portfolio context to the LLM.
 * The LLM returns either a TradeThesis (structured JSON) or a
 * no-trade signal.
 *
 * Returns: { thesis } (null = no-trade)
 */

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { v4 as uuidv4 } from 'uuid';
import type { AgentState, AgentConfig, TradeThesis, MarketSnapshot, Portfolio } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('analyze');

// ─── Prompts ──────────────────────────────────────────────────────────────

function buildSystemPrompt(): string {
  return `You are an expert Solana DeFi trading analyst. Your job is to analyze on-chain market 
data and identify high-confidence short-term trading opportunities on the Solana blockchain.

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
  "reasoning": "One to three sentence thesis explaining why this trade makes sense now.",
  "signals": {
    "priceAction": "Breaking out of 4h consolidation with rising OBV",
    "volume": "3x average 24h volume in last 2 hours",
    "socialSentiment": "Neutral",
    "onChainMetrics": "Whale accumulation visible, low exchange deposits"
  }
}

### No-trade signal:
{
  "signal": "no_trade",
  "reason": "Brief reason why no trade is recommended now"
}

## Signal weighting (in order of priority)
1. **NEW CEX LISTINGS** (highest priority): When a token gets newly listed on Binance, Coinbase, Backpack, or Gemini, this is often your strongest signal. New listings frequently see 20-100%+ pumps. Set confidence high (0.8+), TP aggressive (15-30%), SL tighter (5-8%).
2. On-chain: whale movements, holder growth, large transfers vs. exchange deposits
3. Volume: volume spikes relative to 24h average, buy/sell volume ratio
4. Price action: trend, support/resistance, momentum
5. Sentiment: social signals (low weight — easily manipulated)

Do not suggest meme coins under 24 hours old unless volume is exceptional (>$5M in 1h).

## Important behavioral notes
- Even in extreme fear/greed markets, there are opportunities — contrarian entries during extreme fear can have excellent risk/reward
- Missing data fields (buy/sell ratio = "n/a", volumeChange = "0%") are expected for some data sources — do not refuse to trade solely because a field is unavailable
- If you see 3+ tokens with strong price action and healthy volume, pick the best one rather than defaulting to no-trade
- You are a paper trading bot in development — generate trades when the setup is reasonable (confidence ≥ 0.7) so the system can be tested end-to-end

Return ONLY the JSON object — no preamble, no explanation, no markdown code fences.`;
}

function buildUserPrompt(snapshot: MarketSnapshot, portfolio: Portfolio): string {
  // Select top tokens by volume for context (avoid overwhelming the context window)
  const topTokens = [...snapshot.tokens]
    .sort((a, b) => b.volume24h - a.volume24h)
    .slice(0, 20)
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

  const recentEvents = snapshot.recentEvents.slice(0, 10).map((e) => ({
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
    trendingMints: snapshot.trendingTokens.slice(0, 10),
    tokens: topTokens,
    recentEvents,
  };

  // Add CEX listings as high-priority signal
  if (snapshot.newListings?.length > 0) {
    prompt.NEW_CEX_LISTINGS = snapshot.newListings.map((l) => ({
      exchange: l.exchange,
      baseAsset: l.baseAsset,
      quoteAsset: l.quoteAsset,
      detectedMinutesAgo: Math.round((Date.now() - l.detectedAt) / 60000),
    }));
  }

  let header =
    `Analyze the following Solana market data snapshot and identify the single best trade opportunity, ` +
    `or return a no-trade signal if conditions don't warrant a position.\n\n` +
    `Current portfolio: $${portfolio.totalValueUsd.toFixed(0)} total value, ` +
    `$${portfolioSummary.availableUsd.toFixed(0)} available, ` +
    `${portfolioSummary.openPositions} open positions\n\n`;

  if (snapshot.newListings?.length > 0) {
    header += `*** NEW CEX LISTING(S) DETECTED — CHECK IF ANY MATCH SOLANA TOKENS BELOW ***\n\n`;
  }

  return header + `Market data:\n${JSON.stringify(prompt, null, 2)}`;
}

// ─── LLM call ─────────────────────────────────────────────────────────────

async function callLLM(
  systemPrompt: string,
  userPrompt: string,
  config: AgentConfig
): Promise<string> {
  if (config.llmProvider === 'anthropic') {
    const client = new Anthropic({ apiKey: config.anthropicApiKey });
    const response = await client.messages.create({
      model: config.anthropicModel,
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
    // Strip markdown code fences if the model included them
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

  // Find token in snapshot for validation
  const tokenIn = parsed.token as { symbol: string; mint: string; name: string };
  const tokenData = snapshot.tokens.find((t) => t.mint === tokenIn.mint);

  const entryPrice = Number(parsed.entryPriceUsd);
  const tp = Number(parsed.takeProfitUsd);
  const sl = Number(parsed.stopLossUsd);
  const positionPct = Number(parsed.positionSizePct);
  const confidence = Number(parsed.confidenceScore);

  // Sanity checks
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
    Math.max(rawSize, 10), // Jupiter $10 minimum floor
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

  logger.info('ANALYZE: generating trade thesis via LLM…');

  try {
    const systemPrompt = buildSystemPrompt();
    const userPrompt = buildUserPrompt(state.marketSnapshot, state.portfolio);

    const rawResponse = await callLLM(systemPrompt, userPrompt, config);
    const thesis = parseLLMResponse(rawResponse, state.marketSnapshot, config, state.portfolio);

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
