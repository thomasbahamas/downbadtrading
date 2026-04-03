/**
 * profit-router.ts — Routes realized profits to the profit wallet.
 *
 * After a winning trade closes:
 *  1. Calculate profit amount in USDC/SOL
 *  2. Transfer that amount to PROFIT_WALLET_ADDRESS
 *  3. Log the transfer
 *  4. Keep the original capital (entry cost basis) in the trading wallet
 *
 * Only the profit delta is routed — not the full position value.
 */

import type { AgentConfig, Position } from '../types';
import { TradingWallet } from './trading';
import { createLogger } from '../utils/logger';

const logger = createLogger('wallet/profit-router');

// Min profit to route (avoid dust transfers)
const MIN_PROFIT_TO_ROUTE_USD = 1.0;

// Mint addresses
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

export class ProfitRouter {
  private readonly wallet: TradingWallet;
  private readonly profitWalletAddress: string;

  constructor(config: AgentConfig) {
    this.wallet = new TradingWallet(config);
    this.profitWalletAddress = config.profitWalletAddress;
  }

  /**
   * Routes the profit from a closed position to the profit wallet.
   *
   * @returns Transaction signature, or null if profit below minimum.
   */
  async routeProfit(position: Position): Promise<string | null> {
    const profitUsd = position.realizedPnl ?? 0;

    if (profitUsd <= 0) {
      logger.debug(`routeProfit: no profit to route (pnl=$${profitUsd.toFixed(2)})`);
      return null;
    }

    if (profitUsd < MIN_PROFIT_TO_ROUTE_USD) {
      logger.info(
        `routeProfit: profit $${profitUsd.toFixed(2)} below minimum $${MIN_PROFIT_TO_ROUTE_USD}, skipping`
      );
      return null;
    }

    logger.info(
      `routeProfit: routing $${profitUsd.toFixed(2)} from ${position.token.symbol} ` +
        `trade to ${this.profitWalletAddress.slice(0, 8)}…`
    );

    try {
      // Determine transfer method based on exit token
      // For long positions exiting to USDC, transfer USDC
      // For exits to SOL, transfer SOL
      const txSignature = await this.transferProfitAsUSDC(profitUsd);
      logger.info(`routeProfit: transferred — sig=${txSignature}`);
      return txSignature;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.error(`routeProfit failed: ${message}`);
      throw err;
    }
  }

  /**
   * Transfers USDC equivalent of profit to the profit wallet.
   * Falls back to SOL transfer if USDC balance is insufficient.
   */
  private async transferProfitAsUSDC(profitUsd: number): Promise<string> {
    const portfolio = await this.wallet.getPortfolio();

    // Try USDC first (1 USDC ≈ $1)
    if (portfolio.usdcBalance >= profitUsd) {
      logger.info(`Routing $${profitUsd.toFixed(2)} as USDC`);
      return this.wallet.transferSPL(USDC_MINT, this.profitWalletAddress, profitUsd, 6);
    }

    // Fallback to SOL using on-chain SOL price from portfolio context
    // We use the SOL balance and a conservative estimate
    if (portfolio.solBalance > 0.01) {
      logger.info(`Insufficient USDC ($${portfolio.usdcBalance.toFixed(2)}), routing as SOL`);
      // Fetch current SOL price from CoinGecko simple/price as a quick lookup
      const axios = (await import('axios')).default;
      let solPrice = 150; // conservative fallback
      try {
        const res = await axios.get('https://api.coingecko.com/api/v3/simple/price', {
          params: { ids: 'solana', vs_currencies: 'usd' },
          timeout: 5000,
        });
        solPrice = res.data?.solana?.usd ?? solPrice;
      } catch {
        logger.warn('SOL price lookup failed, using fallback');
      }

      const solAmount = profitUsd / solPrice;
      if (solAmount > portfolio.solBalance - 0.01) {
        logger.warn(`Insufficient SOL for full profit route (need ${solAmount.toFixed(4)}, have ${portfolio.solBalance.toFixed(4)})`);
        return this.wallet.transferSOL(this.profitWalletAddress, portfolio.solBalance - 0.01);
      }

      return this.wallet.transferSOL(this.profitWalletAddress, solAmount);
    }

    throw new Error('Insufficient USDC and SOL balance for profit routing');
  }
}
