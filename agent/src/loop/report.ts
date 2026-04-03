/**
 * report.ts — REPORT node.
 *
 * After a trade executes (or is rejected / needs approval), this node:
 *  - Sends a Telegram message with the full thesis and result
 *  - Logs the trade to Supabase
 *
 * For approval requests (above MAX_AUTO_TRADE_USD), sends an inline
 * keyboard with Approve / Reject buttons.
 */

import type { AgentState, AgentConfig } from '../types';
import { TelegramClient } from '../notifications/telegram';
import { TradeRepository } from '../db/trades';
import { createLogger } from '../utils/logger';

const logger = createLogger('report');

export async function reportNode(
  state: AgentState,
  config: AgentConfig
): Promise<Partial<AgentState>> {
  const telegram = new TelegramClient(config);
  const db = new TradeRepository(config);

  try {
    // ── Case 1: Approval request (trade approved but needs human sign-off) ──
    if (
      state.riskApproval?.approved &&
      !state.riskApproval.autoExecute &&
      state.thesis &&
      !state.executionResult
    ) {
      logger.info('REPORT: sending manual approval request');
      const positionSizeUsd =
        state.riskApproval.adjustedPositionSizeUsd ?? state.thesis.positionSizeUsd;

      await telegram.sendApprovalRequest({
        thesisId: state.thesis.id,
        token: state.thesis.token.symbol,
        direction: state.thesis.direction,
        positionSizeUsd,
        entryPriceUsd: state.thesis.entryPriceUsd,
        takeProfitUsd: state.thesis.takeProfitUsd,
        stopLossUsd: state.thesis.stopLossUsd,
      });

      await db.insertThesisLog({
        ...state.thesis,
        disposition: 'pending_approval',
        rejectionReason: null,
      });

      return {}; // State unchanged — will monitor for approval via webhook
    }

    // ── Case 2: Successful execution ──────────────────────────────────
    if (state.executionResult?.success && state.thesis) {
      logger.info('REPORT: logging successful trade');
      const msg = telegram.formatTradeThesisMessage(state.thesis, state.executionResult);
      await telegram.sendMessage(msg);
      // Position already inserted in execute.ts; update if needed
      return {};
    }

    // ── Case 3: Failed execution ──────────────────────────────────────
    if (state.executionResult && !state.executionResult.success) {
      logger.warn(`REPORT: execution failed — ${state.executionResult.error}`);
      await telegram.sendMessage({
        type: 'error',
        content: `❌ Trade execution failed: ${state.executionResult.error}`,
        priority: 'high',
      });

      if (state.thesis) {
        await db.insertThesisLog({
          ...state.thesis,
          disposition: 'execution_failed',
          rejectionReason: state.executionResult.error ?? null,
        });
      }
      return {};
    }

    // ── Case 4: Risk-rejected thesis ─────────────────────────────────
    if (state.riskApproval && !state.riskApproval.approved && state.thesis) {
      logger.info(`REPORT: thesis rejected — ${state.riskApproval.reason}`);
      // Only log to DB, no Telegram for routine rejections (to avoid spam)
      await db.insertThesisLog({
        ...state.thesis,
        disposition: 'rejected_risk',
        rejectionReason: state.riskApproval.reason,
      });
      return {};
    }

    // ── Case 5: No thesis ────────────────────────────────────────────
    // Nothing to report
    return {};
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`REPORT error: ${message}`);
    return {}; // Non-fatal — don't halt the loop for reporting errors
  }
}
