'use client';

interface Props {
  endingBalanceUsd: number;
  startingBalanceUsd: number;
  dailyPnl: number;
  dailyPnlPct: number;
  totalPnl: number;
  openPositions: number;
}

function pnlColor(n: number): string {
  if (n > 0) return 'text-profit';
  if (n < 0) return 'text-loss';
  return 'text-gray-400';
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export default function PortfolioCard({
  endingBalanceUsd,
  startingBalanceUsd,
  dailyPnl,
  dailyPnlPct,
  totalPnl,
  openPositions,
}: Props) {
  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">Portfolio</h2>
        <span className="text-xs text-gray-500">Today</span>
      </div>

      {/* Balance */}
      <div className="mb-4">
        <p className="text-3xl font-bold text-white mono">
          {formatUsd(endingBalanceUsd)}
        </p>
        <div className="flex items-center gap-2 mt-1">
          <span className={`text-sm mono ${pnlColor(dailyPnl)}`}>
            {dailyPnl >= 0 ? '+' : ''}{formatUsd(dailyPnl)}
          </span>
          <span className={`text-xs ${pnlColor(dailyPnlPct)}`}>
            ({formatPct(dailyPnlPct)})
          </span>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-surface-border">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Start of Day</p>
          <p className="text-sm mono text-gray-300">{formatUsd(startingBalanceUsd)}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Total P&L</p>
          <p className={`text-sm mono ${pnlColor(totalPnl)}`}>
            {totalPnl >= 0 ? '+' : ''}{formatUsd(totalPnl)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Open Positions</p>
          <p className="text-sm mono text-white">{openPositions}</p>
        </div>
      </div>
    </div>
  );
}
