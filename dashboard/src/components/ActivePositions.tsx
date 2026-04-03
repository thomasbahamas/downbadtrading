'use client';

import type { Trade } from '@/lib/types';

interface Props {
  positions: Trade[];
}

function pnlColor(n: number | null): string {
  if (n === null) return 'text-gray-400';
  if (n > 0) return 'text-profit';
  if (n < 0) return 'text-loss';
  return 'text-gray-400';
}

export default function ActivePositions({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-3">Active Positions</h2>
        <p className="text-sm text-gray-500 text-center py-6">No open positions</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Active Positions</h2>
        <span className="text-xs text-gray-500">{positions.length} open</span>
      </div>

      <div className="space-y-2">
        {positions.map((pos) => {
          const timeSinceEntry = Date.now() - new Date(pos.opened_at).getTime();
          const hoursOpen = Math.floor(timeSinceEntry / (1000 * 60 * 60));
          const minsOpen = Math.floor((timeSinceEntry / (1000 * 60)) % 60);
          const timeLabel = hoursOpen > 0 ? `${hoursOpen}h ${minsOpen}m` : `${minsOpen}m`;

          // TP/SL range as % from entry
          const tpPct = ((pos.take_profit - pos.entry_price) / pos.entry_price) * 100;
          const slPct = ((pos.stop_loss - pos.entry_price) / pos.entry_price) * 100;

          return (
            <div
              key={pos.id}
              className="bg-surface-2/50 rounded-lg p-3 border border-surface-border/50 hover:border-surface-border transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-white font-medium text-sm">{pos.token_symbol}</span>
                    <span className="text-gray-500 text-xs ml-2">
                      {pos.direction === 'buy' ? 'LONG' : 'SHORT'}
                    </span>
                  </div>
                </div>
                <div className="text-right">
                  <p className="text-xs text-gray-500">{timeLabel} ago</p>
                </div>
              </div>

              <div className="grid grid-cols-4 gap-3 mt-2">
                <div>
                  <p className="text-xs text-gray-500">Entry</p>
                  <p className="text-xs mono text-gray-300">
                    ${pos.entry_price.toPrecision(5)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-gray-500">Size</p>
                  <p className="text-xs mono text-gray-300">
                    ${pos.position_size_usd.toFixed(0)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-profit">TP {tpPct >= 0 ? '+' : ''}{tpPct.toFixed(1)}%</p>
                  <p className="text-xs mono text-gray-400">
                    ${pos.take_profit.toPrecision(5)}
                  </p>
                </div>
                <div>
                  <p className="text-xs text-loss">SL {slPct.toFixed(1)}%</p>
                  <p className="text-xs mono text-gray-400">
                    ${pos.stop_loss.toPrecision(5)}
                  </p>
                </div>
              </div>

              {pos.reasoning && (
                <p className="text-xs text-gray-600 mt-2 truncate">{pos.reasoning}</p>
              )}

              {pos.entry_tx && (
                <div className="mt-2">
                  <a
                    href={`https://solscan.io/tx/${pos.entry_tx}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-gray-500 hover:text-solana-light"
                  >
                    View on Solscan
                  </a>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
