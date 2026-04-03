/**
 * engine.ts — Risk Management Engine.
 *
 * All checks are deterministic code — never LLM judgment.
 * The LLM suggests; the risk engine decides.
 *
 * Checks (in order of evaluation):
 *  1. Blacklist / whitelist
 *  2. Minimum liquidity
 *  3. Minimum token age
 *  4. Confidence score threshold
 *  5. Risk/reward ratio
 *  6. Maximum concurrent positions
 *  7. Single token exposure limit
 *  8. Portfolio exposure cap
 *  9. Position size adjustment (down-size if needed)
 * 10. Minimum order size ($10 Jupiter floor)
 */

import type {
  TradeThesis,
  Portfolio,
  Position,
  MarketSnapshot,
  RiskConfig,
  RiskCheckResult,
} from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('risk/engine');

const JUPITER_MIN_ORDER_USD = 10;
const MIN_RISK_REWARD_RATIO = 1.5;

export interface RiskEvaluationInput {
  thesis: TradeThesis;
  portfolio: Portfolio;
  activePositions: Position[];
  marketSnapshot: MarketSnapshot | null;
}

export interface RiskEvaluationResult {
  approved: boolean;
  reason: string;
  adjustedPositionSizeUsd?: number;
  warnings: string[];
}

export class RiskEngine {
  constructor(private readonly config: RiskConfig) {}

  async evaluate(input: RiskEvaluationInput): Promise<RiskEvaluationResult> {
    const { thesis, portfolio, activePositions, marketSnapshot } = input;
    const warnings: string[] = [];

    // ── 1. Blacklist check ────────────────────────────────────────────
    if (this.config.blacklistedMints.includes(thesis.token.mint)) {
      return this.reject('Token is blacklisted', warnings);
    }

    // ── 2. Whitelist check ────────────────────────────────────────────
    if (
      this.config.whitelistedMints.length > 0 &&
      !this.config.whitelistedMints.includes(thesis.token.mint)
    ) {
      return this.reject('Token is not in whitelist', warnings);
    }

    // ── 3. Token data from snapshot ───────────────────────────────────
    const tokenData = marketSnapshot?.tokens.find((t) => t.mint === thesis.token.mint);

    // ── 4. Minimum liquidity ──────────────────────────────────────────
    if (tokenData) {
      if (tokenData.liquidity < this.config.minLiquidityUsd) {
        return this.reject(
          `Insufficient liquidity: $${tokenData.liquidity.toFixed(0)} < $${this.config.minLiquidityUsd} minimum`,
          warnings
        );
      }
    } else {
      warnings.push('No liquidity data available for token');
    }

    // ── 5. Token age ──────────────────────────────────────────────────
    if (tokenData && tokenData.createdAt > 0) {
      const ageHours = (Date.now() - tokenData.createdAt) / 3_600_000;
      if (ageHours < this.config.minTokenAgeHours) {
        return this.reject(
          `Token too new: ${ageHours.toFixed(1)}h old < ${this.config.minTokenAgeHours}h minimum`,
          warnings
        );
      }
    }

    // ── 6. Confidence score ───────────────────────────────────────────
    if (thesis.confidenceScore < this.config.minConfidenceScore) {
      return this.reject(
        `Confidence score ${thesis.confidenceScore.toFixed(2)} < ${this.config.minConfidenceScore} minimum`,
        warnings
      );
    }

    // ── 7. Risk/reward ratio ──────────────────────────────────────────
    if (thesis.riskRewardRatio < MIN_RISK_REWARD_RATIO) {
      return this.reject(
        `Risk/reward ratio ${thesis.riskRewardRatio.toFixed(2)} < ${MIN_RISK_REWARD_RATIO} minimum`,
        warnings
      );
    }

    // ── 8. TP > SL check (Jupiter OCO requirement) ────────────────────
    if (thesis.takeProfitUsd <= thesis.stopLossUsd) {
      return this.reject(
        `TP ($${thesis.takeProfitUsd}) must be > SL ($${thesis.stopLossUsd})`,
        warnings
      );
    }

    // ── 9. Concurrent positions ───────────────────────────────────────
    if (activePositions.length >= this.config.maxConcurrentPositions) {
      return this.reject(
        `Max concurrent positions reached (${activePositions.length}/${this.config.maxConcurrentPositions})`,
        warnings
      );
    }

    // ── 10. Existing position in same token ───────────────────────────
    const existingPosition = activePositions.find(
      (p) => p.token.mint === thesis.token.mint && p.status === 'open'
    );
    if (existingPosition) {
      return this.reject(
        `Already have an open position in ${thesis.token.symbol}`,
        warnings
      );
    }

    // ── 11. Position size calculation ─────────────────────────────────
    let requestedSizeUsd = thesis.positionSizeUsd;

    // Don't exceed max per-trade limit
    const maxFromConfig = this.config.maxPerTradeUsd;
    if (requestedSizeUsd > maxFromConfig) {
      warnings.push(
        `Position size reduced from $${requestedSizeUsd.toFixed(0)} to $${maxFromConfig} (max per trade)`
      );
      requestedSizeUsd = maxFromConfig;
    }

    // ── 12. Single token exposure cap ────────────────────────────────
    const existingTokenExposure = activePositions
      .filter((p) => p.token.mint === thesis.token.mint)
      .reduce((sum, p) => sum + p.entrySizeUsd, 0);
    const maxSingleTokenUsd =
      (this.config.maxSingleTokenPct / 100) * portfolio.totalValueUsd;

    if (existingTokenExposure + requestedSizeUsd > maxSingleTokenUsd) {
      const allowed = Math.max(0, maxSingleTokenUsd - existingTokenExposure);
      if (allowed < JUPITER_MIN_ORDER_USD) {
        return this.reject(
          `Single token exposure limit reached for ${thesis.token.symbol}`,
          warnings
        );
      }
      warnings.push(
        `Position reduced to $${allowed.toFixed(0)} due to single token exposure cap`
      );
      requestedSizeUsd = allowed;
    }

    // ── 13. Portfolio exposure cap ────────────────────────────────────
    const totalOpenExposure = activePositions.reduce(
      (sum, p) => sum + p.entrySizeUsd,
      0
    );
    const maxPortfolioExposureUsd =
      (this.config.maxPortfolioExposurePct / 100) * portfolio.totalValueUsd;

    if (totalOpenExposure + requestedSizeUsd > maxPortfolioExposureUsd) {
      const allowed = Math.max(0, maxPortfolioExposureUsd - totalOpenExposure);
      if (allowed < JUPITER_MIN_ORDER_USD) {
        return this.reject(
          `Portfolio exposure cap reached (${this.config.maxPortfolioExposurePct}%)`,
          warnings
        );
      }
      warnings.push(
        `Position reduced to $${allowed.toFixed(0)} due to portfolio exposure cap`
      );
      requestedSizeUsd = allowed;
    }

    // ── 14. Available balance ─────────────────────────────────────────
    const availableUsd =
      portfolio.usdcBalance + portfolio.solBalance * (marketSnapshot?.globalMetrics.solPriceUsd ?? 0);
    if (requestedSizeUsd > availableUsd) {
      if (availableUsd < JUPITER_MIN_ORDER_USD) {
        return this.reject(
          `Insufficient balance: $${availableUsd.toFixed(2)} available`,
          warnings
        );
      }
      warnings.push(`Position reduced to $${availableUsd.toFixed(0)} (available balance)`);
      requestedSizeUsd = availableUsd;
    }

    // ── 15. Jupiter minimum order ─────────────────────────────────────
    if (requestedSizeUsd < JUPITER_MIN_ORDER_USD) {
      return this.reject(
        `Position size $${requestedSizeUsd.toFixed(2)} is below Jupiter minimum ($${JUPITER_MIN_ORDER_USD})`,
        warnings
      );
    }

    // ── All checks passed ─────────────────────────────────────────────
    const sizeChanged = requestedSizeUsd !== thesis.positionSizeUsd;
    logger.info(
      `Risk approved: ${thesis.token.symbol} $${requestedSizeUsd.toFixed(0)} ` +
        `(${warnings.length} warnings)`
    );

    return {
      approved: true,
      reason: 'All risk checks passed',
      adjustedPositionSizeUsd: sizeChanged ? requestedSizeUsd : undefined,
      warnings,
    };
  }

  private reject(reason: string, warnings: string[]): RiskEvaluationResult {
    logger.info(`Risk rejected: ${reason}`);
    return {
      approved: false,
      reason,
      warnings,
    };
  }
}
