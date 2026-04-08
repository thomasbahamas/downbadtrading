import { supabase } from '@/lib/supabase';
import type { Trade, TradeStats } from '@/lib/types';
import PortfolioCard from '@/components/PortfolioCard';
import ActivePositions from '@/components/ActivePositions';
import AgentStatus from '@/components/AgentStatus';
import PerformanceMetrics from '@/components/PerformanceMetrics';

// Always fetch fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getData() {
  // Fetch open positions
  const { data: positions, error: posErr } = await supabase
    .from('trades')
    .select('*')
    .eq('status', 'open')
    .order('opened_at', { ascending: false });

  if (posErr) console.error('Dashboard: positions query failed:', posErr.message);

  // Fetch trade stats (view)
  const { data: stats, error: statsErr } = await supabase
    .from('trade_stats')
    .select('*')
    .single();

  if (statsErr) console.error('Dashboard: trade_stats query failed:', statsErr.message);

  // Fetch ALL recent trades for display
  const { data: recentTrades, error: recentErr } = await supabase
    .from('trades')
    .select('*')
    .order('opened_at', { ascending: false })
    .limit(20);

  if (recentErr) console.error('Dashboard: recent trades query failed:', recentErr.message);

  // Fetch closed trades for PnL calculation
  const { data: closedTrades, error: closedErr } = await supabase
    .from('trades')
    .select('realized_pnl, realized_pnl_pct, closed_at, position_size_usd')
    .neq('status', 'open')
    .neq('status', 'pending_approval')
    .not('realized_pnl', 'is', null);

  if (closedErr) console.error('Dashboard: closed trades query failed:', closedErr.message);

  return {
    positions: (positions as Trade[]) ?? [],
    stats: (stats as TradeStats) ?? null,
    recentTrades: (recentTrades as Trade[]) ?? [],
    closedTrades: closedTrades ?? [],
  };
}

export default async function DashboardPage() {
  const { positions, stats, recentTrades, closedTrades } = await getData();

  // Compute portfolio metrics from trades data
  const deployedCapital = positions.reduce((sum, p) => sum + Number(p.position_size_usd), 0);
  const totalRealizedPnl = closedTrades.reduce(
    (sum, t) => sum + Number(t.realized_pnl ?? 0), 0
  );

  // Today's PnL
  const today = new Date().toISOString().slice(0, 10);
  const todaysClosed = closedTrades.filter(
    (t) => t.closed_at && String(t.closed_at).startsWith(today)
  );
  const todayPnl = todaysClosed.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const todayPnlPct = deployedCapital > 0 ? todayPnl / deployedCapital : 0;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Dashboard</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Live portfolio overview · auto-refreshes every 30s
        </p>
      </div>

      {/* Top row: portfolio + agent status */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="md:col-span-2">
          <PortfolioCard
            deployedCapital={deployedCapital}
            dailyPnl={todayPnl}
            dailyPnlPct={todayPnlPct}
            totalPnl={totalRealizedPnl}
            openPositions={positions.length}
            totalTrades={recentTrades.length}
          />
        </div>
        <AgentStatus />
      </div>

      {/* Performance metrics */}
      {stats && stats.total_closed > 0 && (
        <PerformanceMetrics stats={stats} />
      )}

      {/* Active positions */}
      <ActivePositions positions={positions} />

      {/* Recent trades */}
      {recentTrades.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-white mb-4">Recent Trades</h2>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2">Token</th>
                  <th className="text-right pb-2">Entry</th>
                  <th className="text-right pb-2">Size</th>
                  <th className="text-right pb-2">TP / SL</th>
                  <th className="text-right pb-2">Status</th>
                  <th className="text-right pb-2">P&L</th>
                  <th className="text-right pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/50 hover:bg-surface-2/50">
                    <td className="py-2 text-white font-medium">{t.token_symbol}</td>
                    <td className="py-2 text-right text-gray-300">
                      ${Number(t.entry_price).toFixed(4)}
                    </td>
                    <td className="py-2 text-right text-gray-300">
                      ${Number(t.position_size_usd).toFixed(0)}
                    </td>
                    <td className="py-2 text-right text-gray-400 text-xs">
                      ${Number(t.take_profit).toFixed(4)} / ${Number(t.stop_loss).toFixed(4)}
                    </td>
                    <td className="py-2 text-right">
                      <span className={`badge ${
                        t.status === 'open' ? 'badge-info' :
                        t.status === 'tp_hit' ? 'badge-success' :
                        t.status === 'sl_hit' ? 'badge-danger' :
                        'badge-warning'
                      }`}>
                        {t.status}
                      </span>
                    </td>
                    <td className={`py-2 text-right ${
                      (t.realized_pnl ?? 0) > 0 ? 'text-green-400' :
                      (t.realized_pnl ?? 0) < 0 ? 'text-red-400' : 'text-gray-500'
                    }`}>
                      {t.realized_pnl != null
                        ? `${t.realized_pnl > 0 ? '+' : ''}$${Number(t.realized_pnl).toFixed(2)}`
                        : '--'
                      }
                    </td>
                    <td className="py-2 text-right text-gray-500 text-xs">
                      {new Date(t.opened_at).toLocaleDateString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
