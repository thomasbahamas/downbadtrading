'use client';

import type { Trade } from '@/lib/types';

interface Props {
  positions: Trade[];
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
                    {pos.confidence_score > 0 && (
                      <span className="text-xs text-gray-600 ml-2">
                        {(pos.confidence_score * 100).toFixed(0)}% conf
                      </span>
                    )}
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

              {/* Trade reasoning */}
              {pos.reasoning && (
                <div className="mt-2 pt-2 border-t border-surface-border/30">
                  <p className="text-xs text-gray-500">
                    <span className="text-gray-400 font-medium">Why: </span>
                    {pos.reasoning}
                  </p>
                </div>
              )}

              {/* Signal breakdown */}
              {pos.signals && typeof pos.signals === 'object' && Object.keys(pos.signals).length > 0 && (
                <div className="grid grid-cols-2 gap-1 mt-1.5">
                  {Object.entries(pos.signals)
                    .filter(([, v]) => v && v !== 'n/a' && v !== '')
                    .map(([key, value]) => (
                      <p key={key} className="text-xs text-gray-600">
                        <span className="capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}</span>: {value}
                      </p>
                    ))
                  }
                </div>
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
