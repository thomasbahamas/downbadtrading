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
   *
   * TODO: implement proper SPL transfer once TradingWallet.transferSPL is implemented.
   * Currently transfers SOL equivalent as a fallback.
   */
  private async transferProfitAsUSDC(profitUsd: number): Promise<string> {
    // TODO: implement USDC SPL transfer
    // For now, log what we would transfer and return a placeholder
    // 1. Check USDC balance >= profitUsd
    // 2. Call wallet.transferSPL(USDC_MINT, profitWalletAddress, profitUsd, 6)

    // Temporary: transfer SOL equivalent
    // In production, resolve SOL/USD price and transfer exact SOL
    logger.warn('USDC transfer not yet implemented; SOL transfer used as placeholder');

    // TODO: replace with actual SOL price lookup
    const solPrice = 100; // placeholder
    const solAmount = profitUsd / solPrice;

    const sig = await this.wallet.transferSOL(this.profitWalletAddress, solAmount);
    return sig;
  }
}
