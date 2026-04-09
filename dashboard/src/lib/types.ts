export interface Trade {
  id: string;
  thesis_id: string;
  token_symbol: string;
  token_mint: string;
  token_name: string | null;
  direction: 'buy' | 'sell';
  entry_price: number;
  exit_price: number | null;
  take_profit: number;
  stop_loss: number;
  position_size_usd: number;
  entry_token_amount: number;
  confidence_score: number;
  reasoning: string | null;
  signals: Record<string, string>;
  status: 'open' | 'tp_hit' | 'sl_hit' | 'expired' | 'manual_close' | 'pending_approval';
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
  status: string;
  uptime: number;
  loopCount: number;
  paperTrade: boolean;
  timestamp: string;
}

export interface AgentActivity {
  id: string;
  type: string;
  title: string;
  details: string | null;
  token_symbol: string | null;
  metadata: Record<string, unknown>;
  created_at: string;
}

export interface WatchlistEntry {
  id: string;
  scan_date: string;
  rank: number;
  token_symbol: string;
  token_mint: string;
  token_name: string | null;
  thesis: string;
  signals: Record<string, string>;
  confidence: number;
  rr_ratio: number;
  entry_price_target: number | null;
  tp_target: number | null;
  sl_target: number | null;
  current_price: number | null;
  last_score: number;
  score_history: Array<{ time: string; score: number }>;
  status: 'watching' | 'taken' | 'dropped';
  trade_id: string | null;
  created_at: string;
  updated_at: string;
}
