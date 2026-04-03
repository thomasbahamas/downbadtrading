'use client';

import type { Trade } from '@/lib/types';

interface Props {
  trades: Trade[];
}

function statusBadge(status: Trade['status']) {
  switch (status) {
    case 'open':          return <span className="badge-open">Open</span>;
    case 'tp_hit':        return <span className="badge-tp">TP Hit</span>;
    case 'sl_hit':        return <span className="badge-sl">SL Hit</span>;
    case 'expired':       return <span className="badge-expired">Expired</span>;
    case 'manual_close':  return <span className="badge-expired">Manual</span>;
    case 'pending_approval': return <span className="badge badge-open">Pending</span>;
    default:              return <span className="badge-expired">{status}</span>;
  }
}

function pnlClass(n: number | null): string {
  if (n === null) return 'text-gray-400';
  return n > 0 ? 'text-profit' : n < 0 ? 'text-loss' : 'text-gray-400';
}

export default function TradeHistory({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="card">
        <p className="text-sm text-gray-500 text-center py-8">No trades yet</p>
      </div>
    );
  }

  return (
    <div className="card">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-xs text-gray-500 border-b border-surface-border">
              <th className="text-left pb-2 font-medium">Date</th>
              <th className="text-left pb-2 font-medium">Token</th>
              <th className="text-right pb-2 font-medium">Entry</th>
              <th className="text-right pb-2 font-medium">Exit</th>
              <th className="text-right pb-2 font-medium">Size</th>
              <th className="text-right pb-2 font-medium">P&L</th>
              <th className="text-right pb-2 font-medium">P&L %</th>
              <th className="text-center pb-2 font-medium">Status</th>
              <th className="text-right pb-2 font-medium">Links</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-surface-border/50">
            {trades.map((trade) => (
              <tr key={trade.id} className="hover:bg-surface-2/40 transition-colors group">
                <td className="py-3 pr-3 text-xs text-gray-500">
                  {new Date(trade.opened_at).toLocaleDateString('en-US', {
                    month: 'short',
                    day: 'numeric',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </td>
                <td className="py-3 pr-3">
                  <div>
                    <span className="text-white font-medium">{trade.token_symbol}</span>
                    <span className="text-gray-500 text-xs ml-2">
                      {trade.direction === 'buy' ? 'LONG' : 'SHORT'}
                    </span>
                  </div>
                  {trade.reasoning && (
                    <p className="text-xs text-gray-600 mt-0.5 max-w-xs truncate group-hover:text-gray-500">
                      {trade.reasoning}
                    </p>
                  )}
                </td>
                <td className="py-3 text-right mono text-gray-300 text-xs">
                  ${trade.entry_price.toPrecision(5)}
                </td>
                <td className="py-3 text-right mono text-gray-300 text-xs">
                  {trade.exit_price ? `$${trade.exit_price.toPrecision(5)}` : '—'}
                </td>
                <td className="py-3 text-right mono text-gray-400 text-xs">
                  ${trade.position_size_usd.toFixed(0)}
                </td>
                <td className={`py-3 text-right mono text-xs ${pnlClass(trade.realized_pnl)}`}>
                  {trade.realized_pnl !== null
                    ? `${trade.realized_pnl > 0 ? '+' : ''}$${Math.abs(trade.realized_pnl).toFixed(2)}`
                    : '—'}
                </td>
                <td className={`py-3 text-right mono text-xs ${pnlClass(trade.realized_pnl_pct)}`}>
                  {trade.realized_pnl_pct !== null
                    ? `${trade.realized_pnl_pct > 0 ? '+' : ''}${(trade.realized_pnl_pct * 100).toFixed(1)}%`
                    : '—'}
                </td>
                <td className="py-3 text-center">
                  {statusBadge(trade.status)}
                </td>
                <td className="py-3 text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {trade.entry_tx && (
                      <a
                        href={`https://solscan.io/tx/${trade.entry_tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-solana-light"
                        title="Entry tx"
                      >
                        in↗
                      </a>
                    )}
                    {trade.exit_tx && (
                      <a
                        href={`https://solscan.io/tx/${trade.exit_tx}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-xs text-gray-500 hover:text-solana-light"
                        title="Exit tx"
                      >
                        out↗
                      </a>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
