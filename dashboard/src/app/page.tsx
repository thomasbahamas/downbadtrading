import { supabase } from '@/lib/supabase';
import type { Trade, DailyPerformance, TradeStats } from '@/lib/types';
import PortfolioCard from '@/components/PortfolioCard';
import ActivePositions from '@/components/ActivePositions';
import AgentStatus from '@/components/AgentStatus';
import PerformanceMetrics from '@/components/PerformanceMetrics';

// Revalidate every 30 seconds
export const revalidate = 30;

async function getData() {
  const [openPositions, dailyPerf, statsResp] = await Promise.allSettled([
    supabase
      .from('trades')
      .select('*')
      .eq('status', 'open')
      .order('opened_at', { ascending: false }),
    supabase
      .from('daily_performance')
      .select('*')
      .order('date', { ascending: false })
      .limit(30),
    supabase.from('trade_stats').select('*').single(),
  ]);

  return {
    positions:
      openPositions.status === 'fulfilled' ? (openPositions.value.data as Trade[]) ?? [] : [],
    dailyPerf:
      dailyPerf.status === 'fulfilled'
        ? (dailyPerf.value.data as DailyPerformance[]) ?? []
        : [],
    stats:
      statsResp.status === 'fulfilled' ? (statsResp.value.data as TradeStats) ?? null : null,
  };
}

export default async function DashboardPage() {
  const { positions, dailyPerf, stats } = await getData();

  const latestDay = dailyPerf[0];
  const totalPnl = dailyPerf.reduce((sum, d) => sum + (d.realized_pnl ?? 0), 0);

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
            endingBalanceUsd={latestDay?.ending_balance_usd ?? 0}
            startingBalanceUsd={latestDay?.starting_balance_usd ?? 0}
            dailyPnl={latestDay?.realized_pnl ?? 0}
            dailyPnlPct={latestDay?.realized_pnl_pct ?? 0}
            totalPnl={totalPnl}
            openPositions={positions.length}
          />
        </div>
        <AgentStatus />
      </div>

      {/* Performance metrics */}
      {stats && (
        <PerformanceMetrics
          stats={stats}
          dailyPerf={dailyPerf}
        />
      )}

      {/* Active positions */}
      <ActivePositions positions={positions} />
    </div>
  );
}
