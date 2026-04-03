'use client';

interface PortfolioCardProps {
  endingBalanceUsd: number;
  startingBalanceUsd: number;
  dailyPnl: number;
  dailyPnlPct: number;
  totalPnl: number;
  openPositions: number;
}

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function pnlClass(n: number): string {
  if (n > 0) return 'text-profit';
  if (n < 0) return 'text-loss';
  return 'text-gray-400';
}

function pnlSign(n: number): string {
  return n > 0 ? '+' : '';
}

export default function PortfolioCard({
  endingBalanceUsd,
  startingBalanceUsd,
  dailyPnl,
  dailyPnlPct,
  totalPnl,
  openPositions,
}: PortfolioCardProps) {
  return (
    <div className="card h-full">
      <div className="flex items-start justify-between mb-6">
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">
            Portfolio Value
          </p>
          <p className="text-3xl font-semibold text-white tracking-tight">
            ${fmt(endingBalanceUsd)}
          </p>
        </div>
        <span className="badge bg-solana/15 text-solana-light text-xs">
          {openPositions} open
        </span>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {/* Daily P&L */}
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Today's P&L</p>
          <p className={`text-lg font-semibold ${pnlClass(dailyPnl)}`}>
            {pnlSign(dailyPnl)}${fmt(Math.abs(dailyPnl))}
          </p>
          <p className={`text-xs mt-0.5 ${pnlClass(dailyPnlPct)}`}>
            {pnlSign(dailyPnlPct)}{fmt(Math.abs(dailyPnlPct))}%
          </p>
        </div>

        {/* Total P&L */}
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Total P&L</p>
          <p className={`text-lg font-semibold ${pnlClass(totalPnl)}`}>
            {pnlSign(totalPnl)}${fmt(Math.abs(totalPnl))}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">all-time</p>
        </div>

        {/* Starting balance */}
        <div className="bg-surface-2 rounded-lg p-3">
          <p className="text-xs text-gray-500 mb-1">Start of Day</p>
          <p className="text-lg font-semibold text-white">
            ${fmt(startingBalanceUsd)}
          </p>
          <p className="text-xs text-gray-500 mt-0.5">base capital</p>
        </div>
      </div>
    </div>
  );
}
