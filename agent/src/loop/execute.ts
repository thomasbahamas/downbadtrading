/**
 * execute.ts — EXECUTE node.
 *
 * Two-phase execution:
 *  1. Jupiter Ultra swap — convert USDC/SOL to target token
 *  2. Jupiter Trigger V2 OCO — create take-profit + stop-loss order on output tokens
 *
 * Returns: { executionResult }
 */

import { v4 as uuidv4 } from 'uuid';
import type {
  AgentState,
  AgentConfig,
  ExecutionResult,
  Position,
  TriggerOCOOrderParams,
} from '../types';
import { JupiterUltraClient } from '../jupiter/ultra';
import { JupiterTriggerClient } from '../jupiter/trigger';
import { TradingWallet } from '../wallet/trading';
import { TradeRepository } from '../db/trades';
import { createLogger } from '../utils/logger';

const logger = createLogger('execute');

// Stable USDC mint on Solana mainnet
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
// Wrapped SOL
const WSOL_MINT = 'So11111111111111111111111111111111111111112';

export async function executeNode(
  state: AgentState,
  config: AgentConfig
): Promise<Partial<AgentState>> {
  if (!state.thesis || !state.riskApproval?.approved) {
    logger.warn('EXECUTE: no approved thesis, skipping');
    return { executionResult: { success: false, error: 'No approved thesis' } };
  }

  if (config.paperTrade) {
    return executePaperTrade(state, config);
  }

  const { thesis, riskApproval } = state;
  const positionSizeUsd = riskApproval.adjustedPositionSizeUsd ?? thesis.positionSizeUsd;

  logger.info(
    `EXECUTE: buying ${thesis.token.symbol} for $${positionSizeUsd.toFixed(2)} ` +
      `entry=$${thesis.entryPriceUsd} tp=$${thesis.takeProfitUsd} sl=$${thesis.stopLossUsd}`
  );

  const ultra = new JupiterUltraClient(config);
  const trigger = new JupiterTriggerClient(config);
  const wallet = new TradingWallet(config);
  const db = new TradeRepository(config);

  try {
    // ── Phase 1: Swap via Jupiter Ultra (order → sign → execute) ────
    // Determine input: use USDC if available, else SOL
    const inputMint = state.portfolio.usdcBalance >= positionSizeUsd ? USDC_MINT : WSOL_MINT;
    const inputDecimals = inputMint === USDC_MINT ? 6 : 9;
    const solPrice = state.marketSnapshot?.globalMetrics.solPriceUsd ?? 1;
    const inputAmountHuman =
      inputMint === USDC_MINT
        ? positionSizeUsd
        : positionSizeUsd / solPrice;
    const inputAmountRaw = Math.floor(inputAmountHuman * 10 ** inputDecimals).toString();

    // Step 1: Get order (unsigned transaction + requestId)
    const order = await ultra.getOrder({
      inputMint,
      outputMint: thesis.token.mint,
      amount: inputAmountRaw,
      taker: wallet.getPublicKey(),
    });

    // Step 2: Sign the transaction locally
    const signedTx = ultra.signTransaction(order.transaction!, {
      sign: (tx) => wallet.signVersionedTransaction(tx),
    });

    // Step 3: Submit to Jupiter for broadcasting + confirmation
    const execResult = await ultra.execute({
      signedTransaction: signedTx,
      requestId: order.requestId,
    });

    if (execResult.status !== 'Success') {
      throw new Error(`Jupiter swap failed: code=${execResult.code} ${execResult.error}`);
    }

    const swapSignature = execResult.signature;
    logger.info(`EXECUTE: swap confirmed — sig=${swapSignature}`);

    // Use thesis market price as entry price (accurate at analysis time)
    // Avoids decimal mismatch: tokens have varying decimals (SOL=9, USDC=6, RENDER=8, etc.)
    const outputAmountRaw = execResult.outputAmountResult || order.outAmount;
    const actualEntryPrice = thesis.entryPriceUsd;

    // ── Phase 2: OCO order (TP/SL) ─────────────────────────────────
    let jupiterOrderId = 'NONE';
    try {
      const expiresAt = Date.now() + config.risk.orderExpiryDays * 24 * 3600 * 1000;

      const ocoParams: TriggerOCOOrderParams = {
        orderType: 'oco',
        inputMint: thesis.token.mint,
        inputAmount: outputAmountRaw,
        outputMint: USDC_MINT,
        triggerMint: thesis.token.mint,
        tpPriceUsd: thesis.takeProfitUsd,
        slPriceUsd: thesis.stopLossUsd,
        tpSlippageBps: undefined,
        slSlippageBps: 2000,
        expiresAt,
      };

      const ocoOrder = await trigger.createOrder(ocoParams);
      jupiterOrderId = ocoOrder.id;
      logger.info(`EXECUTE: OCO order created — id=${jupiterOrderId}`);
    } catch (ocoErr) {
      const msg = ocoErr instanceof Error ? ocoErr.message : String(ocoErr);
      logger.warn(`EXECUTE: OCO order failed (position recorded without TP/SL): ${msg}`);
    }

    // ── Record position ───────────────────────────────────────────────
    const position: Position = {
      id: uuidv4(),
      thesisId: thesis.id,
      token: { symbol: thesis.token.symbol, mint: thesis.token.mint, name: thesis.token.name },
      direction: 'long',
      entryPriceUsd: actualEntryPrice,
      entrySizeUsd: positionSizeUsd,
      entryTokenAmount: positionSizeUsd / actualEntryPrice,
      entryTxSignature: swapSignature,
      takeProfitUsd: thesis.takeProfitUsd,
      stopLossUsd: thesis.stopLossUsd,
      jupiterOrderId,
      status: 'open',
      openedAt: Date.now(),
    };

    await db.insertPosition(position);
    await db.insertThesisLog({
      ...thesis,
      disposition: 'executed',
      rejectionReason: null,
    });

    const result: ExecutionResult = {
      success: true,
      swapTxSignature: swapSignature,
      jupiterOrderId,
      entryPriceUsd: actualEntryPrice,
      amountOut: outputAmountRaw,
    };

    return {
      executionResult: result,
      activePositions: [...state.activePositions, position],
    };
  } catch (err: unknown) {
    let message = err instanceof Error ? err.message : String(err);
    // Log full axios error response for debugging
    if (err && typeof err === 'object' && 'response' in err) {
      const axiosErr = err as { response?: { status?: number; data?: unknown } };
      if (axiosErr.response?.data) {
        message += ` | Response: ${JSON.stringify(axiosErr.response.data)}`;
      }
    }
    logger.error(`EXECUTE failed: ${message}`);
    const result: ExecutionResult = {
      success: false,
      error: message,
    };
    return { executionResult: result };
  }
}

// ─── Paper trade (no real txs) ────────────────────────────────────────────

async function executePaperTrade(
  state: AgentState,
  config: AgentConfig
): Promise<Partial<AgentState>> {
  const { thesis, riskApproval } = state;
  if (!thesis) return { executionResult: { success: false, error: 'No thesis' } };

  const positionSizeUsd = riskApproval?.adjustedPositionSizeUsd ?? thesis.positionSizeUsd;
  const fakeSig = `PAPER_${thesis.id.slice(0, 8)}`;
  const fakeOrderId = `PAPER_OCO_${thesis.id.slice(0, 8)}`;

  logger.info(
    `PAPER TRADE: would buy ${thesis.token.symbol} for $${positionSizeUsd.toFixed(2)} ` +
      `[sig: ${fakeSig}]`
  );

  const db = new TradeRepository(config);
  const position: Position = {
    id: uuidv4(),
    thesisId: thesis.id,
    token: thesis.token,
    direction: 'long',
    entryPriceUsd: thesis.entryPriceUsd,
    entrySizeUsd: positionSizeUsd,
    entryTokenAmount: positionSizeUsd / thesis.entryPriceUsd,
    entryTxSignature: fakeSig,
    takeProfitUsd: thesis.takeProfitUsd,
    stopLossUsd: thesis.stopLossUsd,
    jupiterOrderId: fakeOrderId,
    status: 'open',
    openedAt: Date.now(),
  };

  await db.insertPosition(position);

  return {
    executionResult: {
      success: true,
      swapTxSignature: fakeSig,
      jupiterOrderId: fakeOrderId,
      entryPriceUsd: thesis.entryPriceUsd,
      amountOut: String(positionSizeUsd / thesis.entryPriceUsd),
    },
    activePositions: [...state.activePositions, position],
  };
}
