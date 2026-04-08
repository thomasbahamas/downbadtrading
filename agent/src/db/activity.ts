/**
 * activity.ts — Agent activity logger.
 *
 * Logs significant agent events to Supabase for the dashboard live feed.
 * All writes are non-fatal — activity logging should never break the loop.
 */

import { getSupabaseClient } from './client';
import type { AgentConfig } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('db/activity');

export type ActivityType =
  | 'scan'          // Market data collected
  | 'listing'       // New CEX listing detected
  | 'thesis'        // LLM generated a trade thesis
  | 'no_trade'      // LLM returned no trade signal
  | 'rejected'      // Risk engine rejected
  | 'executed'      // Trade executed
  | 'position_close' // Position hit TP/SL
  | 'loop_summary'  // End-of-loop summary with funnel stats
  | 'error';        // Error occurred

export async function logActivity(
  config: AgentConfig,
  type: ActivityType,
  title: string,
  details?: string,
  tokenSymbol?: string,
  metadata?: Record<string, unknown>
): Promise<void> {
  try {
    const supabase = getSupabaseClient(config);
    await supabase.from('agent_activity').insert({
      type,
      title,
      details: details ?? null,
      token_symbol: tokenSymbol ?? null,
      metadata: metadata ?? {},
    });
  } catch (err) {
    // Non-fatal — never let activity logging break the agent loop
    logger.debug(`Activity log failed: ${err instanceof Error ? err.message : String(err)}`);
  }
}
