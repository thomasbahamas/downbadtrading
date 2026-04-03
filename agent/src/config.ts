/**
 * config.ts — Zod-validated environment configuration.
 *
 * Fails fast at startup if any required variable is missing or invalid.
 * Import `config` (the parsed singleton) everywhere else — never read
 * process.env directly in other files.
 */

import { z } from 'zod';
import * as dotenv from 'dotenv';
import path from 'path';
import type { AgentConfig, RiskConfig } from './types';

// Load .env from project root (two levels up from agent/src/)
dotenv.config({ path: path.resolve(__dirname, '../../.env') });
// Also load agent/.env if present (Railway injects vars directly, but
// useful for local overrides)
dotenv.config({ path: path.resolve(__dirname, '../.env'), override: false });

// ─── Schema ────────────────────────────────────────────────────────────────

const envSchema = z.object({
  // Solana
  SOLANA_PRIVATE_KEY: z.string().min(32, 'Must be a base58-encoded private key'),
  PROFIT_WALLET_ADDRESS: z.string().min(32, 'Must be a valid Solana pubkey'),

  // Helius
  HELIUS_API_KEY: z.string().min(8),
  HELIUS_RPC_URL: z.string().url(),
  HELIUS_WS_URL: z.string().startsWith('wss://'),

  // Jupiter
  JUPITER_API_KEY: z.string().min(8),
  JUPITER_ULTRA_BASE_URL: z.string().url().default('https://api.jup.ag/ultra/v1'),
  JUPITER_TRIGGER_BASE_URL: z.string().url().default('https://api.jup.ag/trigger/v2'),

  // LLM
  LLM_PROVIDER: z.enum(['anthropic', 'openai']).default('anthropic'),
  ANTHROPIC_API_KEY: z.string().default(''),
  ANTHROPIC_MODEL: z.string().default('claude-opus-4-5'),
  OPENAI_API_KEY: z.string().default(''),
  OPENAI_MODEL: z.string().default('gpt-4o'),

  // Market data
  BIRDEYE_API_KEY: z.string().min(1),
  BIRDEYE_BASE_URL: z.string().url().default('https://public-api.birdeye.so'),
  COINGECKO_API_KEY: z.string().min(8),
  COINGECKO_BASE_URL: z.string().url().default('https://api.coingecko.com/api/v3'),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().min(1),
  TELEGRAM_CHAT_ID: z.string().min(1),

  // Supabase
  SUPABASE_URL: z.string().url(),
  SUPABASE_SERVICE_KEY: z.string().min(20),

  // Agent behavior
  MAX_AUTO_TRADE_USD: z.coerce.number().positive().default(500),
  LOOP_INTERVAL_SECONDS: z.coerce.number().int().positive().default(60),

  // Risk parameters
  MAX_PORTFOLIO_EXPOSURE_PCT: z.coerce.number().min(1).max(100).default(30),
  MAX_SINGLE_TOKEN_PCT: z.coerce.number().min(1).max(100).default(10),
  MAX_CONCURRENT_POSITIONS: z.coerce.number().int().min(1).max(20).default(5),
  MIN_CONFIDENCE_SCORE: z.coerce.number().min(0).max(1).default(0.7),
  MIN_LIQUIDITY_USD: z.coerce.number().positive().default(50000),
  MIN_TOKEN_AGE_HOURS: z.coerce.number().nonnegative().default(24),
  DEFAULT_TP_PCT: z.coerce.number().positive().default(15),
  DEFAULT_SL_PCT: z.coerce.number().positive().default(8),
  MAX_DAILY_LOSS_PCT: z.coerce.number().positive().default(5),
  MAX_CONSECUTIVE_LOSSES: z.coerce.number().int().positive().default(3),
  MAX_DRAWDOWN_PCT: z.coerce.number().positive().default(15),
  ORDER_EXPIRY_DAYS: z.coerce.number().int().positive().default(7),

  // System
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug', 'verbose']).default('info'),
  PAPER_TRADE: z
    .string()
    .transform((v) => v === 'true' || v === '1')
    .default('false'),
  PORT: z.coerce.number().int().positive().default(3001),
});

type RawEnv = z.infer<typeof envSchema>;

// ─── Parse ─────────────────────────────────────────────────────────────────

function parseEnv(): RawEnv {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(
      `❌ Environment variable validation failed:\n${issues}\n\nCheck your .env file.`
    );
  }

  // Provider-specific validation
  const data = result.data;
  if (data.LLM_PROVIDER === 'anthropic' && !data.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY is required when LLM_PROVIDER=anthropic');
  }
  if (data.LLM_PROVIDER === 'openai' && !data.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is required when LLM_PROVIDER=openai');
  }

  return data;
}

// ─── Build Config ──────────────────────────────────────────────────────────

function buildConfig(env: RawEnv): AgentConfig {
  const risk: RiskConfig = {
    maxPerTradeUsd: env.MAX_AUTO_TRADE_USD,
    maxPortfolioExposurePct: env.MAX_PORTFOLIO_EXPOSURE_PCT,
    maxSingleTokenPct: env.MAX_SINGLE_TOKEN_PCT,
    maxConcurrentPositions: env.MAX_CONCURRENT_POSITIONS,
    minConfidenceScore: env.MIN_CONFIDENCE_SCORE,
    minLiquidityUsd: env.MIN_LIQUIDITY_USD,
    minTokenAgeHours: env.MIN_TOKEN_AGE_HOURS,
    defaultTpPct: env.DEFAULT_TP_PCT,
    defaultSlPct: env.DEFAULT_SL_PCT,
    maxDailyLossPct: env.MAX_DAILY_LOSS_PCT,
    maxConsecutiveLosses: env.MAX_CONSECUTIVE_LOSSES,
    maxDrawdownPct: env.MAX_DRAWDOWN_PCT,
    orderExpiryDays: env.ORDER_EXPIRY_DAYS,
    // Populate from env if you add BLACKLISTED_MINTS / WHITELISTED_MINTS vars
    blacklistedMints: [],
    whitelistedMints: [],
  };

  return {
    solanaPrivateKey: env.SOLANA_PRIVATE_KEY,
    profitWalletAddress: env.PROFIT_WALLET_ADDRESS,
    heliusApiKey: env.HELIUS_API_KEY,
    heliusRpcUrl: env.HELIUS_RPC_URL,
    heliusWsUrl: env.HELIUS_WS_URL,
    jupiterApiKey: env.JUPITER_API_KEY,
    jupiterUltraBaseUrl: env.JUPITER_ULTRA_BASE_URL,
    jupiterTriggerBaseUrl: env.JUPITER_TRIGGER_BASE_URL,
    llmProvider: env.LLM_PROVIDER,
    anthropicApiKey: env.ANTHROPIC_API_KEY,
    anthropicModel: env.ANTHROPIC_MODEL,
    openaiApiKey: env.OPENAI_API_KEY,
    openaiModel: env.OPENAI_MODEL,
    birdeyeApiKey: env.BIRDEYE_API_KEY,
    birdeyeBaseUrl: env.BIRDEYE_BASE_URL,
    coingeckoApiKey: env.COINGECKO_API_KEY,
    coingeckoBaseUrl: env.COINGECKO_BASE_URL,
    telegramBotToken: env.TELEGRAM_BOT_TOKEN,
    telegramChatId: env.TELEGRAM_CHAT_ID,
    supabaseUrl: env.SUPABASE_URL,
    supabaseServiceKey: env.SUPABASE_SERVICE_KEY,
    maxAutoTradeUsd: env.MAX_AUTO_TRADE_USD,
    loopIntervalSeconds: env.LOOP_INTERVAL_SECONDS,
    risk,
    paperTrade: env.PAPER_TRADE,
    logLevel: env.LOG_LEVEL,
    port: env.PORT,
  };
}

// ─── Singleton ─────────────────────────────────────────────────────────────

let _config: AgentConfig | null = null;

export function getConfig(): AgentConfig {
  if (!_config) {
    const env = parseEnv();
    _config = buildConfig(env);
  }
  return _config;
}

// Convenience named export
export const config = getConfig();
