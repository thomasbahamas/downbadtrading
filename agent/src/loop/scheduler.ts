/**
 * scheduler.ts — Morning scan scheduler.
 *
 * Triggers the daily Top 10 watchlist generation at 5:00 AM PST every day.
 * Uses simple setTimeout-based scheduling — no external cron dependency needed.
 *
 * On startup, if it's past 5 AM PST and no scan exists for today, runs immediately.
 */

import type { AgentConfig, AgentState } from '../types';
import { observeNode } from './observe';
import { runMorningScan } from './morning-scan';
import { WatchlistRepository } from '../db/watchlist';
import { createInitialState } from './graph';
import { TelegramClient } from '../notifications/telegram';
import { createLogger } from '../utils/logger';

const logger = createLogger('scheduler');

const MORNING_SCAN_HOUR_PST = 5; // 5 AM PST
const MORNING_SCAN_MINUTE = 0;

/**
 * Calculate ms until the next 5 AM PST.
 */
function msUntilNextScan(): number {
  const now = new Date();
  // Get current time in PST
  const pstNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));

  // Build target: today at 5:00 AM PST
  const target = new Date(pstNow);
  target.setHours(MORNING_SCAN_HOUR_PST, MORNING_SCAN_MINUTE, 0, 0);

  // If we're past 5 AM today, schedule for tomorrow
  if (pstNow >= target) {
    target.setDate(target.getDate() + 1);
  }

  // Convert target back to UTC for scheduling
  // We need the actual UTC difference, so compute from the original `now`
  const pstOffset = pstNow.getTime() - now.getTime(); // ms offset between PST representation and UTC
  const targetUtc = new Date(target.getTime() - pstOffset);

  return Math.max(0, targetUtc.getTime() - now.getTime());
}

/**
 * Execute the morning scan: collect fresh market data, then run the deep analysis.
 */
async function executeMorningScan(config: AgentConfig): Promise<void> {
  logger.info('=== MORNING SCAN TRIGGERED ===');
  const telegram = new TelegramClient(config);

  try {
    // Collect fresh market data using the observe node
    const initialState = createInitialState(config.profitWalletAddress);
    const observeResult = await observeNode(initialState, config);

    if (!observeResult.marketSnapshot) {
      logger.error('Morning scan: failed to collect market data');
      return;
    }

    const portfolio = observeResult.portfolio ?? initialState.portfolio;

    // Run the deep scan
    await runMorningScan(observeResult.marketSnapshot, portfolio, config);

    // Notify via Telegram
    const repo = new WatchlistRepository(config);
    const watchlist = await repo.getTodayWatchlist();
    if (watchlist.length > 0) {
      const topSymbols = watchlist.slice(0, 5).map((w) => `#${w.rank} ${w.token.symbol}`).join('\n');
      await telegram.sendMessage({
        type: 'daily_summary',
        content: `📋 Morning Scan Complete — Top 10 Watchlist\n\n${topSymbols}\n\n... and ${Math.max(0, watchlist.length - 5)} more. Dashboard updated.`,
        priority: 'normal',
      });
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logger.error(`Morning scan execution failed: ${message}`);
    await telegram.sendMessage({
      type: 'error',
      content: `⚠️ Morning scan failed: ${message}`,
      priority: 'high',
    });
  }
}

/**
 * Schedule the morning scan. Call once at startup.
 *
 * - If it's past 5 AM PST and no scan exists for today, runs immediately.
 * - Then schedules the next run for tomorrow 5 AM PST.
 * - Repeats daily.
 */
export function scheduleMorningScan(config: AgentConfig): void {
  const scheduleNext = () => {
    const ms = msUntilNextScan();
    const hours = (ms / 3600000).toFixed(1);
    logger.info(`Morning scan scheduled in ${hours}h`);

    setTimeout(async () => {
      await executeMorningScan(config);
      // Schedule next day
      scheduleNext();
    }, ms);
  };

  // Check if we should run immediately (past 5 AM PST, no scan today)
  const checkAndRun = async () => {
    const now = new Date();
    const pstNow = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
    const isPast5AM = pstNow.getHours() >= MORNING_SCAN_HOUR_PST;

    if (isPast5AM) {
      // Check if we already have today's watchlist
      try {
        const repo = new WatchlistRepository(config);
        const existing = await repo.getTodayWatchlist();
        if (existing.length === 0) {
          logger.info('Past 5 AM PST with no scan today — running morning scan now');
          await executeMorningScan(config);
        } else {
          logger.info(`Today's watchlist already exists (${existing.length} entries)`);
        }
      } catch {
        logger.info('Could not check existing watchlist — running morning scan');
        await executeMorningScan(config);
      }
    }

    // Schedule the next 5 AM run
    scheduleNext();
  };

  // Fire and forget — don't block startup
  checkAndRun().catch((err) => {
    logger.error(`Scheduler init error: ${err instanceof Error ? err.message : String(err)}`);
    // Still schedule future runs even if initial check fails
    scheduleNext();
  });
}
