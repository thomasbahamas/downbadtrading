/**
 * decide.ts — DECIDE node.
 *
 * Applies all risk engine checks to the trade thesis. Has veto power.
 * The LLM never makes final risk decisions — only code does.
 *
 * Returns: { riskApproval }
 */

import type { AgentState, AgentConfig, RiskApproval } from '../types';
import { RiskEngine } from '../risk/engine';
import { CircuitBreakerService } from '../risk/circuit-breakers';
import { logActivity } from '../db/activity';
import { createLogger } from '../utils/logger';

const logger = createLogger('decide');

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
    return { riskApproval: approval };
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
      return { riskApproval: approval };
    }

    // ── Run all risk checks ──────────────────────────────────────────
    const result = await engine.evaluate({
      thesis: state.thesis,
      portfolio: state.portfolio,
      activePositions: state.activePositions,
      marketSnapshot: state.marketSnapshot,
    });

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
      logger.info(
        `DECIDE: approved — size=$${positionSize.toFixed(0)} ` +
          `autoExecute=${approval.autoExecute} ` +
          `warnings=${approval.warnings.length}`
      );
      await logActivity(config, 'executed',
        `Approved: BUY $${positionSize.toFixed(0)} of ${state.thesis.token.symbol}`,
        approval.warnings.length > 0 ? `Warnings: ${approval.warnings.join(', ')}` : undefined,
        state.thesis.token.symbol
      );
    } else {
      logger.info(`DECIDE: rejected — ${approval.reason}`);
      await logActivity(config, 'rejected',
        `Rejected: ${state.thesis.token.symbol} — ${approval.reason}`,
        undefined, state.thesis.token.symbol
      );
    }

    return { riskApproval: approval };
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
    };
  }
}
