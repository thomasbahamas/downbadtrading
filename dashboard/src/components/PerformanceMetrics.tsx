'use client';

import type { TradeStats } from '@/lib/types';

interface Props {
  stats: TradeStats;
}

function StatCard({
  label,
  value,
  sub,
  valueClass,
}: {
  label: string;
  value: string;
  sub?: string;
  valueClass?: string;
}) {
  return (
    <div className="card-sm">
      <p className="text-xs text-gray-500 mb-1">{label}</p>
      <p className={`text-xl font-semibold ${valueClass ?? 'text-white'}`}>{value}</p>
      {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
    </div>
  );
}

export default function PerformanceMetrics({ stats }: Props) {
  const winRatePct = (stats.win_rate * 100).toFixed(1);
  const avgWinnerPct = (stats.avg_winner_pct * 100).toFixed(1);
  const avgLoserPct = (stats.avg_loser_pct * 100).toFixed(1);
  const totalPnlStr = stats.total_pnl >= 0
    ? `+$${stats.total_pnl.toFixed(2)}`
    : `-$${Math.abs(stats.total_pnl).toFixed(2)}`;

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
      <StatCard
        label="Win Rate"
        value={`${winRatePct}%`}
        sub={`${stats.total_wins}W / ${stats.total_losses}L`}
        valueClass={parseFloat(winRatePct) >= 50 ? 'text-profit' : 'text-loss'}
      />
      <StatCard
        label="Total P&L"
        value={totalPnlStr}
        sub={`${stats.total_closed} closed trades`}
        valueClass={stats.total_pnl >= 0 ? 'text-profit' : 'text-loss'}
      />
      <StatCard
        label="Avg Winner"
        value={`+${avgWinnerPct}%`}
        valueClass="text-profit"
      />
      <StatCard
        label="Avg Loser"
        value={`-${Math.abs(parseFloat(avgLoserPct)).toFixed(1)}%`}
        valueClass="text-loss"
      />
    </div>
  );
}
