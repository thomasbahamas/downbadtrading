'use client';

interface Props {
  totalTrades: number;
  openPositions: number;
  winRate: number;
  totalPnl: number;
  exchangesMonitored: number;
}

export default function StatsBar({ totalTrades, openPositions, winRate, totalPnl, exchangesMonitored }: Props) {
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 bg-surface-1/50 rounded-xl border border-surface-border/50">
      <Stat label="Trades Executed" value={totalTrades.toString()} />
      <div className="w-px h-4 bg-surface-border/50 hidden sm:block" />
      <Stat label="Open Positions" value={openPositions.toString()} />
      <div className="w-px h-4 bg-surface-border/50 hidden sm:block" />
      <Stat
        label="Win Rate"
        value={totalTrades > 0 ? `${(winRate * 100).toFixed(0)}%` : '--'}
        valueClass={winRate >= 0.5 ? 'text-profit' : winRate > 0 ? 'text-loss' : undefined}
      />
      <div className="w-px h-4 bg-surface-border/50 hidden sm:block" />
      <Stat
        label="Total P&L"
        value={totalPnl !== 0 ? `${totalPnl > 0 ? '+' : ''}$${totalPnl.toFixed(2)}` : '$0.00'}
        valueClass={totalPnl > 0 ? 'text-profit' : totalPnl < 0 ? 'text-loss' : undefined}
      />
      <div className="w-px h-4 bg-surface-border/50 hidden sm:block" />
      <Stat label="Exchanges Monitored" value={exchangesMonitored.toString()} />
      <div className="ml-auto flex items-center gap-1.5">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
        <span className="text-xs text-gray-500">Autonomous</span>
      </div>
    </div>
  );
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-500">{label}</span>
      <span className={`text-sm font-semibold mono ${valueClass ?? 'text-white'}`}>{value}</span>
    </div>
  );
}
