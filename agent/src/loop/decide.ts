/**
 * decide.ts — DECIDE node.
 *
 * Applies all risk engine checks to the trade thesis. Has veto power.
 * The LLM never makes final risk decisions — only code does.
 *
 * Position rotation: when all slots are full but a new thesis is significantly
 * better than the weakest existing position, the weakest gets marked for
 * rotation (closed in EXECUTE, replaced by the new trade).
 *
 * Returns: { riskApproval, rotationTarget? }
 */

import type { AgentState, AgentConfig, RiskApproval, Position, TradeThesis } from '../types';
import { RiskEngine } from '../risk/engine';
import { CircuitBreakerService } from '../risk/circuit-breakers';
import { logActivity } from '../db/activity';
import { createLogger } from '../utils/logger';

const logger = createLogger('decide');

// ─── Rotation thresholds ──────────────────────────────────────────────────
// New thesis must meet BOTH of these to be eligible for rotation
const ROTATION_MIN_CONFIDENCE = 0.80;
const ROTATION_MIN_RR = 2.5;

// New thesis must beat the weakest position by AT LEAST one of these margins
const ROTATION_CONFIDENCE_MARGIN = 0.15; // 15 points
const ROTATION_RR_MULTIPLIER = 1.5;      // 1.5x better R/R

// Don't rotate out positions that are winning above this threshold
const ROTATION_MAX_WINNER_PCT = 0.05;    // 5% — don't cut real winners

// Rejection reasons that indicate a capacity problem (rotation-eligible)
const CAPACITY_REJECTION_PATTERNS = [
  'Max concurrent positions',
  'Portfolio exposure cap',
  'Single token exposure limit',
  'Insufficient balance',
];

export async function decideNode(
  state: AgentState,
  config: AgentConfig
): Promise<Partial<AgentState>> {
  // If no thesis, skip — nothing to decide
  if (!state.thesis) {
    logger.info('DECIDE: no thesis, skipping risk checks');
    const approval: RiskApproval = {
      approved: false,
      reason: 'No trade thesis generated',
      warnings: [],
      autoExecute: false,
    };
    return { riskApproval: approval, rotationTarget: null };
  }

  logger.info(`DECIDE: running risk checks on thesis ${state.thesis.id}`);

  const engine = new RiskEngine(config.risk);
  const circuitBreaker = new CircuitBreakerService(config);

  try {
    // ── Circuit breaker check (highest priority) ─────────────────────
    const cbState = await circuitBreaker.getState();
    if (cbState.isTradingHalted) {
      const approval: RiskApproval = {
        approved: false,
        reason: `Circuit breaker active: ${cbState.haltReason}`,
        warnings: [],
        autoExecute: false,
      };
      logger.warn(`DECIDE: trading halted — ${cbState.haltReason}`);
      return { riskApproval: approval, rotationTarget: null };
    }

    // ── Run all risk checks ──────────────────────────────────────────
    const result = await engine.evaluate({
      thesis: state.thesis,
      portfolio: state.portfolio,
      activePositions: state.activePositions,
      marketSnapshot: state.marketSnapshot,
    });

    // ── If rejected due to capacity, evaluate rotation ───────────────
    let rotationTarget: Position | null = null;

    if (
      !result.approved &&
      CAPACITY_REJECTION_PATTERNS.some((p) => result.reason.includes(p)) &&
      state.activePositions.length > 0
    ) {
      rotationTarget = evaluateRotation(
        state.thesis,
        state.activePositions,
        state.marketSnapshot,
      );

      if (rotationTarget) {
        // Re-approve with rotation — the risk engine rejected on capacity,
        // but we're freeing a slot by closing the weakest position
        logger.info(
          `DECIDE: rotation approved — closing ${rotationTarget.token.symbol} ` +
            `(conf=${rotationTarget.confidenceScore?.toFixed(2)}) ` +
            `to enter ${state.thesis.token.symbol} ` +
            `(conf=${state.thesis.confidenceScore.toFixed(2)})`
        );

        // Re-evaluate with the rotation target removed from active positions
        const positionsAfterRotation = state.activePositions.filter(
          (p) => p.id !== rotationTarget!.id
        );
        const recheck = await engine.evaluate({
          thesis: state.thesis,
          portfolio: state.portfolio,
          activePositions: positionsAfterRotation,
          marketSnapshot: state.marketSnapshot,
        });

        if (recheck.approved) {
          result.approved = true;
          result.reason = `Rotation: closing ${rotationTarget.token.symbol} → entering ${state.thesis.token.symbol}`;
          result.adjustedPositionSizeUsd = recheck.adjustedPositionSizeUsd;
          result.warnings = [
            ...recheck.warnings,
            `Rotating out of ${rotationTarget.token.symbol} (weaker position)`,
          ];
        } else {
          // Still rejected even without the rotation target — don't rotate
          logger.info(`DECIDE: rotation re-check failed — ${recheck.reason}`);
          rotationTarget = null;
        }
      }
    }

    // ── Determine auto-execute vs. manual approval ───────────────────
    const positionSize =
      result.adjustedPositionSizeUsd ?? state.thesis.positionSizeUsd;
    const requiresApproval = positionSize > config.maxAutoTradeUsd;

    const approval: RiskApproval = {
      approved: result.approved,
      reason: result.reason,
      adjustedPositionSizeUsd: result.adjustedPositionSizeUsd,
      warnings: result.warnings,
      autoExecute: result.approved && !requiresApproval,
    };

    if (approval.approved) {
      const rotationNote = rotationTarget
        ? ` (rotating out of ${rotationTarget.token.symbol})`
        : '';
      logger.info(
        `DECIDE: approved — size=$${positionSize.toFixed(0)} ` +
          `autoExecute=${approval.autoExecute} ` +
          `warnings=${approval.warnings.length}${rotationNote}`
      );
      await logActivity(config, 'executed',
        `Approved: BUY $${positionSize.toFixed(0)} of ${state.thesis.token.symbol}${rotationNote}`,
        approval.warnings.length > 0 ? `Warnings: ${approval.warnings.join(', ')}` : undefined,
        state.thesis.token.symbol
      );
    } else {
      logger.info(`DECIDE: rejected — ${approval.reason}`);
      await logActivity(config, 'rejected',
        `Rejected: ${state.thesis.token.symbol} — ${approval.reason}`,
        state.thesis.reasoning,
        state.thesis.token.symbol,
        {
          confidence: state.thesis.confidenceScore,
          rr: state.thesis.riskRewardRatio,
          entryPrice: state.thesis.entryPriceUsd,
          tp: state.thesis.takeProfitUsd,
          sl: state.thesis.stopLossUsd,
          reason: approval.reason,
        }
      );
    }

    return { riskApproval: approval, rotationTarget };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`DECIDE error: ${message}`);
    return {
      riskApproval: {
        approved: false,
        reason: `Risk engine error: ${message}`,
        warnings: [],
        autoExecute: false,
      },
      rotationTarget: null,
    };
  }
}

// ─── Rotation evaluation ──────────────────────────────────────────────────

function evaluateRotation(
  thesis: TradeThesis,
  activePositions: Position[],
  marketSnapshot: AgentState['marketSnapshot'],
): Position | null {
  // Step 1: New thesis must meet the high bar
  if (thesis.confidenceScore < ROTATION_MIN_CONFIDENCE) {
    logger.debug(
      `DECIDE: rotation skipped — thesis confidence ${thesis.confidenceScore.toFixed(2)} < ${ROTATION_MIN_CONFIDENCE}`
    );
    return null;
  }
  if (thesis.riskRewardRatio < ROTATION_MIN_RR) {
    logger.debug(
      `DECIDE: rotation skipped — thesis R/R ${thesis.riskRewardRatio.toFixed(2)} < ${ROTATION_MIN_RR}`
    );
    return null;
  }

  // Step 2: Find the weakest position (lowest confidence, worst current P&L)
  const scoredPositions = activePositions
    .filter((p) => p.status === 'open')
    .map((p) => {
      // Get current price from market snapshot
      const currentToken = marketSnapshot?.tokens.find((t) => t.mint === p.token.mint);
      const currentPrice = currentToken?.priceUsd ?? p.entryPriceUsd;
      const unrealizedPnlPct = (currentPrice - p.entryPriceUsd) / p.entryPriceUsd;

      // Compute a composite weakness score (lower = weaker = better rotation candidate)
      // Confidence contributes 60%, current P&L trend contributes 40%
      const confidenceScore = p.confidenceScore ?? 0.5;
      const pnlScore = Math.max(-1, Math.min(1, unrealizedPnlPct)); // clamp to [-1, 1]
      const weaknessScore = confidenceScore * 0.6 + pnlScore * 0.4;

      return { position: p, confidenceScore, unrealizedPnlPct, currentPrice, weaknessScore };
    })
    .sort((a, b) => a.weaknessScore - b.weaknessScore); // weakest first

  if (scoredPositions.length === 0) return null;

  const weakest = scoredPositions[0];

  // Step 3: Don't cut winners that are trending up
  if (weakest.unrealizedPnlPct > ROTATION_MAX_WINNER_PCT) {
    logger.info(
      `DECIDE: rotation skipped — weakest position ${weakest.position.token.symbol} ` +
        `is up ${(weakest.unrealizedPnlPct * 100).toFixed(1)}% (above ${ROTATION_MAX_WINNER_PCT * 100}% threshold)`
    );
    return null;
  }

  // Step 4: New thesis must dominate the weakest by a clear margin
  const confidenceImprovement = thesis.confidenceScore - weakest.confidenceScore;
  const currentRR = weakest.position.takeProfitUsd && weakest.position.stopLossUsd && weakest.position.entryPriceUsd
    ? (weakest.position.takeProfitUsd - weakest.position.entryPriceUsd) /
      (weakest.position.entryPriceUsd - weakest.position.stopLossUsd)
    : 1;
  const rrImprovement = thesis.riskRewardRatio / Math.max(0.1, currentRR);

  const confidenceDominates = confidenceImprovement >= ROTATION_CONFIDENCE_MARGIN;
  const rrDominates = rrImprovement >= ROTATION_RR_MULTIPLIER;

  if (!confidenceDominates && !rrDominates) {
    logger.info(
      `DECIDE: rotation skipped — not enough improvement over ${weakest.position.token.symbol} ` +
        `(conf: +${(confidenceImprovement * 100).toFixed(0)}pts need +${ROTATION_CONFIDENCE_MARGIN * 100}, ` +
        `R/R: ${rrImprovement.toFixed(2)}x need ${ROTATION_RR_MULTIPLIER}x)`
    );
    return null;
  }

  const dominanceReason = confidenceDominates && rrDominates
    ? `+${(confidenceImprovement * 100).toFixed(0)}pts confidence AND ${rrImprovement.toFixed(1)}x R/R`
    : confidenceDominates
    ? `+${(confidenceImprovement * 100).toFixed(0)}pts confidence improvement`
    : `${rrImprovement.toFixed(1)}x better R/R`;

  logger.info(
    `DECIDE: rotation candidate found — close ${weakest.position.token.symbol} ` +
      `(conf=${weakest.confidenceScore.toFixed(2)}, pnl=${(weakest.unrealizedPnlPct * 100).toFixed(1)}%) ` +
      `→ enter ${thesis.token.symbol} (${dominanceReason})`
  );

  return weakest.position;
}
