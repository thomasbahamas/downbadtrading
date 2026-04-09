/**
 * watchlist.ts — Daily watchlist DB operations.
 *
 * Manages the top 10 daily watchlist in Supabase.
 * Morning scan writes the initial list; regular loops update scores and ranks.
 */

import { getSupabaseClient } from './client';
import type { AgentConfig, WatchlistEntry, WatchlistEntryRow, WatchlistStatus } from '../types';
import { createLogger } from '../utils/logger';

const logger = createLogger('db/watchlist');

function rowToEntry(row: WatchlistEntryRow): WatchlistEntry {
  return {
    id: row.id,
    scanDate: row.scan_date,
    rank: row.rank,
    token: { symbol: row.token_symbol, mint: row.token_mint, name: row.token_name ?? '' },
    thesis: row.thesis,
    signals: (row.signals as WatchlistEntry['signals']) ?? { priceAction: '', volume: '', socialSentiment: '', onChainMetrics: '' },
    confidence: row.confidence,
    rrRatio: row.rr_ratio,
    entryPriceTarget: row.entry_price_target ?? 0,
    tpTarget: row.tp_target ?? 0,
    slTarget: row.sl_target ?? 0,
    currentPrice: row.current_price ?? 0,
    lastScore: row.last_score,
    scoreHistory: Array.isArray(row.score_history) ? row.score_history : [],
    status: row.status,
    tradeId: row.trade_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class WatchlistRepository {
  private config: AgentConfig;

  constructor(config: AgentConfig) {
    this.config = config;
  }

  /**
   * Get today's watchlist, ordered by rank.
   */
  async getTodayWatchlist(): Promise<WatchlistEntry[]> {
    const today = getTodayDateString();
    const supabase = getSupabaseClient(this.config);
    const { data, error } = await supabase
      .from('daily_watchlist')
      .select('*')
      .eq('scan_date', today)
      .order('rank', { ascending: true });

    if (error) {
      logger.debug(`Failed to fetch watchlist: ${error.message}`);
      return [];
    }
    return (data as WatchlistEntryRow[]).map(rowToEntry);
  }

  /**
   * Write the full top 10 watchlist for today (morning scan).
   * Deletes any existing entries for today first (idempotent re-runs).
   */
  async writeMorningScan(entries: Omit<WatchlistEntry, 'id' | 'createdAt' | 'updatedAt' | 'scoreHistory' | 'tradeId'>[]): Promise<void> {
    const today = getTodayDateString();
    const supabase = getSupabaseClient(this.config);

    // Clear today's entries if re-running
    await supabase.from('daily_watchlist').delete().eq('scan_date', today);

    const rows = entries.map((e) => ({
      scan_date: today,
      rank: e.rank,
      token_symbol: e.token.symbol,
      token_mint: e.token.mint,
      token_name: e.token.name,
      thesis: e.thesis,
      signals: e.signals,
      confidence: e.confidence,
      rr_ratio: e.rrRatio,
      entry_price_target: e.entryPriceTarget,
      tp_target: e.tpTarget,
      sl_target: e.slTarget,
      current_price: e.currentPrice,
      last_score: e.lastScore,
      score_history: [{ time: new Date().toISOString(), score: e.lastScore }],
      status: e.status,
    }));

    const { error } = await supabase.from('daily_watchlist').insert(rows);
    if (error) {
      logger.error(`Failed to write morning scan: ${error.message}`);
      throw error;
    }
    logger.info(`Wrote ${rows.length} watchlist entries for ${today}`);
  }

  /**
   * Update a watchlist entry's score, rank, current price, and optionally status.
   */
  async updateEntry(
    id: string,
    updates: {
      rank?: number;
      lastScore?: number;
      currentPrice?: number;
      status?: WatchlistStatus;
      tradeId?: string;
      confidence?: number;
      rrRatio?: number;
    }
  ): Promise<void> {
    const supabase = getSupabaseClient(this.config);

    const row: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (updates.rank != null) row.rank = updates.rank;
    if (updates.lastScore != null) row.last_score = updates.lastScore;
    if (updates.currentPrice != null) row.current_price = updates.currentPrice;
    if (updates.status != null) row.status = updates.status;
    if (updates.tradeId != null) row.trade_id = updates.tradeId;
    if (updates.confidence != null) row.confidence = updates.confidence;
    if (updates.rrRatio != null) row.rr_ratio = updates.rrRatio;

    const { error } = await supabase.from('daily_watchlist').update(row).eq('id', id);
    if (error) {
      logger.debug(`Failed to update watchlist entry ${id}: ${error.message}`);
    }
  }

  /**
   * Append a score to an entry's score_history.
   */
  async appendScoreHistory(id: string, score: number): Promise<void> {
    const supabase = getSupabaseClient(this.config);

    // Fetch current history, append, update
    const { data } = await supabase
      .from('daily_watchlist')
      .select('score_history')
      .eq('id', id)
      .single();

    const history = Array.isArray(data?.score_history) ? data.score_history : [];
    history.push({ time: new Date().toISOString(), score });

    // Keep max 100 entries per day to avoid bloat
    const trimmed = history.slice(-100);

    const { error } = await supabase
      .from('daily_watchlist')
      .update({ score_history: trimmed, last_score: score, updated_at: new Date().toISOString() })
      .eq('id', id);

    if (error) {
      logger.debug(`Failed to append score history for ${id}: ${error.message}`);
    }
  }

  /**
   * Replace a dropped entry with a new candidate at a given rank.
   */
  async replaceEntry(
    dropId: string,
    newEntry: Omit<WatchlistEntry, 'id' | 'createdAt' | 'updatedAt' | 'scoreHistory' | 'tradeId'>
  ): Promise<void> {
    const supabase = getSupabaseClient(this.config);

    // Mark old entry as dropped
    await supabase.from('daily_watchlist').update({
      status: 'dropped',
      updated_at: new Date().toISOString(),
    }).eq('id', dropId);

    // Insert new entry
    const { error } = await supabase.from('daily_watchlist').insert({
      scan_date: getTodayDateString(),
      rank: newEntry.rank,
      token_symbol: newEntry.token.symbol,
      token_mint: newEntry.token.mint,
      token_name: newEntry.token.name,
      thesis: newEntry.thesis,
      signals: newEntry.signals,
      confidence: newEntry.confidence,
      rr_ratio: newEntry.rrRatio,
      entry_price_target: newEntry.entryPriceTarget,
      tp_target: newEntry.tpTarget,
      sl_target: newEntry.slTarget,
      current_price: newEntry.currentPrice,
      last_score: newEntry.lastScore,
      score_history: [{ time: new Date().toISOString(), score: newEntry.lastScore }],
      status: 'watching',
    });

    if (error) {
      logger.debug(`Failed to insert replacement entry: ${error.message}`);
    }
  }
}

function getTodayDateString(): string {
  // Use PST (UTC-8 / UTC-7 DST) — the scan date resets at midnight PST
  const now = new Date();
  const pst = new Date(now.toLocaleString('en-US', { timeZone: 'America/Los_Angeles' }));
  return pst.toISOString().slice(0, 10);
}
