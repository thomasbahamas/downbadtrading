import { supabase } from '@/lib/supabase';
import { getPools, pickDefaultPool } from '@/lib/pools';
import type { Trade, TradeStats, AgentActivity } from '@/lib/types';
import PortfolioCard from '@/components/PortfolioCard';
import ActivePositions from '@/components/ActivePositions';
import AgentStatus from '@/components/AgentStatus';
import StatsBar from '@/components/StatsBar';
import LiveFeed from '@/components/LiveFeed';
import PerformanceCharts from '@/components/PerformanceCharts';
import TradeRecommendations from '@/components/TradeRecommendations';
import DashboardShell from '@/components/DashboardShell';
import PoolsPanel from '@/components/PoolsPanel';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

interface PageProps {
  searchParams?: { pool?: string };
}

async function getData(activePoolId: string | null) {
  // Scope by pool only when the activePoolId looks real. The pools migration
  // (001_pools.sql) adds a pool_id column and backfills existing rows to the
  // default pool. Pre-migration installs get the "fallback-main" synthetic
  // id and we skip the filter entirely.
  const scopeByPool = activePoolId !== null && !activePoolId.startsWith('fallback');

  // Build queries inline rather than through a generic helper — Supabase's
  // query-builder types are too complex to infer through a generic wrapper
  // (TS2589 "instantiation excessively deep").
  let positionsQuery = supabase.from('trades').select('*').eq('status', 'open');
  let recentQuery = supabase.from('trades').select('*');
  let closedQuery = supabase
    .from('trades')
    .select('realized_pnl, realized_pnl_pct, closed_at, opened_at, position_size_usd, status, token_symbol')
    .neq('status', 'open')
    .neq('status', 'pending_approval')
    .not('realized_pnl', 'is', null);
  let activityQuery = supabase.from('agent_activity').select('*');
  let thesesCountQuery = supabase
    .from('agent_activity')
    .select('id', { count: 'exact', head: true })
    .eq('type', 'thesis');

  if (scopeByPool) {
    positionsQuery = positionsQuery.eq('pool_id', activePoolId);
    recentQuery = recentQuery.eq('pool_id', activePoolId);
    closedQuery = closedQuery.eq('pool_id', activePoolId);
    activityQuery = activityQuery.eq('pool_id', activePoolId);
    thesesCountQuery = thesesCountQuery.eq('pool_id', activePoolId);
  }

  const [positionsRes, statsRes, recentRes, closedRes, activityRes, thesesCountRes] = await Promise.all([
    positionsQuery.order('opened_at', { ascending: false }),
    supabase.from('trade_stats').select('*').single(),
    recentQuery.order('opened_at', { ascending: false }).limit(20),
    closedQuery,
    activityQuery.order('created_at', { ascending: false }).limit(50),
    thesesCountQuery,
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
    closedTrades: (closedRes.data as Trade[]) ?? [],
    activities: (activityRes.data as AgentActivity[]) ?? [],
    thesesCount: (thesesCountRes.count ?? 0) + noTradeCount,
    tokensScanned,
  };
}

export default async function DashboardPage({ searchParams }: PageProps) {
  // Resolve pool first — needed to scope the data queries
  const { pools, stats: poolStats } = await getPools();
  const requestedSlug = searchParams?.pool;
  const matchedPool = requestedSlug
    ? pools.find((p) => p.slug === requestedSlug)
    : undefined;
  const activePool = matchedPool ?? pickDefaultPool(pools);
  const activePoolId = activePool?.id ?? null;

  const { positions, stats, recentTrades, closedTrades, activities, thesesCount, tokensScanned } =
    await getData(activePoolId);

  // ── Derived portfolio metrics ────────────────────────────────────────
  const deployedCapital = positions.reduce((sum, p) => sum + Number(p.position_size_usd), 0);
  const totalRealizedPnl = closedTrades.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);

  const today = new Date().toISOString().slice(0, 10);
  const todaysClosed = closedTrades.filter((t) => t.closed_at && String(t.closed_at).startsWith(today));
  const todayPnl = todaysClosed.reduce((sum, t) => sum + Number(t.realized_pnl ?? 0), 0);
  const todayPnlPct = deployedCapital > 0 ? todayPnl / deployedCapital : 0;

  const closedPnls = closedTrades
    .map(t => Number(t.realized_pnl ?? 0))
    .filter(n => !isNaN(n));
  const bestTrade = closedPnls.length > 0 ? Math.max(...closedPnls) : null;
  const worstTrade = closedPnls.length > 0 ? Math.min(...closedPnls) : null;

  const holdTimes = closedTrades
    .filter(t => t.opened_at && t.closed_at)
    .map(t => new Date(t.closed_at!).getTime() - new Date(t.opened_at).getTime());
  const avgHoldMs = holdTimes.length > 0 ? holdTimes.reduce((a, b) => a + b, 0) / holdTimes.length : 0;
  const avgHoldTime = formatDuration(avgHoldMs);

  const scanCount = activities.filter(a => a.type === 'scan' || a.type === 'loop_summary').length;
  const totalTokensAnalyzed = Math.max(scanCount * tokensScanned, tokensScanned);

  // ── Tab content nodes ────────────────────────────────────────────────
  const heroStats = (
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
  );

  const overviewTab = (
    <div className="space-y-5">
      {heroStats}
      <ActivePositions positions={positions} />
      <TradeRecommendations trades={recentTrades} tokensScannedPerLoop={tokensScanned} />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <PortfolioCard
          deployedCapital={deployedCapital}
          dailyPnl={todayPnl}
          dailyPnlPct={todayPnlPct}
          totalPnl={totalRealizedPnl}
          openPositions={positions.length}
          totalTrades={recentTrades.length}
        />
        <div className="lg:col-span-2">
          <AgentStatus />
        </div>
      </div>
    </div>
  );

  const performanceTab = (
    <div className="space-y-5">
      {heroStats}
      <PerformanceCharts trades={recentTrades} />
    </div>
  );

  const activityTab = (
    <div className="space-y-5">
      {heroStats}
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

  const poolsTab = <PoolsPanel pools={pools} stats={poolStats} />;

  return (
    <DashboardShell
      pools={pools}
      poolStats={poolStats}
      activePoolId={activePoolId ?? ''}
      overview={overviewTab}
      performance={performanceTab}
      activity={activityTab}
      poolsTab={poolsTab}
    />
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
