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
    // ── Phase 1: Swap ────────────────────────────────────────────────
    // Determine input: use USDC if available, else SOL
    const inputMint = state.portfolio.usdcBalance >= positionSizeUsd ? USDC_MINT : WSOL_MINT;
    // Convert USD to token amount (in lamports / smallest unit)
    const inputDecimals = inputMint === USDC_MINT ? 6 : 9;
    const solPrice = state.marketSnapshot?.globalMetrics.solPriceUsd ?? 1;
    const inputAmountHuman =
      inputMint === USDC_MINT
        ? positionSizeUsd
        : positionSizeUsd / solPrice;
    const inputAmountRaw = Math.floor(inputAmountHuman * 10 ** inputDecimals).toString();

    const quote = await ultra.getQuote({
      inputMint,
      outputMint: thesis.token.mint,
      amount: inputAmountRaw,
      taker: wallet.getPublicKey(),
    });

    const swapTx = await ultra.getSwapTransaction({
      quoteResponse: quote,
      userPublicKey: wallet.getPublicKey(),
    });

    const { signature: swapSignature, slot } = await wallet.signAndSendTransaction(
      swapTx.swapTransaction,
      swapTx.lastValidBlockHeight
    );

    logger.info(`EXECUTE: swap confirmed — sig=${swapSignature} slot=${slot}`);

    // Calculate actual amount of output token received
    const outputAmountRaw = quote.outAmount;
    const actualEntryPrice = positionSizeUsd / (Number(outputAmountRaw) / 10 ** 9); // approximate

    // ── Phase 2: OCO order ────────────────────────────────────────────
    const expiresAt = Date.now() + config.risk.orderExpiryDays * 24 * 3600 * 1000;

    const ocoParams: TriggerOCOOrderParams = {
      orderType: 'oco',
      inputMint: thesis.token.mint,        // we're selling the token we just bought
      inputAmount: outputAmountRaw,
      outputMint: USDC_MINT,               // receive USDC on exit
      triggerMint: thesis.token.mint,
      tpPriceUsd: thesis.takeProfitUsd,
      slPriceUsd: thesis.stopLossUsd,
      tpSlippageBps: undefined,            // RTSE auto slippage
      slSlippageBps: 2000,                 // 20% for execution certainty
      expiresAt,
    };

    const ocoOrder = await trigger.createOrder(ocoParams);
    logger.info(`EXECUTE: OCO order created — id=${ocoOrder.id}`);

    // ── Record position ───────────────────────────────────────────────
    const position: Position = {
      id: uuidv4(),
      thesisId: thesis.id,
      token: { symbol: thesis.token.symbol, mint: thesis.token.mint, name: thesis.token.name },
      direction: 'long',
      entryPriceUsd: actualEntryPrice,
      entrySizeUsd: positionSizeUsd,
      entryTokenAmount: Number(outputAmountRaw) / 10 ** 9,
      entryTxSignature: swapSignature,
      takeProfitUsd: thesis.takeProfitUsd,
      stopLossUsd: thesis.stopLossUsd,
      jupiterOrderId: ocoOrder.id,
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
      jupiterOrderId: ocoOrder.id,
      entryPriceUsd: actualEntryPrice,
      amountOut: outputAmountRaw,
    };

    return {
      executionResult: result,
      activePositions: [...state.activePositions, position],
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
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
