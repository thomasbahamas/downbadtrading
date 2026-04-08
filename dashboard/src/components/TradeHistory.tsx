'use client';

import { useState } from 'react';
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

function SignalBreakdown({ signals }: { signals: Record<string, string> }) {
  const entries = Object.entries(signals).filter(([, v]) => v && v !== 'n/a' && v !== '');
  if (entries.length === 0) return null;

  return (
    <div className="grid grid-cols-2 gap-2 mt-2">
      {entries.map(([key, value]) => (
        <div key={key} className="text-xs">
          <span className="text-gray-500 capitalize">{key.replace(/([A-Z])/g, ' $1').trim()}: </span>
          <span className="text-gray-400">{value}</span>
        </div>
      ))}
    </div>
  );
}

export default function TradeHistory({ trades }: Props) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
            {trades.map((trade) => {
              const isExpanded = expandedId === trade.id;
              return (
                <tr
                  key={trade.id}
                  className="hover:bg-surface-2/40 transition-colors group cursor-pointer"
                  onClick={() => setExpandedId(isExpanded ? null : trade.id)}
                >
                  <td className="py-3 pr-3 text-xs text-gray-500 align-top">
                    {new Date(trade.opened_at).toLocaleDateString('en-US', {
                      month: 'short',
                      day: 'numeric',
                      hour: '2-digit',
                      minute: '2-digit',
                    })}
                  </td>
                  <td className="py-3 pr-3 align-top">
                    <div>
                      <span className="text-white font-medium">{trade.token_symbol}</span>
                      <span className="text-gray-500 text-xs ml-2">
                        {trade.direction === 'buy' ? 'LONG' : 'SHORT'}
                      </span>
                      {trade.confidence_score > 0 && (
                        <span className="text-xs text-gray-600 ml-2">
                          {(trade.confidence_score * 100).toFixed(0)}%
                        </span>
                      )}
                    </div>
                    {/* Reasoning preview (always visible) */}
                    {trade.reasoning && (
                      <p className={`text-xs mt-0.5 ${isExpanded ? 'text-gray-400' : 'text-gray-600 truncate max-w-xs group-hover:text-gray-500'}`}>
                        {trade.reasoning}
                      </p>
                    )}
                    {/* Expanded signal breakdown */}
                    {isExpanded && trade.signals && Object.keys(trade.signals).length > 0 && (
                      <SignalBreakdown signals={trade.signals} />
                    )}
                    {/* Outcome evaluation for closed trades */}
                    {isExpanded && trade.status !== 'open' && trade.realized_pnl !== null && (
                      <div className="mt-2 p-2 rounded bg-surface-2/50 border border-surface-border/30">
                        <p className="text-xs text-gray-500">
                          <span className="font-medium">Outcome: </span>
                          <span className={pnlClass(trade.realized_pnl)}>
                            {trade.status === 'tp_hit' ? 'TP hit' : trade.status === 'sl_hit' ? 'SL hit' : trade.status}
                            {' — '}
                            {trade.realized_pnl > 0 ? '+' : ''}${trade.realized_pnl.toFixed(2)}
                            {' '}({trade.realized_pnl_pct !== null ? `${(trade.realized_pnl_pct * 100).toFixed(1)}%` : ''})
                          </span>
                        </p>
                        {trade.closed_at && (
                          <p className="text-xs text-gray-600 mt-0.5">
                            Held for {formatDuration(new Date(trade.opened_at).getTime(), new Date(trade.closed_at).getTime())}
                          </p>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right mono text-gray-300 text-xs align-top">
                    ${trade.entry_price.toPrecision(5)}
                  </td>
                  <td className="py-3 text-right mono text-gray-300 text-xs align-top">
                    {trade.exit_price ? `$${trade.exit_price.toPrecision(5)}` : '--'}
                  </td>
                  <td className="py-3 text-right mono text-gray-400 text-xs align-top">
                    ${trade.position_size_usd.toFixed(0)}
                  </td>
                  <td className={`py-3 text-right mono text-xs align-top ${pnlClass(trade.realized_pnl)}`}>
                    {trade.realized_pnl !== null
                      ? `${trade.realized_pnl > 0 ? '+' : ''}$${Math.abs(trade.realized_pnl).toFixed(2)}`
                      : '--'}
                  </td>
                  <td className={`py-3 text-right mono text-xs align-top ${pnlClass(trade.realized_pnl_pct)}`}>
                    {trade.realized_pnl_pct !== null
                      ? `${trade.realized_pnl_pct > 0 ? '+' : ''}${(trade.realized_pnl_pct * 100).toFixed(1)}%`
                      : '--'}
                  </td>
                  <td className="py-3 text-center align-top">
                    {statusBadge(trade.status)}
                  </td>
                  <td className="py-3 text-right align-top">
                    <div className="flex items-center justify-end gap-1.5">
                      {trade.entry_tx && (
                        <a
                          href={`https://solscan.io/tx/${trade.entry_tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:text-solana-light"
                          title="Entry tx"
                          onClick={(e) => e.stopPropagation()}
                        >
                          in
                        </a>
                      )}
                      {trade.exit_tx && (
                        <a
                          href={`https://solscan.io/tx/${trade.exit_tx}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-xs text-gray-500 hover:text-solana-light"
                          title="Exit tx"
                          onClick={(e) => e.stopPropagation()}
                        >
                          out
                        </a>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function formatDuration(startMs: number, endMs: number): string {
  const diffMs = endMs - startMs;
  const hours = Math.floor(diffMs / (1000 * 60 * 60));
  const mins = Math.floor((diffMs / (1000 * 60)) % 60);
  if (hours > 24) {
    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
  }
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}
