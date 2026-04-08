/**
 * ultra.ts — Jupiter Ultra API swap client.
 *
 * Flow (Jupiter Swap V2):
 *  1. GET /order — get unsigned transaction + requestId
 *  2. Sign transaction locally with wallet keypair
 *  3. POST /execute — submit signed transaction + requestId
 *
 * Docs: https://dev.jup.ag/docs/swap/order-and-execute
 * Base URL: https://api.jup.ag/swap/v2
 */

import axios from 'axios';
import { VersionedTransaction } from '@solana/web3.js';
import type { AgentConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('jupiter/ultra');

// ─── Types matching Jupiter Swap V2 API ──────────────────────────────────

export interface OrderRequest {
  inputMint: string;
  outputMint: string;
  amount: string;
  taker: string;
  slippageBps?: number;
}

export interface OrderResponse {
  requestId: string;
  inputMint: string;
  outputMint: string;
  inAmount: string;
  outAmount: string;
  otherAmountThreshold: string;
  swapMode: string;
  slippageBps: number;
  priceImpact: number;
  transaction: string | null; // base64 unsigned transaction (null if taker omitted)
  lastValidBlockHeight: string;
  prioritizationFeeLamports: number;
  router: string;
  error?: string;
  errorCode?: number;
}

export interface ExecuteRequest {
  signedTransaction: string; // base64 signed transaction
  requestId: string;
}

export interface ExecuteResponse {
  status: 'Success' | 'Failed';
  signature: string;
  code: number;
  inputAmountResult?: string;
  outputAmountResult?: string;
  error?: string;
}

// ─── Client ──────────────────────────────────────────────────────────────

export class JupiterUltraClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AgentConfig) {
    // Normalize: support both old /ultra/v1 and new /swap/v2 URLs
    const configUrl = config.jupiterUltraBaseUrl;
    this.baseUrl = configUrl.includes('/ultra/')
      ? configUrl.replace('/ultra/v1', '/swap/v2')
      : configUrl;
    this.apiKey = config.jupiterApiKey;
  }

  private get headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Step 1: Get order (unsigned transaction + requestId).
   * taker is required to get a transaction back.
   */
  async getOrder(req: OrderRequest): Promise<OrderResponse> {
    const params: Record<string, string | number> = {
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      amount: req.amount,
      taker: req.taker,
    };
    if (req.slippageBps !== undefined) params.slippageBps = req.slippageBps;

    logger.info(
      `getOrder: ${req.inputMint.slice(0, 8)}… → ${req.outputMint.slice(0, 8)}… ` +
        `amount=${req.amount} taker=${req.taker.slice(0, 8)}…`
    );

    const response = await axios.get<OrderResponse>(`${this.baseUrl}/order`, {
      params,
      headers: this.headers,
    });

    const order = response.data;

    if (!order.transaction) {
      throw new Error(
        `Jupiter order returned no transaction: ${order.error || order.errorCode || 'unknown'}`
      );
    }

    logger.info(
      `Order: in=${order.inAmount} out=${order.outAmount} ` +
        `slippage=${order.slippageBps}bps router=${order.router} requestId=${order.requestId}`
    );

    return order;
  }

  /**
   * Step 2: Sign the unsigned transaction from getOrder().
   * Returns base64-encoded signed transaction.
   */
  signTransaction(unsignedTxBase64: string, signer: { sign: (tx: VersionedTransaction) => void }): string {
    const txBytes = Buffer.from(unsignedTxBase64, 'base64');
    const tx = VersionedTransaction.deserialize(txBytes);
    signer.sign(tx);
    return Buffer.from(tx.serialize()).toString('base64');
  }

  /**
   * Step 3: Submit signed transaction to Jupiter for broadcasting.
   */
  async execute(req: ExecuteRequest): Promise<ExecuteResponse> {
    logger.info(`execute: submitting requestId=${req.requestId}`);

    const response = await axios.post<ExecuteResponse>(
      `${this.baseUrl}/execute`,
      {
        signedTransaction: req.signedTransaction,
        requestId: req.requestId,
      },
      { headers: this.headers }
    );

    const result = response.data;

    if (result.status === 'Success') {
      logger.info(
        `Swap success: sig=${result.signature} ` +
          `in=${result.inputAmountResult} out=${result.outputAmountResult}`
      );
    } else {
      logger.error(`Swap failed: code=${result.code} error=${result.error}`);
    }

    return result;
  }
}
