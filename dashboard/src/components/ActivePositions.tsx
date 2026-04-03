'use client';

import type { Trade } from '@/lib/types';

interface Props {
  positions: Trade[];
}

function pnlClass(n: number | null): string {
  if (n === null) return 'text-gray-400';
  if (n > 0) return 'text-profit';
  if (n < 0) return 'text-loss';
  return 'text-gray-400';
}

function solscanLink(tx: string): string {
  return `https://solscan.io/tx/${tx}`;
}

function formatAge(openedAt: string): string {
  const ms = Date.now() - new Date(openedAt).getTime();
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

export default function ActivePositions({ positions }: Props) {
  if (positions.length === 0) {
    return (
      <div className="card">
        <h2 className="text-sm font-semibold text-white mb-4">Active Positions</h2>
        <p className="text-sm text-gray-500 text-center py-8">No open positions</p>
      </div>
    );
  }

  return (
    <div className="card">
      <h2 className="text-sm font-semibold text-white mb-4">
        Active Positions{' '}
        <span className="text-xs text-gray-500 font-normal ml-1">
          ({positions.length})
        </span>
      </h2>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-surface-border">
              <th className="text-left pb-2 font-medium">Token</th>
              <th className="text-right pb-2 font-medium">Entry</th>
              <th className="text-right pb-2 font-medium">TP / SL</th>
              <th className="text-right pb-2 font-medium">Size</th>
              <th className="text-right pb-2 font-medium">Unr. P&L</th>
              <th className="text-right pb-2 font-medium">Age</th>
              <th className="text-right pb-2 font-medium">Tx</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/50">
            {positions.map((pos) => (
              <tr key={pos.id} className="hover:bg-surface-2/40 transition-colors">
                <td className="py-3 pr-4">
                  <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-solana/20 flex items-center justify-center text-xs text-solana-light font-bold">
                      {pos.token_symbol.slice(0, 1)}
                    </div>
                    <div>
                      <p className="text-white font-medium">{pos.token_symbol}</p>
                      <p className="text-xs text-gray-500 mono">
                        {pos.token_mint.slice(0, 6)}…
                      </p>
                    </div>
                  </div>
                </td>
                <td className="py-3 text-right mono text-gray-300">
                  ${pos.entry_price.toPrecision(5)}
                </td>
                <td className="py-3 text-right">
                  <p className="text-profit text-xs mono">
                    ▲ ${pos.take_profit.toPrecision(5)}
                  </p>
                  <p className="text-loss text-xs mono">
                    ▼ ${pos.stop_loss.toPrecision(5)}
                  </p>
                </td>
                <td className="py-3 text-right text-gray-300 mono">
                  ${pos.position_size_usd.toFixed(0)}
                </td>
                <td className={`py-3 text-right mono ${pnlClass(pos.realized_pnl)}`}>
                  {pos.realized_pnl !== null
                    ? `${pos.realized_pnl > 0 ? '+' : ''}$${Math.abs(pos.realized_pnl).toFixed(2)}`
                    : '—'}
                </td>
                <td className="py-3 text-right text-gray-500 text-xs">
                  {formatAge(pos.opened_at)}
                </td>
                <td className="py-3 text-right">
                  {pos.entry_tx && (
                    <a
                      href={solscanLink(pos.entry_tx)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-solana-light hover:underline"
                    >
                      ↗
                    </a>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
