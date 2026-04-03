/**
 * position-sizer.ts — Kelly Criterion-informed position sizing.
 *
 * Calculates the optimal position size given:
 *  - Win rate estimate (from historical trades or LLM confidence)
 *  - Avg win / avg loss ratio
 *  - Current portfolio value
 *  - Risk config constraints
 *
 * Uses fractional Kelly (0.25x) to be conservative.
 */

import type { RiskConfig, Portfolio } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('risk/position-sizer');

const KELLY_FRACTION = 0.25; // 25% Kelly — conservative
const MIN_POSITION_USD = 10; // Jupiter minimum

export interface SizingInput {
  portfolioValueUsd: number;
  confidenceScore: number;
  riskRewardRatio: number;
  winRateEstimate?: number; // from historical trades, falls back to confidence
  config: RiskConfig;
}

export interface SizingResult {
  recommendedSizeUsd: number;
  recommendedSizePct: number;
  method: 'kelly' | 'fixed_pct' | 'min';
  reasoning: string;
}

export class PositionSizer {
  /**
   * Returns the recommended position size in USD.
   *
   * Kelly formula: f = (b*p - q) / b
   *   where b = odds (risk/reward), p = win probability, q = (1-p)
   *
   * We use confidenceScore as a proxy for win probability when
   * no historical win rate is available.
   */
  static calculate(input: SizingInput): SizingResult {
    const { portfolioValueUsd, confidenceScore, riskRewardRatio, config } = input;
    const winProb = input.winRateEstimate ?? confidenceScore;
    const lossProb = 1 - winProb;

    // ── Kelly fraction ────────────────────────────────────────────────
    const kellyFraction = (riskRewardRatio * winProb - lossProb) / riskRewardRatio;

    if (kellyFraction <= 0) {
      // Negative Kelly → don't trade
      logger.debug(`Negative Kelly (${kellyFraction.toFixed(3)}) — position zeroed`);
      return {
        recommendedSizeUsd: 0,
        recommendedSizePct: 0,
        method: 'min',
        reasoning: 'Kelly criterion suggests no trade (negative expected value)',
      };
    }

    const fractionalKelly = kellyFraction * KELLY_FRACTION;

    // ── Apply config constraints ──────────────────────────────────────
    const maxPct = Math.min(
      config.maxSingleTokenPct / 100,
      config.maxPortfolioExposurePct / 100
    );
    const cappedKelly = Math.min(fractionalKelly, maxPct);

    const sizeUsd = portfolioValueUsd * cappedKelly;
    const finalSizeUsd = Math.min(
      Math.max(sizeUsd, MIN_POSITION_USD),
      config.maxPerTradeUsd
    );

    const method =
      finalSizeUsd === MIN_POSITION_USD
        ? 'min'
        : cappedKelly < fractionalKelly
        ? 'fixed_pct'
        : 'kelly';

    const reasoning =
      `Kelly=${(kellyFraction * 100).toFixed(1)}% ` +
      `× ${KELLY_FRACTION} = ${(fractionalKelly * 100).toFixed(1)}% ` +
      `→ capped at ${(cappedKelly * 100).toFixed(1)}% ` +
      `= $${finalSizeUsd.toFixed(0)}`;

    logger.debug(reasoning);

    return {
      recommendedSizeUsd: finalSizeUsd,
      recommendedSizePct: finalSizeUsd / portfolioValueUsd,
      method,
      reasoning,
    };
  }

  /**
   * Quick check: is a given USD size acceptable for this portfolio?
   */
  static isAcceptableSize(
    sizeUsd: number,
    portfolioValueUsd: number,
    config: RiskConfig
  ): boolean {
    if (sizeUsd < MIN_POSITION_USD) return false;
    if (sizeUsd > config.maxPerTradeUsd) return false;
    const pct = sizeUsd / portfolioValueUsd;
    if (pct > config.maxSingleTokenPct / 100) return false;
    return true;
  }
}
