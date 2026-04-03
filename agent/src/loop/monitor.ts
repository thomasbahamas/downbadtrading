/**
 * monitor.ts — MONITOR node.
 *
 * Runs every loop iteration. Responsibilities:
 *  1. Poll Jupiter Trigger V2 for filled/cancelled orders
 *  2. Update position status in Supabase on fills
 *  3. Update circuit breaker state (consecutive losses, daily PnL, drawdown)
 *  4. Route profits to profit wallet after winning trades
 *  5. Implement trailing stop: shift SL to breakeven when price moves +10%
 *  6. Notify Telegram of position updates
 *
 * Returns: { activePositions } (updated)
 */

import type { AgentState, AgentConfig, Position } from '../types';
import { JupiterTriggerClient } from '../jupiter/trigger';
import { ProfitRouter } from '../wallet/profit-router';
import { CircuitBreakerService } from '../risk/circuit-breakers';
import { TelegramClient } from '../notifications/telegram';
import { TradeRepository } from '../db/trades';
import { createLogger } from '../utils/logger';

const logger = createLogger('monitor');

// How far price must move above entry before trailing stop shifts to breakeven
const TRAILING_STOP_TRIGGER_PCT = 10;

export async function monitorNode(
  state: AgentState,
  config: AgentConfig
): Promise<Partial<AgentState>> {
  if (state.activePositions.length === 0) {
    logger.debug('MONITOR: no open positions');
    return {};
  }

  logger.info(`MONITOR: checking ${state.activePositions.length} open positions`);

  const trigger = new JupiterTriggerClient(config);
  const profitRouter = new ProfitRouter(config);
  const circuitBreaker = new CircuitBreakerService(config);
  const telegram = new TelegramClient(config);
  const db = new TradeRepository(config);

  const updatedPositions: Position[] = [];
  let portfolioChanged = false;

  for (const position of state.activePositions) {
    if (config.paperTrade && position.jupiterOrderId.startsWith('PAPER_')) {
      // In paper mode, check simulated price for TP/SL
      const simulatedFill = checkPaperFill(position, state);
      if (simulatedFill) {
        await handlePositionClose(
          { ...position, ...simulatedFill },
          config,
          telegram,
          profitRouter,
          circuitBreaker,
          db
        );
        portfolioChanged = true;
        continue;
      }
      updatedPositions.push(position);
      continue;
    }

    try {
      const order = await trigger.getOrder(position.jupiterOrderId);

      if (order.status === 'filled') {
        // ── Position closed by OCO ──────────────────────────────────
        const exitPrice = order.outputAmount
          ? Number(position.entrySizeUsd) / (Number(order.outputAmount) / 1e6)
          : undefined;

        const realizedPnl = exitPrice
          ? (exitPrice - position.entryPriceUsd) * position.entryTokenAmount
          : 0;

        const closedPosition: Position = {
          ...position,
          status: exitPrice
            ? exitPrice >= position.takeProfitUsd
              ? 'tp_hit'
              : 'sl_hit'
            : 'expired',
          closedAt: Date.now(),
          exitPriceUsd: exitPrice,
          exitTxSignature: order.fillTxSignature,
          realizedPnl,
          realizedPnlPct: realizedPnl / position.entrySizeUsd,
        };

        await handlePositionClose(
          closedPosition,
          config,
          telegram,
          profitRouter,
          circuitBreaker,
          db
        );

        portfolioChanged = true;
        // Don't push to updatedPositions — it's closed
      } else if (order.status === 'cancelled' || order.status === 'expired') {
        // OCO expired/cancelled without fill — mark as expired
        const closedPosition: Position = {
          ...position,
          status: 'expired',
          closedAt: Date.now(),
        };
        await db.updatePosition(closedPosition);
        await telegram.sendMessage({
          type: 'position_update',
          content: `⏰ Position expired: ${position.token.symbol} (order ${position.jupiterOrderId.slice(0, 8)})`,
          priority: 'normal',
        });
        portfolioChanged = true;
      } else {
        // ── Order still open: check trailing stop ──────────────────
        const currentToken = state.marketSnapshot?.tokens.find(
          (t) => t.mint === position.token.mint
        );
        if (currentToken) {
          const updatedPosition = await maybeUpdateTrailingStop(
            position,
            currentToken.priceUsd,
            trigger,
            db
          );
          updatedPositions.push(updatedPosition);
        } else {
          updatedPositions.push(position);
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn(`MONITOR: error checking position ${position.id}: ${message}`);
      updatedPositions.push(position); // Keep position, retry next loop
    }
  }

  // Update circuit breaker state from portfolio changes
  if (portfolioChanged && state.portfolio) {
    await circuitBreaker.update(state.portfolio);
  }

  return { activePositions: updatedPositions };
}

// ─── Handle position close ────────────────────────────────────────────────

async function handlePositionClose(
  position: Position,
  config: AgentConfig,
  telegram: TelegramClient,
  profitRouter: ProfitRouter,
  circuitBreaker: CircuitBreakerService,
  db: TradeRepository
): Promise<void> {
  const isWin = (position.realizedPnl ?? 0) > 0;
  const pnlStr =
    position.realizedPnl !== undefined
      ? `${isWin ? '+' : ''}$${position.realizedPnl.toFixed(2)}`
      : 'unknown';

  logger.info(
    `MONITOR: position closed — ${position.token.symbol} ${position.status} ` +
      `pnl=${pnlStr}`
  );

  // Update DB
  await db.updatePosition(position);

  // Telegram notification
  const statusEmoji =
    position.status === 'tp_hit' ? '✅' : position.status === 'sl_hit' ? '🔴' : '⏰';
  const statusLabel =
    position.status === 'tp_hit'
      ? 'Take Profit Hit'
      : position.status === 'sl_hit'
      ? 'Stop Loss Hit'
      : 'Expired';

  await telegram.sendMessage({
    type: 'position_update',
    content:
      `${statusEmoji} <b>${statusLabel}</b> — ${position.token.symbol}\n` +
      `Entry: $${position.entryPriceUsd.toFixed(6)}\n` +
      `Exit: $${(position.exitPriceUsd ?? 0).toFixed(6)}\n` +
      `P&L: ${pnlStr} (${((position.realizedPnlPct ?? 0) * 100).toFixed(1)}%)\n` +
      (position.exitTxSignature
        ? `<a href="https://solscan.io/tx/${position.exitTxSignature}">View on Solscan</a>`
        : ''),
    priority: position.status === 'tp_hit' ? 'normal' : 'high',
  });

  // Update circuit breaker
  await circuitBreaker.recordTrade(position);

  // Route profits if it was a win
  if (isWin && (position.realizedPnl ?? 0) > 0 && !config.paperTrade) {
    try {
      const routeTx = await profitRouter.routeProfit(position);
      if (routeTx) {
        const updatedPosition = { ...position, profitRouted: true, profitRouteTxSignature: routeTx };
        await db.updatePosition(updatedPosition);
        logger.info(`MONITOR: profit routed — tx=${routeTx}`);
        await telegram.sendMessage({
          type: 'profit_routed',
          content: `💰 Profit routed: ${pnlStr} → profit wallet\n<a href="https://solscan.io/tx/${routeTx}">View transfer</a>`,
          priority: 'low',
        });
      }
    } catch (routeErr) {
      const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
      logger.error(`MONITOR: profit routing failed: ${msg}`);
    }
  }
}

// ─── Trailing stop ────────────────────────────────────────────────────────

async function maybeUpdateTrailingStop(
  position: Position,
  currentPrice: number,
  trigger: JupiterTriggerClient,
  db: TradeRepository
): Promise<Position> {
  // Only move SL if price has risen 10%+ above entry and SL hasn't been moved yet
  const priceMoveFromEntry = (currentPrice - position.entryPriceUsd) / position.entryPriceUsd;
  const slAlreadyMoved = position.stopLossUsd >= position.entryPriceUsd;

  if (priceMoveFromEntry >= TRAILING_STOP_TRIGGER_PCT / 100 && !slAlreadyMoved) {
    logger.info(
      `MONITOR: trailing stop triggered for ${position.token.symbol} ` +
        `(price moved ${(priceMoveFromEntry * 100).toFixed(1)}%)`
    );

    const newStopLoss = position.entryPriceUsd; // Move SL to breakeven

    try {
      // TODO: implement trigger.editOrder() to update slPriceUsd
      // await trigger.editOrder(position.jupiterOrderId, { slPriceUsd: newStopLoss });

      const updatedPosition: Position = {
        ...position,
        stopLossUsd: newStopLoss,
        lastTrailingStopUpdate: Date.now(),
      };
      await db.updatePosition(updatedPosition);
      return updatedPosition;
    } catch (err) {
      logger.warn(`MONITOR: trailing stop edit failed: ${err}`);
    }
  }

  return position;
}

// ─── Paper trade fill simulation ──────────────────────────────────────────

function checkPaperFill(
  position: Position,
  state: AgentState
): Partial<Position> | null {
  const currentToken = state.marketSnapshot?.tokens.find(
    (t) => t.mint === position.token.mint
  );
  if (!currentToken) return null;

  const price = currentToken.priceUsd;

  if (price >= position.takeProfitUsd) {
    const pnl = (position.takeProfitUsd - position.entryPriceUsd) * position.entryTokenAmount;
    return {
      status: 'tp_hit',
      closedAt: Date.now(),
      exitPriceUsd: position.takeProfitUsd,
      realizedPnl: pnl,
      realizedPnlPct: pnl / position.entrySizeUsd,
    };
  }

  if (price <= position.stopLossUsd) {
    const pnl = (position.stopLossUsd - position.entryPriceUsd) * position.entryTokenAmount;
    return {
      status: 'sl_hit',
      closedAt: Date.now(),
      exitPriceUsd: position.stopLossUsd,
      realizedPnl: pnl,
      realizedPnlPct: pnl / position.entrySizeUsd,
    };
  }

  return null;
}
