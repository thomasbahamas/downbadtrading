'use client';

import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import type { Trade } from '@/lib/types';

interface Props {
  trades: Trade[];
}

interface ChartPoint {
  date: string;
  cumPnl: number;
  trade: string;
}

export default function EquityCurve({ trades }: Props) {
  // Build cumulative PnL from closed trades sorted by close date
  const closedTrades = trades
    .filter((t) => t.status !== 'open' && t.realized_pnl !== null && t.closed_at)
    .sort((a, b) => new Date(a.closed_at!).getTime() - new Date(b.closed_at!).getTime());

  if (closedTrades.length < 2) {
    return null; // Not enough data for a chart
  }

  let cumPnl = 0;
  const data: ChartPoint[] = closedTrades.map((t) => {
    cumPnl += t.realized_pnl ?? 0;
    return {
      date: new Date(t.closed_at!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      cumPnl: parseFloat(cumPnl.toFixed(2)),
      trade: `${t.token_symbol} ${t.realized_pnl! > 0 ? '+' : ''}$${t.realized_pnl!.toFixed(2)}`,
    };
  });

  const isPositive = cumPnl >= 0;
  const gradientColor = isPositive ? '#22c55e' : '#ef4444';
  const lineColor = isPositive ? '#22c55e' : '#ef4444';

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <p className="text-sm font-semibold text-white">Equity Curve</p>
        <p className={`text-sm mono ${isPositive ? 'text-profit' : 'text-loss'}`}>
          {isPositive ? '+' : ''}${cumPnl.toFixed(2)}
        </p>
      </div>
      <div className="h-40">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="pnlGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={gradientColor} stopOpacity={0.3} />
                <stop offset="100%" stopColor={gradientColor} stopOpacity={0} />
              </linearGradient>
            </defs>
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
              width={45}
            />
            <Tooltip
              contentStyle={{
                backgroundColor: '#1A1A1E',
                border: '1px solid #2A2A32',
                borderRadius: '8px',
                fontSize: '12px',
                color: '#E5E7EB',
              }}
              formatter={(value: number) => [`$${value.toFixed(2)}`, 'Cumulative P&L']}
              labelFormatter={(label, payload) => {
                const point = payload?.[0]?.payload as ChartPoint | undefined;
                return point ? `${label} — ${point.trade}` : label;
              }}
            />
            <ReferenceLine y={0} stroke="#2A2A32" />
            <Area
              type="monotone"
              dataKey="cumPnl"
              stroke={lineColor}
              strokeWidth={2}
              fill="url(#pnlGradient)"
              dot={false}
              activeDot={{ r: 4, fill: lineColor }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
