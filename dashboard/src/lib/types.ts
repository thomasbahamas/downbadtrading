/**
 * Dashboard-specific types.
 * These mirror the agent's database row types.
 */

export type TradeStatus =
  | 'open'
  | 'tp_hit'
  | 'sl_hit'
  | 'expired'
  | 'manual_close'
  | 'pending_approval';

export interface Trade {
  id: string;
  thesis_id: string | null;
  token_symbol: string;
  token_mint: string;
  token_name: string | null;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number | null;
  take_profit: number;
  stop_loss: number;
  position_size_usd: number;
  entry_token_amount: number | null;
  confidence_score: number | null;
  reasoning: string | null;
  signals: Record<string, string> | null;
  status: TradeStatus;
  jupiter_order_id: string | null;
  entry_tx: string | null;
  exit_tx: string | null;
  realized_pnl: number | null;
  realized_pnl_pct: number | null;
  profit_routed: boolean;
  profit_route_tx: string | null;
  opened_at: string;
  closed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DailyPerformance {
  id: string;
  date: string;
  starting_balance_usd: number;
  ending_balance_usd: number;
  realized_pnl: number;
  realized_pnl_pct: number;
  trades_taken: number;
  trades_won: number;
  trades_lost: number;
  win_rate: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
  max_drawdown_pct: number;
  created_at: string;
}

export interface CircuitBreakerEvent {
  id: string;
  type: 'halt' | 'resume';
  reason: string;
  daily_loss_pct: number;
  consecutive_losses: number;
  drawdown_from_peak_pct: number;
  created_at: string;
}

export interface TradeStats {
  total_closed: number;
  total_wins: number;
  total_losses: number;
  open_positions: number;
  win_rate: number;
  total_pnl: number;
  avg_winner_pct: number;
  avg_loser_pct: number;
}

export interface AgentHealth {
  status: 'ok' | 'error';
  uptime: number;
  loopCount: number;
  paperTrade: boolean;
  timestamp: string;
}
