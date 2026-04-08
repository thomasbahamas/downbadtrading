import { supabase } from '@/lib/supabase';
import type { Trade, TradeStats, AgentActivity } from '@/lib/types';
import PortfolioCard from '@/components/PortfolioCard';
import ActivePositions from '@/components/ActivePositions';
import AgentStatus from '@/components/AgentStatus';
import StatsBar from '@/components/StatsBar';
import LiveFeed from '@/components/LiveFeed';
import EquityCurve from '@/components/EquityCurve';
import TradeRecommendations from '@/components/TradeRecommendations';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getData() {
  const [positionsRes, statsRes, recentRes, closedRes, activityRes, thesesCountRes] = await Promise.all([
    supabase.from('trades').select('*').eq('status', 'open').order('opened_at', { ascending: false }),
    supabase.from('trade_stats').select('*').single(),
    supabase.from('trades').select('*').order('opened_at', { ascending: false }).limit(20),
    supabase.from('trades').select('realized_pnl, realized_pnl_pct, closed_at, opened_at, position_size_usd').neq('status', 'open').neq('status', 'pending_approval').not('realized_pnl', 'is', null),
    supabase.from('agent_activity').select('*').order('created_at', { ascending: false }).limit(50),
    // Count total theses generated (includes rejected ones)
    supabase.from('agent_activity').select('id', { count: 'exact', head: true }).eq('type', 'thesis'),
  ]);

  // Count tokens scanned from most recent scan activity
  const scanActivities = (activityRes.data as AgentActivity[] ?? []).filter(a => a.type === 'scan');
  const latestScan = scanActivities[0];
  const tokensScanned = (latestScan?.metadata as Record<string, unknown>)?.tokensScanned as number ?? 30;

  // Count no-trade signals
  const noTradeCount = (activityRes.data as AgentActivity[] ?? []).filter(a => a.type === 'no_trade').length;

  return {
    positions: (positionsRes.data as Trade[]) ?? [],
    stats: (statsRes.data as TradeStats) ?? null,
    recentTrades: (recentRes.data as Trade[]) ?? [],
    closedTrades: closedRes.data ?? [],
    activities: (activityRes.data as AgentActivity[]) ?? [],
    thesesCount: (thesesCountRes.count ?? 0) + noTradeCount, // total analyses = theses + no-trades
    tokensScanned,
  };
}

export default async function DashboardPage() {
  const { positions, stats, recentTrades, closedTrades, activities, thesesCount, tokensScanned } = await getData();

  // Portfolio metrics
  const deployedCapital = positions.reduce((sum, p) => sum + Number(p.position_size_usd), 0);
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);

  // Today's PnL
  const today = new Date().toISOString().slice(0, 10);
  const todaysClosed = closedTrades.filter((t) => t.closed_at && String(t.closed_at).startsWith(today));
  const todayPnl = todaysClosed.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const todayPnlPct = deployedCapital > 0 ? todayPnl / deployedCapital : 0;

  // Track record stats
  const closedPnls = closedTrades
    .map(t => Number(t.realized_pnl ?? 0))
    .filter(n => !isNaN(n));
  const bestTrade = closedPnls.length > 0 ? Math.max(...closedPnls) : null;
  const worstTrade = closedPnls.length > 0 ? Math.min(...closedPnls) : null;

  // Average hold time
  const holdTimes = closedTrades
    .filter(t => t.opened_at && t.closed_at)
    .map(t => new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime());
  const avgHoldMs = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
  const avgHoldTime = formatDuration(avgHoldMs);

  // Estimate total tokens analyzed from scan count * tokens per scan
  const scanCount = activities.filter(a => a.type === 'scan' || a.type === 'loop_summary').length;
  const totalTokensAnalyzed = Math.max(scanCount * tokensScanned, tokensScanned);

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">DownBad Trading</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Autonomous Solana trading agent — all trades executed by AI
        </p>
      </div>

      {/* Decision funnel + track record */}
      <StatsBar
        tokensAnalyzed={totalTokensAnalyzed}
        thesesGenerated={thesesCount}
        tradesExecuted={recentTrades.length}
        openPositions={positions.length}
        winRate={stats?.win_rate ?? 0}
        totalPnl={totalRealizedPnl}
        avgHoldTime={avgHoldTime}
        bestTrade={bestTrade !== null && bestTrade > 0 ? bestTrade : null}
        worstTrade={worstTrade !== null && worstTrade < 0 ? worstTrade : null}
      />

      {/* Active positions */}
      <ActivePositions positions={positions} />

      {/* TRADE ANALYSIS — the primary content */}
      <TradeRecommendations trades={recentTrades} tokensScannedPerLoop={tokensScanned} />

      {/* Equity curve */}
      <EquityCurve trades={recentTrades} />

      {/* Two-column: Agent status + Journal */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="space-y-4">
          <PortfolioCard
            deployedCapital={deployedCapital}
            dailyPnl={todayPnl}
            dailyPnlPct={todayPnlPct}
            totalPnl={totalRealizedPnl}
            openPositions={positions.length}
            totalTrades={recentTrades.length}
          />
          <AgentStatus />
        </div>
        <div className="lg:col-span-2">
          <LiveFeed initialActivities={activities} />
        </div>
      </div>
    </div>
  );
}

function formatDuration(ms: number): string {
  if (ms === 0) return '';
  const hours = Math.floor(ms / (1000 * 60 * 60));
  const mins = Math.floor((ms / (1000 * 60)) % 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
