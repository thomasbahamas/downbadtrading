'use client';

import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell,
} from 'recharts';
import type { Trade } from '@/lib/types';

interface Props {
  trades: Trade[];
}

interface EquityPoint {
  date: string;
  rawDate: string;
  cumPnl: number;
  trade: string;
}

interface DailyPoint {
  date: string;
  pnl: number;
  wins: number;
  losses: number;
}

interface WinRatePoint {
  index: number;
  label: string;
  winRatePct: number;
  window: string;
}

const GREEN = '#22c55e';
const RED = '#ef4444';
const NEUTRAL = '#6B7280';
const GRID = '#2A2A32';

/**
 * Combined performance view — replaces the single equity curve with three
 * complementary charts: cumulative equity, daily PnL bars, and a rolling
 * win rate. Closed trades only.
 */
export default function PerformanceCharts({ trades }: Props) {
  const closed = trades
    .filter((t) => t.status !== 'open' && t.realized_pnl !== null && t.closed_at)
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());

  if (closed.length < 2) {
    return (
      <div className="card">
        <p className="text-sm font-semibold text-white mb-2">Performance</p>
        <p className="text-sm text-gray-500 text-center py-8">
          Not enough closed trades yet. Charts will populate as the agent closes positions.
        </p>
      </div>
    );
  }

  // ── Equity curve ─────────────────────────────────────────────────────
  let cum = 0;
  const equityData: EquityPoint[] = closed.map((t) => {
    cum += t.realized_pnl ?? 0;
    const d = new Date(t.closed_at!);
    return {
      date: d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      rawDate: d.toISOString(),
      cumPnl: parseFloat(cum.toFixed(2)),
      trade: `${t.token_symbol} ${(t.realized_pnl ?? 0) >= 0 ? '+' : ''}$${(t.realized_pnl ?? 0).toFixed(2)}`,
    };
  });

  // ── Daily PnL aggregation ────────────────────────────────────────────
  const daily = new Map<string, DailyPoint>();
  for (const t of closed) {
    const key = new Date(t.closed_at!).toISOString().slice(0, 10);
    const existing = daily.get(key) ?? { date: key, pnl: 0, wins: 0, losses: 0 };
    const pnl = t.realized_pnl ?? 0;
    existing.pnl += pnl;
    if (pnl > 0) existing.wins += 1;
    else if (pnl < 0) existing.losses += 1;
    daily.set(key, existing);
  }
  const dailyData = Array.from(daily.values())
    .map((d) => ({
      ...d,
      pnl: parseFloat(d.pnl.toFixed(2)),
      label: new Date(d.date).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    }))
    .sort((a, b) => a.date.localeCompare(b.date));

  // ── Rolling win rate (10-trade window) ───────────────────────────────
  const WINDOW = Math.min(10, Math.max(3, Math.floor(closed.length / 2)));
  const winRateData: WinRatePoint[] = [];
  for (let i = WINDOW - 1; i < closed.length; i++) {
    const window = closed.slice(i - WINDOW + 1, i + 1);
    const wins = window.filter((t) => (t.realized_pnl ?? 0) > 0).length;
    winRateData.push({
      index: i + 1,
      label: `#${i + 1}`,
      winRatePct: parseFloat(((wins / WINDOW) * 100).toFixed(1)),
      window: `${wins}/${WINDOW}`,
    });
  }

  const isPositiveTotal = cum >= 0;
  const totalColor = isPositiveTotal ? GREEN : RED;

  return (
    <div className="space-y-4">
      {/* Equity curve */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <div>
            <p className="text-sm font-semibold text-white">Equity Curve</p>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mt-0.5">
              Cumulative realized P&amp;L · {closed.length} closed trades
            </p>
          </div>
          <p className={`text-lg mono font-semibold ${isPositiveTotal ? 'text-profit' : 'text-loss'}`}>
            {isPositiveTotal ? '+' : ''}${cum.toFixed(2)}
          </p>
        </div>
        <div className="h-48">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={equityData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="equityGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={totalColor} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={totalColor} stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis
                dataKey="date"
                tick={{ fontSize: 10, fill: NEUTRAL }}
                axisLine={false}
                tickLine={false}
                interval="preserveStartEnd"
              />
              <YAxis
                tick={{ fontSize: 10, fill: NEUTRAL }}
                axisLine={false}
                tickLine={false}
                tickFormatter={(v) => `$${v}`}
                width={50}
              />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative P&L']}
                labelFormatter={(label, payload) => {
                  const point = payload?.[0]?.payload as EquityPoint | undefined;
                  return point ? `${label} — ${point.trade}` : label;
                }}
              />
              <ReferenceLine y={0} stroke={GRID} />
              <Area
                type="monotone"
                dataKey="cumPnl"
                stroke={totalColor}
                strokeWidth={2}
                fill="url(#equityGradient)"
                dot={false}
                activeDot={{ r: 4, fill: totalColor }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Daily PnL bars + Win rate — side by side on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="card">
          <div className="mb-3">
            <p className="text-sm font-semibold text-white">Daily P&amp;L</p>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mt-0.5">
              Green = profit day · Red = loss day
            </p>
          </div>
          <div className="h-40">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dailyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 10, fill: NEUTRAL }}
                  axisLine={false}
                  tickLine={false}
                  interval="preserveStartEnd"
                />
                <YAxis
                  tick={{ fontSize: 10, fill: NEUTRAL }}
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(v) => `$${v}`}
                  width={50}
                />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, _name, entry) => {
                    const d = entry.payload as DailyPoint;
                    return [`$${value.toFixed(2)} · ${d.wins}W ${d.losses}L`, 'Daily P&L'];
                  }}
                />
                <ReferenceLine y={0} stroke={GRID} />
                <Bar dataKey="pnl" radius={[3, 3, 0, 0]}>
                  {dailyData.map((d, i) => (
                    <Cell key={i} fill={d.pnl >= 0 ? GREEN : RED} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card">
          <div className="mb-3">
            <p className="text-sm font-semibold text-white">Rolling Win Rate</p>
            <p className="text-[10px] text-gray-600 uppercase tracking-wider mt-0.5">
              Over last {WINDOW} closed trades
            </p>
          </div>
          <div className="h-40">
            {winRateData.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <p className="text-xs text-gray-600">Need {WINDOW}+ closed trades</p>
              </div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={winRateData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                  <XAxis
                    dataKey="label"
                    tick={{ fontSize: 10, fill: NEUTRAL }}
                    axisLine={false}
                    tickLine={false}
                    interval="preserveStartEnd"
                  />
                  <YAxis
                    tick={{ fontSize: 10, fill: NEUTRAL }}
                    axisLine={false}
                    tickLine={false}
                    tickFormatter={(v) => `${v}%`}
                    width={40}
                    domain={[0, 100]}
                  />
                  <Tooltip
                    contentStyle={tooltipStyle}
                    formatter={(value: number, _name, entry) => {
                      const p = entry.payload as WinRatePoint;
                      return [`${value.toFixed(0)}% (${p.window})`, 'Win rate'];
                    }}
                  />
                  <ReferenceLine y={50} stroke={GRID} strokeDasharray="3 3" />
                  <Line
                    type="monotone"
                    dataKey="winRatePct"
                    stroke="#9945FF"
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 4, fill: '#9945FF' }}
                  />
                </LineChart>
              </ResponsiveContainer>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

const tooltipStyle = {
  backgroundColor: '#1A1A1E',
  border: '1px solid #2A2A32',
  borderRadius: '8px',
  fontSize: '12px',
  color: '#E5E7EB',
};
