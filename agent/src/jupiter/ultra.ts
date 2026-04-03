/**
 * ultra.ts — Jupiter Ultra API swap client.
 *
 * Flow:
 *  1. getQuote() — get best route
 *  2. getSwapTransaction() — get serialized VersionedTransaction
 *  3. Caller signs and sends (via TradingWallet)
 *
 * Docs: https://dev.jup.ag/docs/ultra-api
 * Base URL: https://api.jup.ag/ultra/v1
 */

import axios from 'axios';
import type {
  AgentConfig,
  UltraQuoteRequest,
  UltraQuoteResponse,
  UltraSwapRequest,
  UltraSwapResponse,
} from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('jupiter/ultra');

export class JupiterUltraClient {
  private readonly baseUrl: string;
  private readonly apiKey: string;

  constructor(config: AgentConfig) {
    this.baseUrl = config.jupiterUltraBaseUrl;
    this.apiKey = config.jupiterApiKey;
  }

  private get headers(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'Content-Type': 'application/json',
    };
  }

  /**
   * Get the best swap route and price quote.
   *
   * @param req.amount - Input amount in smallest unit (lamports / token decimals)
   */
  async getQuote(req: UltraQuoteRequest): Promise<UltraQuoteResponse> {
    const params: Record<string, string | number> = {
      inputMint: req.inputMint,
      outputMint: req.outputMint,
      amount: req.amount,
    };
    if (req.slippageBps !== undefined) params.slippageBps = req.slippageBps;
    if (req.taker) params.taker = req.taker;

    logger.debug(
      `getQuote: ${req.inputMint.slice(0, 8)} → ${req.outputMint.slice(0, 8)} ` +
        `amount=${req.amount}`
    );

    const response = await axios.get<UltraQuoteResponse>(`${this.baseUrl}/order`, {
      params,
      headers: this.headers,
    });

    const quote = response.data;
    logger.debug(
      `Quote: in=${quote.inAmount} out=${quote.outAmount} ` +
        `priceImpact=${quote.priceImpactPct}% slippage=${quote.slippageBps}bps`
    );

    return quote;
  }

  /**
   * Get a serialized, ready-to-sign swap transaction.
   */
  async getSwapTransaction(req: UltraSwapRequest): Promise<UltraSwapResponse> {
    const response = await axios.post<UltraSwapResponse>(
      `${this.baseUrl}/execute`,
      {
        quoteResponse: req.quoteResponse,
        userPublicKey: req.userPublicKey,
      },
      { headers: this.headers }
    );
    return response.data;
  }

  /**
   * Helper: get quote and swap transaction in one call.
   * Caller must sign the returned transaction.
   */
  async quoteAndBuild(
    inputMint: string,
    outputMint: string,
    amount: string,
    userPublicKey: string,
    slippageBps?: number
  ): Promise<{ quote: UltraQuoteResponse; swapTx: UltraSwapResponse }> {
    const quote = await this.getQuote({
      inputMint,
      outputMint,
      amount,
      taker: userPublicKey,
      slippageBps,
    });
    const swapTx = await this.getSwapTransaction({
      quoteResponse: quote,
      userPublicKey,
    });
    return { quote, swapTx };
  }
}
