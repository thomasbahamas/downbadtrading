import { supabase } from '@/lib/supabase';
import type { Trade, TradeStats, AgentActivity } from '@/lib/types';
import PortfolioCard from '@/components/PortfolioCard';
import ActivePositions from '@/components/ActivePositions';
import AgentStatus from '@/components/AgentStatus';
import StatsBar from '@/components/StatsBar';
import LiveFeed from '@/components/LiveFeed';
import EquityCurve from '@/components/EquityCurve';

// Always fetch fresh data
export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getData() {
  // Run all queries in parallel
  const [positionsRes, statsRes, recentRes, closedRes, activityRes] = await Promise.all([
    supabase.from('trades').select('*').eq('status', 'open').order('opened_at', { ascending: false }),
    supabase.from('trade_stats').select('*').single(),
    supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(20),
    supabase.from('trades').select('realized_pnl, realized_pnl_pct, closed_at, position_size_usd').neq('status', 'open').neq('status', 'pending_approval').not('realized_pnl', 'is', null),
    supabase.from('agent_activity').select('*').order('created_at', { ascending: false }).limit(30),
  ]);

  return {
    positions: (positionsRes.data as Trade[]) ?? [],
    stats: (statsRes.data as TradeStats) ?? null,
    recentTrades: (recentRes.data as Trade[]) ?? [],
    closedTrades: closedRes.data ?? [],
    activities: (activityRes.data as AgentActivity[]) ?? [],
  };
}

export default async function DashboardPage() {
  const { positions, stats, recentTrades, closedTrades, activities } = await getData();

  // Compute portfolio metrics from trades data
  const deployedCapital = positions.reduce((sum, p) => sum + Number(p.position_size_usd), 0);
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);

  // Today's PnL
  const today = new Date().toISOString().slice(0, 10);
  const todaysClosed = closedTrades.filter((t) => t.closed_at && String(t.closed_at).startsWith(today));
  const todayPnl = todaysClosed.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const todayPnlPct = deployedCapital > 0 ? todayPnl / deployedCapital : 0;

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">DownBad Trading</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Autonomous Solana trading agent — all trades executed by AI
        </p>
      </div>

      {/* Stats bar */}
      <StatsBar
        totalTrades={recentTrades.length}
        openPositions={positions.length}
        winRate={stats?.win_rate ?? 0}
        totalPnl={totalRealizedPnl}
        exchangesMonitored={4}
      />

      {/* Top row: portfolio + agent status + live feed */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <PortfolioCard
          deployedCapital={deployedCapital}
          dailyPnl={todayPnl}
          dailyPnlPct={todayPnlPct}
          totalPnl={totalRealizedPnl}
          openPositions={positions.length}
          totalTrades={recentTrades.length}
        />
        <AgentStatus />
        <LiveFeed initialActivities={activities} />
      </div>

      {/* Equity curve */}
      <EquityCurve trades={recentTrades} />

      {/* Active positions with reasoning */}
      <ActivePositions positions={positions} />

      {/* Recent trades */}
      {recentTrades.length > 0 && (
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-white">Recent Trades</h2>
            <a href="/trades" className="text-xs text-gray-500 hover:text-solana-light transition-colors">
              View all
            </a>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left pb-2">Token</th>
                  <th className="text-left pb-2">Why</th>
                  <th className="text-right pb-2">Entry</th>
                  <th className="text-right pb-2">Size</th>
                  <th className="text-right pb-2">Status</th>
                  <th className="text-right pb-2">P&L</th>
                  <th className="text-right pb-2">Time</th>
                </tr>
              </thead>
              <tbody>
                {recentTrades.slice(0, 10).map((t) => (
                  <tr key={t.id} className="border-b border-gray-800/50 hover:bg-surface-2/50">
                    <td className="py-2 text-white font-medium">
                      {t.token_symbol}
                      {t.confidence_score > 0 && (
                        <span className="text-xs text-gray-600 ml-1">
                          {(t.confidence_score * 100).toFixed(0)}%
                        </span>
                      )}
                    </td>
                    <td className="py-2 text-xs text-gray-500 max-w-48 truncate">
                      {t.reasoning || '--'}
                    </td>
                    <td className="py-2 text-right text-gray-300 mono text-xs">
                      ${Number(t.entry_price).toFixed(4)}
                    </td>
                    <td className="py-2 text-right text-gray-300 mono text-xs">
                      ${Number(t.position_size_usd).toFixed(0)}
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
                    <td className={`py-2 text-right mono text-xs ${
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
