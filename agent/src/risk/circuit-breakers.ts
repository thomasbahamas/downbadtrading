/**
 * circuit-breakers.ts — Circuit breaker logic.
 *
 * Halts trading automatically when:
 *  - Daily realized loss exceeds MAX_DAILY_LOSS_PCT
 *  - Consecutive losses exceed MAX_CONSECUTIVE_LOSSES
 *  - Portfolio drawdown from peak exceeds MAX_DRAWDOWN_PCT
 *
 * State is persisted in Supabase so it survives agent restarts.
 */

import { createClient, SupabaseClient } from '@supabase/supabase-js';
import type {
  AgentConfig,
  Portfolio,
  Position,
  CircuitBreakerState,
  CircuitBreakerEvent,
} from '../types';
import { TelegramClient } from '../notifications/telegram';
import { createLogger } from '../utils/logger';

const logger = createLogger('risk/circuit-breakers');

// How many minutes to auto-resume after a daily-loss halt
const AUTO_RESUME_MINUTES_DAILY_LOSS = 60 * 24; // resume next trading day
const AUTO_RESUME_MINUTES_CONSECUTIVE = 60 * 4; // resume after 4 hours

const STATE_KEY = 'circuit_breaker_state';

export class CircuitBreakerService {
  private readonly supabase: SupabaseClient;
  private readonly config: AgentConfig;
  private cachedState: CircuitBreakerState | null = null;

  constructor(config: AgentConfig) {
    this.config = config;
    this.supabase = createClient(config.supabaseUrl, config.supabaseServiceKey);
  }

  /**
   * Returns current circuit breaker state.
   * Loads from Supabase on first call, then uses in-memory cache.
   */
  async getState(): Promise<CircuitBreakerState> {
    if (this.cachedState) return this.cachedState;

    const { data, error } = await this.supabase
      .from('circuit_breaker_state')
      .select('*')
      .eq('key', STATE_KEY)
      .single();

    if (error || !data) {
      // First run — initialize state
      this.cachedState = this.defaultState();
      await this.persistState(this.cachedState);
    } else {
      this.cachedState = data.value as CircuitBreakerState;
    }

    return this.cachedState;
  }

  /**
   * Records a closed position and updates breaker state.
   * Call this from monitor.ts after each position close.
   */
  async recordTrade(position: Position): Promise<void> {
    const state = await this.getState();
    const isLoss = (position.realizedPnl ?? 0) < 0;

    const newState: CircuitBreakerState = {
      ...state,
      consecutiveLosses: isLoss ? state.consecutiveLosses + 1 : 0,
    };

    await this.update({ portfolio: null as unknown as Portfolio, tradePosition: position, newState });
  }

  /**
   * Updates daily loss % and drawdown after each portfolio value change.
   * Call from monitor.ts when portfolio changes.
   */
  async update(portfolio: Portfolio): Promise<void>;
  async update(args: {
    portfolio: Portfolio | null;
    tradePosition?: Position;
    newState?: CircuitBreakerState;
  }): Promise<void>;
  async update(
    portfolioOrArgs: Portfolio | { portfolio: Portfolio | null; tradePosition?: Position; newState?: CircuitBreakerState }
  ): Promise<void> {
    const state = await this.getState();

    let newState: CircuitBreakerState;

    if ('totalValueUsd' in portfolioOrArgs) {
      // Called with portfolio directly
      const portfolio = portfolioOrArgs as Portfolio;
      newState = this.recalculate(state, portfolio);
    } else {
      const args = portfolioOrArgs as {
        portfolio: Portfolio | null;
        tradePosition?: Position;
        newState?: CircuitBreakerState;
      };
      newState = args.newState ?? (args.portfolio ? this.recalculate(state, args.portfolio) : state);

      // Override consecutive losses if position was provided
      if (args.tradePosition && !args.newState) {
        const isLoss = (args.tradePosition.realizedPnl ?? 0) < 0;
        newState.consecutiveLosses = isLoss ? newState.consecutiveLosses + 1 : 0;
      }
    }

    // ── Check if we should resume ─────────────────────────────────────
    if (newState.isTradingHalted && newState.resumeAt && Date.now() >= newState.resumeAt) {
      logger.info('Circuit breaker: auto-resuming trading');
      await this.resume(newState, 'Auto-resume time reached');
      return;
    }

    // ── Check if we should halt ───────────────────────────────────────
    if (!newState.isTradingHalted) {
      const haltResult = this.shouldHalt(newState);
      if (haltResult) {
        await this.halt(newState, haltResult.reason, haltResult.resumeMinutes);
        return;
      }
    }

    this.cachedState = newState;
    await this.persistState(newState);
  }

  // ─── Private ────────────────────────────────────────────────────────────

  private recalculate(state: CircuitBreakerState, portfolio: Portfolio): CircuitBreakerState {
    const drawdownFromPeakPct =
      portfolio.peakValueUsd > 0
        ? ((portfolio.peakValueUsd - portfolio.totalValueUsd) / portfolio.peakValueUsd) * 100
        : 0;

    const dailyLossPct = portfolio.dailyPnlPct < 0 ? Math.abs(portfolio.dailyPnlPct) : 0;

    return {
      ...state,
      dailyLossPct,
      drawdownFromPeakPct,
    };
  }

  private shouldHalt(
    state: CircuitBreakerState
  ): { reason: string; resumeMinutes: number } | null {
    const { risk } = this.config;

    if (state.dailyLossPct >= risk.maxDailyLossPct) {
      return {
        reason: `Daily loss limit exceeded: ${state.dailyLossPct.toFixed(1)}% >= ${risk.maxDailyLossPct}%`,
        resumeMinutes: AUTO_RESUME_MINUTES_DAILY_LOSS,
      };
    }

    if (state.consecutiveLosses >= risk.maxConsecutiveLosses) {
      return {
        reason: `${state.consecutiveLosses} consecutive losses (max ${risk.maxConsecutiveLosses})`,
        resumeMinutes: AUTO_RESUME_MINUTES_CONSECUTIVE,
      };
    }

    if (state.drawdownFromPeakPct >= risk.maxDrawdownPct) {
      return {
        reason: `Max drawdown exceeded: ${state.drawdownFromPeakPct.toFixed(1)}% >= ${risk.maxDrawdownPct}%`,
        resumeMinutes: 0, // Manual resume required for drawdown halts
      };
    }

    return null;
  }

  private async halt(
    state: CircuitBreakerState,
    reason: string,
    resumeMinutes: number
  ): Promise<void> {
    const haltedAt = Date.now();
    const resumeAt = resumeMinutes > 0 ? haltedAt + resumeMinutes * 60 * 1000 : undefined;

    const newState: CircuitBreakerState = {
      ...state,
      isTradingHalted: true,
      haltReason: reason,
      haltedAt,
      resumeAt,
    };

    this.cachedState = newState;
    await this.persistState(newState);
    await this.logEvent(newState, 'halt', reason);

    logger.error(`⛔ CIRCUIT BREAKER TRIPPED: ${reason}`);
    const telegram = new TelegramClient(this.config);
    await telegram.sendMessage({
      type: 'circuit_breaker',
      content:
        `⛔ <b>Circuit Breaker Active</b>\n` +
        `Reason: ${reason}\n` +
        (resumeAt
          ? `Auto-resume at: ${new Date(resumeAt).toISOString()}`
          : 'Manual resume required'),
      priority: 'high',
    });
  }

  private async resume(state: CircuitBreakerState, reason: string): Promise<void> {
    const newState: CircuitBreakerState = {
      ...state,
      isTradingHalted: false,
      haltReason: undefined,
      haltedAt: undefined,
      resumeAt: undefined,
      consecutiveLosses: 0,
    };

    this.cachedState = newState;
    await this.persistState(newState);
    await this.logEvent(newState, 'resume', reason);

    logger.info(`✅ Circuit breaker cleared: ${reason}`);
    const telegram = new TelegramClient(this.config);
    await telegram.sendMessage({
      type: 'circuit_breaker',
      content: `✅ <b>Trading Resumed</b>\nReason: ${reason}`,
      priority: 'normal',
    });
  }

  private async persistState(state: CircuitBreakerState): Promise<void> {
    await this.supabase.from('circuit_breaker_state').upsert(
      { key: STATE_KEY, value: state, updated_at: new Date().toISOString() },
      { onConflict: 'key' }
    );
  }

  private async logEvent(
    state: CircuitBreakerState,
    type: 'halt' | 'resume',
    reason: string
  ): Promise<void> {
    await this.supabase.from('circuit_breaker_events').insert({
      type,
      reason,
      daily_loss_pct: state.dailyLossPct,
      consecutive_losses: state.consecutiveLosses,
      drawdown_from_peak_pct: state.drawdownFromPeakPct,
      created_at: new Date().toISOString(),
    });
  }

  private defaultState(): CircuitBreakerState {
    return {
      dailyLossPct: 0,
      consecutiveLosses: 0,
      drawdownFromPeakPct: 0,
      isTradingHalted: false,
    };
  }
}
