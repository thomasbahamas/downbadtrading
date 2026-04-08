/**
 * trades.ts — Trade and position database queries.
 *
 * All writes use the service_role key (bypasses RLS).
 * Tables: trades, positions, theses, circuit_breaker_events, daily_performance
 */

import { SupabaseClient } from '@supabase/supabase-js';
import type { AgentConfig, Position, TradeThesis, TradeLog } from '../types';
import { getSupabaseClient } from './client';
import { createLogger } from '../utils/logger';

const logger = createLogger('db/trades');

interface ThesisLogInput extends TradeThesis {
  disposition: string;
  rejectionReason: string | null;
}

export class TradeRepository {
  private readonly supabase: SupabaseClient;

  constructor(config: AgentConfig) {
    this.supabase = getSupabaseClient(config);
  }

  // ─── Positions ──────────────────────────────────────────────────────────

  async insertPosition(position: Position): Promise<void> {
    const row = this.positionToRow(position);
    const { error } = await this.supabase.from('trades').insert(row);
    if (error) {
      logger.error(`insertPosition failed: ${error.message}`);
      throw new Error(error.message);
    }
  }

  async updatePosition(position: Position): Promise<void> {
    const row = this.positionToRow(position);
    const { error } = await this.supabase
      .from('trades')
      .update({ ...row, updated_at: new Date().toISOString() })
      .eq('id', position.id);
    if (error) {
      logger.error(`updatePosition failed: ${error.message}`);
      throw new Error(error.message);
    }
  }

  async getOpenPositions(): Promise<Position[]> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false });

    if (error) throw new Error(error.message);
    return (data || []).map(this.rowToPosition);
  }

  async getPositionByOrderId(jupiterOrderId: string): Promise<Position | null> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('*')
      .eq('jupiter_order_id', jupiterOrderId)
      .single();

    if (error) return null;
    return data ? this.rowToPosition(data) : null;
  }

  async getRecentTrades(limit = 50): Promise<TradeLog[]> {
    const { data, error } = await this.supabase
      .from('trades')
      .select('*')
      .order('opened_at', { ascending: false })
      .limit(limit);

    if (error) throw new Error(error.message);
    return data || [];
  }

  // ─── Trade Theses ────────────────────────────────────────────────────────

  async insertThesisLog(thesis: ThesisLogInput): Promise<void> {
    const { error } = await this.supabase.from('theses').insert({
      id: thesis.id,
      token_symbol: thesis.token.symbol,
      token_mint: thesis.token.mint,
      direction: thesis.direction,
      entry_price: thesis.entryPriceUsd,
      take_profit: thesis.takeProfitUsd,
      stop_loss: thesis.stopLossUsd,
      position_size_usd: thesis.positionSizeUsd,
      confidence_score: thesis.confidenceScore,
      reasoning: thesis.reasoning,
      signals: thesis.signals,
      risk_reward_ratio: thesis.riskRewardRatio,
      disposition: thesis.disposition,
      rejection_reason: thesis.rejectionReason,
      created_at: new Date(thesis.timestamp).toISOString(),
    });

    if (error) {
      logger.warn(`insertThesisLog failed: ${error.message}`);
    }
  }

  // ─── Daily Performance ───────────────────────────────────────────────────

  async upsertDailyPerformance(stats: {
    date: string;
    startingBalanceUsd: number;
    endingBalanceUsd: number;
    realizedPnl: number;
    tradesTaken: number;
    tradesWon: number;
    tradesLost: number;
    maxDrawdownPct: number;
  }): Promise<void> {
    const winRate = stats.tradesTaken > 0 ? stats.tradesWon / stats.tradesTaken : 0;
    const { error } = await this.supabase.from('daily_performance').upsert(
      {
        date: stats.date,
        starting_balance_usd: stats.startingBalanceUsd,
        ending_balance_usd: stats.endingBalanceUsd,
        realized_pnl: stats.realizedPnl,
        realized_pnl_pct:
          stats.startingBalanceUsd > 0
            ? (stats.realizedPnl / stats.startingBalanceUsd) * 100
            : 0,
        trades_taken: stats.tradesTaken,
        trades_won: stats.tradesWon,
        trades_lost: stats.tradesLost,
        win_rate: winRate,
        avg_winner_pct: await this.computeAvgPnlPct('tp_hit', stats.date),
        avg_loser_pct: await this.computeAvgPnlPct('sl_hit', stats.date),
        max_drawdown_pct: stats.maxDrawdownPct,
        created_at: new Date().toISOString(),
      },
      { onConflict: 'date' }
    );
    if (error) logger.warn(`upsertDailyPerformance: ${error.message}`);
  }

  // ─── Avg PnL computation ─────────────────────────────────────────────────

  private async computeAvgPnlPct(status: 'tp_hit' | 'sl_hit', date: string): Promise<number> {
    const { data } = await this.supabase
      .from('trades')
      .select('realized_pnl_pct')
      .eq('status', status)
      .gte('closed_at', `${date}T00:00:00Z`)
      .lt('closed_at', `${date}T23:59:59Z`);

    if (!data || data.length === 0) return 0;
    const sum = data.reduce((s: number, r: { realized_pnl_pct: number | null }) => s + (r.realized_pnl_pct ?? 0), 0);
    return sum / data.length;
  }

  // ─── Converters ──────────────────────────────────────────────────────────

  private positionToRow(p: Position): Record<string, unknown> {
    return {
      id: p.id,
      thesis_id: p.thesisId,
      token_symbol: p.token.symbol,
      token_mint: p.token.mint,
      token_name: p.token.name,
      direction: p.direction === 'long' ? 'buy' : 'sell',
      entry_price: p.entryPriceUsd,
      exit_price: p.exitPriceUsd ?? null,
      take_profit: p.takeProfitUsd,
      stop_loss: p.stopLossUsd,
      position_size_usd: p.entrySizeUsd,
      entry_token_amount: p.entryTokenAmount,
      confidence_score: p.confidenceScore ?? 0,
      reasoning: p.reasoning ?? '',
      signals: p.signals ?? {},
      status: p.status,
      jupiter_order_id: p.jupiterOrderId,
      entry_tx: p.entryTxSignature,
      exit_tx: p.exitTxSignature ?? null,
      realized_pnl: p.realizedPnl ?? null,
      realized_pnl_pct: p.realizedPnlPct ?? null,
      profit_routed: p.profitRouted ?? false,
      profit_route_tx: p.profitRouteTxSignature ?? null,
      opened_at: new Date(p.openedAt).toISOString(),
      closed_at: p.closedAt ? new Date(p.closedAt).toISOString() : null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
  }

  private rowToPosition(row: Record<string, unknown>): Position {
    return {
      id: row.id as string,
      thesisId: row.thesis_id as string,
      token: {
        symbol: row.token_symbol as string,
        mint: row.token_mint as string,
        name: (row.token_name as string) ?? '',
      },
      direction: (row.direction as string) === 'buy' ? 'long' : 'short',
      entryPriceUsd: row.entry_price as number,
      entrySizeUsd: row.position_size_usd as number,
      entryTokenAmount: row.entry_token_amount as number,
      entryTxSignature: row.entry_tx as string,
      takeProfitUsd: row.take_profit as number,
      stopLossUsd: row.stop_loss as number,
      jupiterOrderId: row.jupiter_order_id as string,
      status: row.status as Position['status'],
      openedAt: new Date(row.opened_at as string).getTime(),
      closedAt: row.closed_at
        ? new Date(row.closed_at as string).getTime()
        : undefined,
      exitPriceUsd: row.exit_price as number | undefined,
      exitTxSignature: row.exit_tx as string | undefined,
      realizedPnl: row.realized_pnl as number | undefined,
      realizedPnlPct: row.realized_pnl_pct as number | undefined,
      profitRouted: row.profit_routed as boolean,
      profitRouteTxSignature: row.profit_route_tx as string | undefined,
    };
  }
}
