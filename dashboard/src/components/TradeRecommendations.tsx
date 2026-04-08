'use client';

import type { Trade } from '@/lib/types';

interface Props {
  trades: Trade[];
  tokensScannedPerLoop: number;
}

function confidenceColor(score: number): string {
  if (score >= 0.8) return 'text-profit';
  if (score >= 0.6) return 'text-solana-light';
  if (score >= 0.4) return 'text-warning';
  return 'text-gray-400';
}

function confidenceBar(score: number): string {
  if (score >= 0.8) return 'bg-profit';
  if (score >= 0.6) return 'bg-solana';
  if (score >= 0.4) return 'bg-warning';
  return 'bg-gray-500';
}

function outcomeLabel(trade: Trade): { text: string; className: string } | null {
  if (trade.status === 'open') return null;
  if (trade.status === 'tp_hit') {
    return {
      text: `Take Profit Hit  +$${Number(trade.realized_pnl ?? 0).toFixed(2)} (+${((trade.realized_pnl_pct ?? 0) * 100).toFixed(1)}%)`,
      className: 'text-profit bg-profit/10 border-profit/20',
    };
  }
  if (trade.status === 'sl_hit') {
    return {
      text: `Stop Loss Hit  -$${Math.abs(Number(trade.realized_pnl ?? 0)).toFixed(2)} (${((trade.realized_pnl_pct ?? 0) * 100).toFixed(1)}%)`,
      className: 'text-loss bg-loss/10 border-loss/20',
    };
  }
  return {
    text: trade.status.replace('_', ' '),
    className: 'text-gray-400 bg-gray-500/10 border-gray-500/20',
  };
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function holdDuration(openedAt: string, closedAt: string | null): string | null {
  if (!closedAt) return null;
  const diff = new Date(closedAt).getTime() - new Date(openedAt).getTime();
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const mins = Math.floor((diff / (1000 * 60)) % 60);
  if (hours > 24) return `${Math.floor(hours / 24)}d ${hours % 24}h`;
  if (hours > 0) return `${hours}h ${mins}m`;
  return `${mins}m`;
}

export default function TradeRecommendations({ trades, tokensScannedPerLoop }: Props) {
  const tradesWithAnalysis = trades.filter((t) => t.reasoning && t.reasoning.length > 20);

  if (tradesWithAnalysis.length === 0) {
    return (
      <div className="card">
        <h2 className="text-lg font-semibold text-white mb-2">Trade Analysis</h2>
        <p className="text-sm text-gray-500 text-center py-8">
          No trades with analysis yet. The agent will generate professional research notes for each trade.
        </p>
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <h2 className="text-lg font-semibold text-white">Trade Analysis</h2>
          <span className="text-[10px] text-gray-600 bg-surface-2 px-2 py-0.5 rounded-full uppercase tracking-wider">
            AI Research Notes
          </span>
        </div>
        <a
          href="/trades"
          className="text-xs text-gray-500 hover:text-solana-light transition-colors"
        >
          View all trades
        </a>
      </div>

      <div className="space-y-4">
        {tradesWithAnalysis.map((trade) => {
          const outcome = outcomeLabel(trade);
          const signals = trade.signals && typeof trade.signals === 'object'
            ? Object.entries(trade.signals).filter(([, v]) => v && v !== 'n/a' && v !== '')
            : [];
          const rrRatio = trade.entry_price && trade.take_profit && trade.stop_loss
            ? Math.abs(trade.take_profit - trade.entry_price) / Math.abs(trade.entry_price - trade.stop_loss)
            : null;
          const held = holdDuration(trade.opened_at, trade.closed_at);

          return (
            <div
              key={trade.id}
              className="card group"
            >
              {/* Decision funnel bar */}
              <div className="flex items-center gap-2 text-[10px] text-gray-600 mb-3 pb-3 border-b border-surface-border/30">
                <span>{tokensScannedPerLoop} tokens scanned</span>
                <span className="text-gray-700">&rarr;</span>
                <span>thesis generated</span>
                <span className="text-gray-700">&rarr;</span>
                <span>risk approved</span>
                <span className="text-gray-700">&rarr;</span>
                <span className="text-solana-light font-medium">executed</span>
              </div>

              {/* Header row */}
              <div className="flex items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <div>
                    <span className="text-xl font-bold text-white">{trade.token_symbol}</span>
                    <span className="text-xs text-gray-600 ml-2 uppercase">
                      {trade.direction === 'buy' ? 'long' : 'short'}
                    </span>
                  </div>
                  {trade.confidence_score > 0 && (
                    <div className="flex items-center gap-2">
                      <div className="w-12 h-1.5 rounded-full bg-surface-3 overflow-hidden">
                        <div
                          className={`h-full rounded-full ${confidenceBar(trade.confidence_score)}`}
                          style={{ width: `${trade.confidence_score * 100}%` }}
                        />
                      </div>
                      <span className={`text-xs font-mono font-semibold ${confidenceColor(trade.confidence_score)}`}>
                        {(trade.confidence_score * 100).toFixed(0)}%
                      </span>
                    </div>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {outcome && (
                    <span className={`text-xs px-2.5 py-1 rounded-full border font-medium ${outcome.className}`}>
                      {outcome.text}
                    </span>
                  )}
                  {trade.status === 'open' && (
                    <span className="badge-open">Live</span>
                  )}
                  <span className="text-xs text-gray-600">{timeAgo(trade.opened_at)}</span>
                </div>
              </div>

              {/* THE THESIS — the primary content */}
              <div className="mt-3">
                <p className="text-sm text-gray-200 leading-relaxed">
                  {trade.reasoning}
                </p>
              </div>

              {/* Trade levels grid */}
              <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 mt-4 pt-3 border-t border-surface-border/30">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-0.5">Entry</p>
                  <p className="text-xs mono text-gray-300">${formatPrice(trade.entry_price)}</p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-profit/70 mb-0.5">Target</p>
                  <p className="text-xs mono text-profit/80">
                    ${formatPrice(trade.take_profit)}
                    <span className="text-[10px] text-gray-600 ml-1">
                      +{(((trade.take_profit - trade.entry_price) / trade.entry_price) * 100).toFixed(1)}%
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-loss/70 mb-0.5">Stop</p>
                  <p className="text-xs mono text-loss/80">
                    ${formatPrice(trade.stop_loss)}
                    <span className="text-[10px] text-gray-600 ml-1">
                      {(((trade.stop_loss - trade.entry_price) / trade.entry_price) * 100).toFixed(1)}%
                    </span>
                  </p>
                </div>
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-0.5">Size</p>
                  <p className="text-xs mono text-gray-300">${Number(trade.position_size_usd).toFixed(0)}</p>
                </div>
                {rrRatio && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-0.5">R/R</p>
                    <p className="text-xs mono text-gray-300">{rrRatio.toFixed(2)}:1</p>
                  </div>
                )}
                {held && (
                  <div>
                    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-0.5">Held</p>
                    <p className="text-xs mono text-gray-300">{held}</p>
                  </div>
                )}
              </div>

              {/* Signal breakdown */}
              {signals.length > 0 && (
                <div className="mt-3 pt-3 border-t border-surface-border/30">
                  <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-2">Signal Breakdown</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {signals.map(([key, value]) => (
                      <div key={key} className="flex gap-2">
                        <span className="text-[10px] uppercase tracking-wider text-gray-600 min-w-[85px] pt-0.5 flex-shrink-0">
                          {formatSignalLabel(key)}
                        </span>
                        <span className="text-xs text-gray-400 leading-relaxed">{value}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Transaction links */}
              {(trade.entry_tx || trade.exit_tx) && (
                <div className="flex gap-3 mt-3 pt-2 border-t border-surface-border/20">
                  {trade.entry_tx && (
                    <a
                      href={`https://solscan.io/tx/${trade.entry_tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-600 hover:text-solana-light transition-colors"
                    >
                      Entry tx &rarr;
                    </a>
                  )}
                  {trade.exit_tx && (
                    <a
                      href={`https://solscan.io/tx/${trade.exit_tx}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-gray-600 hover:text-solana-light transition-colors"
                    >
                      Exit tx &rarr;
                    </a>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function formatPrice(price: number): string {
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toPrecision(4);
}

function formatSignalLabel(key: string): string {
  const map: Record<string, string> = {
    priceAction: 'Price',
    volume: 'Volume',
    socialSentiment: 'Sentiment',
    onChainMetrics: 'On-Chain',
  };
  return map[key] || key.replace(/([A-Z])/g, ' $1').trim();
}
