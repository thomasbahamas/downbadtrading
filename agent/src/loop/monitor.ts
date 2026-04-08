/**
 * monitor.ts — MONITOR node.
 *
 * Runs every loop iteration. Responsibilities:
 *  1. Check open positions against current prices
 *  2. If TP or SL is hit, execute market sell via Jupiter Ultra
 *  3. Update position status in Supabase on close
 *  4. Update circuit breaker state (consecutive losses, daily PnL, drawdown)
 *  5. Route profits to profit wallet after winning trades
 *  6. Implement trailing stop: shift SL to breakeven when price moves +10%
 *
 * For positions with Jupiter Trigger V2 OCO orders, poll for fills.
 * For positions without OCO (jupiterOrderId = 'NONE'), use market sell fallback.
 *
 * Returns: { activePositions } (updated)
 */

import type { AgentState, AgentConfig, Position } from '../types';
import { JupiterUltraClient } from '../jupiter/ultra';
import { TradingWallet } from '../wallet/trading';
import { ProfitRouter } from '../wallet/profit-router';
import { CircuitBreakerService } from '../risk/circuit-breakers';
import { TelegramClient } from '../notifications/telegram';
import { TradeRepository } from '../db/trades';
import { createLogger } from '../utils/logger';

const logger = createLogger('monitor');

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
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

  const profitRouter = new ProfitRouter(config);
  const circuitBreaker = new CircuitBreakerService(config);
  const telegram = new TelegramClient(config);
  const db = new TradeRepository(config);

  const updatedPositions: Position[] = [];
  let portfolioChanged = false;

  for (const position of state.activePositions) {
    // ── Paper trade: simulated TP/SL ──────────────────────────────
    if (config.paperTrade && position.jupiterOrderId.startsWith('PAPER_')) {
      const simulatedFill = checkPriceTrigger(position, state);
      if (simulatedFill) {
        await handlePositionClose(
          { ...position, ...simulatedFill },
          config, telegram, profitRouter, circuitBreaker, db
        );
        portfolioChanged = true;
        continue;
      }
      updatedPositions.push(position);
      continue;
    }

    // ── Live position: market sell exit ────────────────────────────
    const currentToken = state.marketSnapshot?.tokens.find(
      (t) => t.mint === position.token.mint
    );

    if (!currentToken) {
      logger.debug(`MONITOR: no price data for ${position.token.symbol}, skipping`);
      updatedPositions.push(position);
      continue;
    }

    const currentPrice = currentToken.priceUsd;
    const trigger = checkPriceTrigger(position, state);

    if (trigger) {
      // Price hit TP or SL — execute market sell
      logger.info(
        `MONITOR: ${trigger.status} for ${position.token.symbol} ` +
          `(current=$${currentPrice.toFixed(4)} entry=$${position.entryPriceUsd.toFixed(4)})`
      );

      try {
        const exitResult = await executeMarketSell(position, config);

        const realizedPnl = (currentPrice - position.entryPriceUsd) * position.entryTokenAmount;
        const closedPosition: Position = {
          ...position,
          status: trigger.status as Position['status'],
          closedAt: Date.now(),
          exitPriceUsd: currentPrice,
          exitTxSignature: exitResult.signature,
          realizedPnl,
          realizedPnlPct: realizedPnl / position.entrySizeUsd,
        };

        await handlePositionClose(
          closedPosition, config, telegram, profitRouter, circuitBreaker, db
        );
        portfolioChanged = true;
      } catch (sellErr) {
        const msg = sellErr instanceof Error ? sellErr.message : String(sellErr);
        logger.error(`MONITOR: market sell failed for ${position.token.symbol}: ${msg}`);
        updatedPositions.push(position); // Keep position, retry next loop
      }
    } else {
      // Still open — check trailing stop
      const priceMoveFromEntry = (currentPrice - position.entryPriceUsd) / position.entryPriceUsd;
      const slAlreadyMoved = position.stopLossUsd >= position.entryPriceUsd;

      if (priceMoveFromEntry >= TRAILING_STOP_TRIGGER_PCT / 100 && !slAlreadyMoved) {
        logger.info(
          `MONITOR: trailing stop → breakeven for ${position.token.symbol} ` +
            `(+${(priceMoveFromEntry * 100).toFixed(1)}%)`
        );
        const updatedPosition: Position = {
          ...position,
          stopLossUsd: position.entryPriceUsd,
          lastTrailingStopUpdate: Date.now(),
        };
        await db.updatePosition(updatedPosition);
        updatedPositions.push(updatedPosition);
      } else {
        updatedPositions.push(position);
      }
    }
  }

  if (portfolioChanged && state.portfolio) {
    await circuitBreaker.update(state.portfolio);
  }

  return { activePositions: updatedPositions };
}

// ─── Market sell via Jupiter Ultra ──────────────────────────────────────

async function executeMarketSell(
  position: Position,
  config: AgentConfig
): Promise<{ signature: string }> {
  const ultra = new JupiterUltraClient(config);
  const wallet = new TradingWallet(config);

  // Query actual on-chain token balance (avoids decimal mismatch bugs)
  const amountRaw = await wallet.getTokenBalanceRaw(position.token.mint);

  logger.info(
    `MONITOR: selling ${position.token.symbol} ` +
      `(${amountRaw} raw) via Jupiter Ultra`
  );

  // Step 1: Get order
  const order = await ultra.getOrder({
    inputMint: position.token.mint,
    outputMint: USDC_MINT,
    amount: amountRaw,
    taker: wallet.getPublicKey(),
  });

  // Step 2: Sign
  const signedTx = ultra.signTransaction(order.transaction!, {
    sign: (tx) => wallet.signVersionedTransaction(tx),
  });

  // Step 3: Execute
  const result = await ultra.execute({
    signedTransaction: signedTx,
    requestId: order.requestId,
  });

  if (result.status !== 'Success') {
    throw new Error(`Market sell failed: code=${result.code} ${result.error}`);
  }

  logger.info(`MONITOR: sell confirmed — sig=${result.signature} out=${result.outputAmountResult}`);
  return { signature: result.signature };
}

// ─── Price trigger check ────────────────────────────────────────────────

function checkPriceTrigger(
  position: Position,
  state: AgentState
): Partial<Position> | null {
  const currentToken = state.marketSnapshot?.tokens.find(
    (t) => t.mint === position.token.mint
  );
  if (!currentToken) return null;

  const price = currentToken.priceUsd;

  if (price >= position.takeProfitUsd) {
    const pnl = (price - position.entryPriceUsd) * position.entryTokenAmount;
    return {
      status: 'tp_hit',
      closedAt: Date.now(),
      exitPriceUsd: price,
      realizedPnl: pnl,
      realizedPnlPct: pnl / position.entrySizeUsd,
    };
  }

  if (price <= position.stopLossUsd) {
    const pnl = (price - position.entryPriceUsd) * position.entryTokenAmount;
    return {
      status: 'sl_hit',
      closedAt: Date.now(),
      exitPriceUsd: price,
      realizedPnl: pnl,
      realizedPnlPct: pnl / position.entrySizeUsd,
    };
  }

  return null;
}

// ─── Handle position close ──────────────────────────────────────────────

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
    `MONITOR: position closed — ${position.token.symbol} ${position.status} pnl=${pnlStr}`
  );

  await db.updatePosition(position);

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

  await circuitBreaker.recordTrade(position);

  if (isWin && (position.realizedPnl ?? 0) > 0 && !config.paperTrade) {
    try {
      const routeTx = await profitRouter.routeProfit(position);
      if (routeTx) {
        const updatedPosition = { ...position, profitRouted: true, profitRouteTxSignature: routeTx };
        await db.updatePosition(updatedPosition);
        logger.info(`MONITOR: profit routed — tx=${routeTx}`);
      }
    } catch (routeErr) {
      const msg = routeErr instanceof Error ? routeErr.message : String(routeErr);
      logger.error(`MONITOR: profit routing failed: ${msg}`);
    }
  }
}
