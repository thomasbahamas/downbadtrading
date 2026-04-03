'use client';

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { DailyPerformance, TradeStats } from '@/lib/types';

interface Props {
  stats: TradeStats;
  dailyPerf: DailyPerformance[];
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

interface ChartDataPoint {
  date: string;
  pnl: number;
  cumPnl: number;
}

export default function PerformanceMetrics({ stats, dailyPerf }: Props) {
  // Build cumulative PnL chart data
  let cumPnl = 0;
  const chartData: ChartDataPoint[] = [...dailyPerf]
    .reverse()
    .map((d) => {
      cumPnl += d.realized_pnl ?? 0;
      return {
        date: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        pnl: d.realized_pnl ?? 0,
        cumPnl,
      };
    });

  const winRatePct = (stats.win_rate * 100).toFixed(1);
  const avgWinnerPct = (stats.avg_winner_pct * 100).toFixed(1);
  const avgLoserPct = (stats.avg_loser_pct * 100).toFixed(1);
  // Sharpe approximation: avg daily pnl / stddev of daily pnl
  const avgDailyPnl =
    dailyPerf.length > 0
      ? dailyPerf.reduce((s, d) => s + (d.realized_pnl ?? 0), 0) / dailyPerf.length
      : 0;
  const stdDev = Math.sqrt(
    dailyPerf.reduce((s, d) => s + Math.pow((d.realized_pnl ?? 0) - avgDailyPnl, 2), 0) /
      Math.max(dailyPerf.length - 1, 1)
  );
  const sharpe = stdDev > 0 ? ((avgDailyPnl / stdDev) * Math.sqrt(252)).toFixed(2) : '—';

  return (
    <div className="space-y-4">
      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatCard
          label="Win Rate"
          value={`${winRatePct}%`}
          sub={`${stats.total_wins}W / ${stats.total_losses}L`}
          valueClass={parseFloat(winRatePct) >= 50 ? 'text-profit' : 'text-loss'}
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
        <StatCard
          label="Sharpe (annual)"
          value={sharpe.toString()}
          sub="estimated"
          valueClass={parseFloat(sharpe) > 1 ? 'text-profit' : 'text-warning'}
        />
      </div>

      {/* Cumulative PnL chart */}
      {chartData.length > 1 && (
        <div className="card">
          <p className="text-xs text-gray-500 font-medium mb-4">Cumulative P&L (30d)</p>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="date"
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v}`}
                  width={50}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: '#1A1A1E',
                    border: '1px solid #2A2A32',
                    borderRadius: '8px',
                    fontSize: '12px',
                    color: '#E5E7EB',
                  }}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cum. PnL']}
                />
                <ReferenceLine y={0} stroke="#2A2A32" />
                <Line
                  type="monotone"
                  dataKey="cumPnl"
                  stroke="#9945FF"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 4, fill: '#9945FF' }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}
    </div>
  );
}
