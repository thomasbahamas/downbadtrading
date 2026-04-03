/**
 * paper-trade.ts — Paper trading mode entry point.
 *
 * Runs the full agent loop (observe → analyze → decide) but:
 *  - Skips the execute node (no real Jupiter transactions)
 *  - Uses a simulated portfolio with configurable starting balance
 *  - Still hits real market data APIs (Birdeye, Pyth, etc.)
 *  - Logs all decisions to Supabase (paper_trades table) and console
 *  - Good for testing LLM thesis quality + risk engine logic
 *
 * Usage:
 *   npm run paper-trade
 *   PAPER_STARTING_BALANCE=5000 npm run paper-trade
 */

// Force paper trade mode
process.env.PAPER_TRADE = 'true';

import '../agent/src/index';
