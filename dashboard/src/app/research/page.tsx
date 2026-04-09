import { supabase } from '@/lib/supabase';
import type { AgentActivity, WatchlistEntry } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getResearchData() {
  const [thesesRes, rejectionsRes, noTradesRes, scansRes, loopSummariesRes, watchlistRes] = await Promise.all([
    supabase
      .from('agent_activity')
      .select('*')
      .eq('type', 'thesis')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('agent_activity')
      .select('*')
      .eq('type', 'rejected')
      .order('created_at', { ascending: false })
      .limit(50),
    supabase
      .from('agent_activity')
      .select('*')
      .eq('type', 'no_trade')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('agent_activity')
      .select('*')
      .eq('type', 'scan')
      .order('created_at', { ascending: false })
      .limit(1),
    supabase
      .from('agent_activity')
      .select('*')
      .eq('type', 'loop_summary')
      .order('created_at', { ascending: false })
      .limit(30),
    supabase
      .from('daily_watchlist')
      .select('*')
      .order('scan_date', { ascending: false })
      .order('rank', { ascending: true })
      .limit(20),
  ]);

  const theses = (thesesRes.data as AgentActivity[]) ?? [];
  const rejections = (rejectionsRes.data as AgentActivity[]) ?? [];
  const noTrades = (noTradesRes.data as AgentActivity[]) ?? [];
  const latestScan = (scansRes.data as AgentActivity[])?.[0] ?? null;
  const loopSummaries = (loopSummariesRes.data as AgentActivity[]) ?? [];
  const allWatchlist = (watchlistRes.data as WatchlistEntry[]) ?? [];

  // Get today's watchlist (most recent scan_date)
  const latestDate = allWatchlist[0]?.scan_date ?? null;
  const watchlist = latestDate
    ? allWatchlist.filter((w) => w.scan_date === latestDate)
    : [];

  // Count stats
  const totalScans = loopSummaries.length;
  const totalTheses = theses.length;
  const totalRejections = rejections.length;
  const totalNoTrades = noTrades.length;
  const totalExecuted = loopSummaries.filter(
    l => (l.metadata as Record<string, unknown>)?.wasExecuted === true
  ).length;
  const tokensPerScan = (latestScan?.metadata as Record<string, unknown>)?.tokensScanned as number ?? 0;

  // Merge theses with their rejection outcomes
  const thesesWithOutcome = theses.map(thesis => {
    const rejection = rejections.find(r => {
      const timeDiff = Math.abs(
        new Date(r.created_at).getTime() - new Date(thesis.created_at).getTime()
      );
      return r.token_symbol === thesis.token_symbol && timeDiff < 5000;
    });
    return { thesis, rejection };
  });

  return {
    thesesWithOutcome,
    rejections,
    noTrades,
    loopSummaries,
    watchlist,
    stats: {
      totalScans,
      totalTheses,
      totalRejections,
      totalNoTrades,
      totalExecuted,
      tokensPerScan,
    },
  };
}

export default async function ResearchPage() {
  const { thesesWithOutcome, noTrades, loopSummaries, watchlist, stats } = await getResearchData();

  const selectivityRate = stats.totalTheses > 0
    ? ((stats.totalExecuted / stats.totalTheses) * 100).toFixed(0)
    : '0';

  const watchlistTaken = watchlist.filter((w) => w.status === 'taken').length;
  const watchlistActive = watchlist.filter((w) => w.status === 'watching').length;

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Research</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Daily watchlist, trade theses, and the agent&apos;s decision pipeline
        </p>
      </div>

      {/* Research funnel stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-3">
        <StatCard label="Watchlist" value={watchlist.length.toString()} sublabel={`${watchlistTaken} taken`} accent />
        <StatCard label="Active" value={watchlistActive.toString()} color="text-solana-light" />
        <StatCard label="Loops Run" value={stats.totalScans.toString()} />
        <StatCard label="Tokens / Scan" value={stats.tokensPerScan.toString()} />
        <StatCard label="Theses" value={stats.totalTheses.toString()} accent />
        <StatCard label="Rejected" value={stats.totalRejections.toString()} color="text-orange-400" />
        <StatCard label="No-Trade" value={stats.totalNoTrades.toString()} />
        <StatCard
          label="Selectivity"
          value={`${selectivityRate}%`}
          sublabel={`${stats.totalExecuted}/${stats.totalTheses}`}
          color="text-solana-light"
        />
      </div>

      {/* ═══ TOP 10 DAILY WATCHLIST ═══ */}
      {watchlist.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold text-white">Today&apos;s Top 10</h2>
              <span className="text-[10px] text-gray-600 bg-surface-2 px-2 py-0.5 rounded-full uppercase tracking-wider">
                {watchlist[0]?.scan_date}
              </span>
            </div>
            <span className="text-xs text-gray-600">
              5 AM PST scan
            </span>
          </div>

          {/* Watchlist table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="border-b border-surface-border/30">
                  <th className="text-left text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 w-12">#</th>
                  <th className="text-left text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3">Token</th>
                  <th className="text-left text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden sm:table-cell">Status</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3">Score</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden md:table-cell">Conf</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden md:table-cell">R/R</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3">Price</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden lg:table-cell">Entry</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden lg:table-cell">TP</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden lg:table-cell">SL</th>
                  <th className="text-right text-[10px] text-gray-600 uppercase tracking-wider py-2 px-3 hidden xl:table-cell">Trend</th>
                </tr>
              </thead>
              <tbody>
                {/* Taken trades first, then watching, then dropped */}
                {sortWatchlist(watchlist).map((entry) => (
                  <WatchlistRow key={entry.id} entry={entry} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Expandable theses below the table */}
          <div className="mt-4 space-y-3">
            {sortWatchlist(watchlist).filter((w) => w.status !== 'dropped').map((entry) => (
              <WatchlistThesisCard key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      )}

      {/* ═══ TRADE THESES + SIDEBAR ═══ */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Theses (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          <div>
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold text-white">Trade Theses</h2>
                <span className="text-[10px] text-gray-600 bg-surface-2 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  {thesesWithOutcome.length} analyses
                </span>
              </div>
            </div>

            {thesesWithOutcome.length === 0 ? (
              <div className="card">
                <p className="text-sm text-gray-500 text-center py-8">
                  No theses generated yet. The agent is scanning markets...
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {thesesWithOutcome.map(({ thesis, rejection }) => {
                  const meta = thesis.metadata as Record<string, unknown>;
                  const rejMeta = rejection?.metadata as Record<string, unknown> | undefined;
                  const wasExecuted = !rejection;
                  const confidence = meta?.confidence as number | undefined;
                  const rr = meta?.rr as number | undefined;
                  const tp = (meta?.tp ?? rejMeta?.tp) as number | undefined;
                  const sl = (meta?.sl ?? rejMeta?.sl) as number | undefined;
                  const entryPrice = rejMeta?.entryPrice as number | undefined;
                  const onWatchlist = meta?.onWatchlist as boolean | undefined;

                  return (
                    <div key={thesis.id} className="card group">
                      <div className="flex items-start justify-between gap-3 mb-2">
                        <div className="flex items-center gap-2">
                          {wasExecuted ? (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-profit/15 text-profit font-medium">
                              Executed
                            </span>
                          ) : (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-orange-400/15 text-orange-400 font-medium">
                              Rejected
                            </span>
                          )}
                          {onWatchlist && (
                            <span className="text-xs px-2 py-0.5 rounded-full bg-solana/15 text-solana-light font-medium">
                              Watchlist
                            </span>
                          )}
                          <span className="text-lg font-bold text-white">
                            {thesis.token_symbol}
                          </span>
                          {confidence != null && (
                            <span className={`text-xs font-mono ${
                              confidence >= 0.8 ? 'text-profit' :
                              confidence >= 0.7 ? 'text-solana-light' :
                              'text-gray-400'
                            }`}>
                              {(confidence * 100).toFixed(0)}% conf
                            </span>
                          )}
                          {rr != null && (
                            <span className="text-xs text-gray-500 font-mono">
                              {rr.toFixed(2)} R/R
                            </span>
                          )}
                        </div>
                        <span className="text-xs text-gray-600 flex-shrink-0">
                          {formatTime(thesis.created_at)}
                        </span>
                      </div>

                      <p className="text-sm text-gray-200 leading-relaxed">
                        {thesis.details}
                      </p>

                      {(entryPrice || tp || sl) && (
                        <div className="flex gap-4 mt-3 pt-2 border-t border-surface-border/30">
                          {entryPrice && (
                            <div>
                              <span className="text-[10px] text-gray-600 uppercase">Entry </span>
                              <span className="text-xs mono text-gray-300">${formatPrice(entryPrice)}</span>
                            </div>
                          )}
                          {tp && (
                            <div>
                              <span className="text-[10px] text-profit/70 uppercase">TP </span>
                              <span className="text-xs mono text-profit/80">${formatPrice(tp)}</span>
                            </div>
                          )}
                          {sl && (
                            <div>
                              <span className="text-[10px] text-loss/70 uppercase">SL </span>
                              <span className="text-xs mono text-loss/80">${formatPrice(sl)}</span>
                            </div>
                          )}
                        </div>
                      )}

                      {rejection && (
                        <div className="mt-2 pt-2 border-t border-surface-border/30">
                          <p className="text-xs text-orange-400/70">
                            <span className="font-medium">Rejected: </span>
                            {(rejMeta?.reason as string) ?? rejection.title}
                          </p>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Right column: No-trades + Decision Log */}
        <div className="space-y-6">
          {noTrades.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <h2 className="text-sm font-semibold text-white">Market Reads</h2>
                <span className="text-[10px] text-gray-600 bg-surface-2 px-2 py-0.5 rounded-full uppercase tracking-wider">
                  No-trade calls
                </span>
              </div>
              <div className="space-y-2">
                {noTrades.slice(0, 15).map((nt) => (
                  <div key={nt.id} className="card-sm">
                    <p className="text-xs text-gray-300 leading-relaxed">
                      {nt.title.replace(/^No trade: /, '')}
                    </p>
                    <div className="flex items-center justify-between mt-2">
                      <span className="text-[10px] text-gray-600">
                        {String((nt.metadata as Record<string, unknown>)?.tokensAnalyzed ?? '?')} tokens analyzed
                      </span>
                      <span className="text-[10px] text-gray-600">
                        {formatTime(nt.created_at)}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {loopSummaries.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-3">Decision Log</h2>
              <div className="space-y-1">
                {loopSummaries.slice(0, 20).map((ls) => {
                  const meta = ls.metadata as Record<string, unknown>;
                  const hadThesis = meta?.hadThesis as boolean;
                  const wasExecuted = meta?.wasExecuted as boolean;
                  const wasApproved = meta?.wasApproved as boolean;

                  let dotColor = 'bg-gray-600';
                  if (wasExecuted) dotColor = 'bg-profit';
                  else if (hadThesis && !wasApproved) dotColor = 'bg-orange-400';
                  else if (hadThesis) dotColor = 'bg-solana';

                  return (
                    <div key={ls.id} className="flex items-start gap-2 py-1.5">
                      <span className={`w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${dotColor}`} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-gray-400 leading-relaxed truncate">
                          {ls.title}
                        </p>
                      </div>
                      <span className="text-[10px] text-gray-700 flex-shrink-0">
                        {formatTimeShort(ls.created_at)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Watchlist components ─────────────────────────────────────────────────────

function sortWatchlist(watchlist: WatchlistEntry[]): WatchlistEntry[] {
  return [...watchlist].sort((a, b) => {
    // Taken first, then watching by rank, then dropped
    const statusOrder = { taken: 0, watching: 1, dropped: 2 };
    const aDiff = statusOrder[a.status] - statusOrder[b.status];
    if (aDiff !== 0) return aDiff;
    return a.rank - b.rank;
  });
}

function WatchlistRow({ entry }: { entry: WatchlistEntry }) {
  const isTaken = entry.status === 'taken';
  const isDropped = entry.status === 'dropped';
  const priceVsEntry = entry.entry_price_target && entry.current_price
    ? ((entry.current_price - entry.entry_price_target) / entry.entry_price_target * 100)
    : null;

  const rowClass = isTaken
    ? 'bg-profit/5 border-l-2 border-profit/40'
    : isDropped
      ? 'opacity-40'
      : 'hover:bg-surface-2/30';

  return (
    <tr className={`border-b border-surface-border/10 transition-colors ${rowClass}`}>
      <td className="py-2.5 px-3">
        <span className={`text-sm font-bold mono ${isTaken ? 'text-profit' : isDropped ? 'text-gray-600' : 'text-gray-400'}`}>
          {entry.rank}
        </span>
      </td>
      <td className="py-2.5 px-3">
        <span className="text-sm font-semibold text-white">{entry.token_symbol}</span>
        {entry.token_name && (
          <span className="text-[10px] text-gray-600 ml-1.5 hidden sm:inline">{entry.token_name}</span>
        )}
      </td>
      <td className="py-2.5 px-3 hidden sm:table-cell">
        <StatusBadge status={entry.status} />
      </td>
      <td className="py-2.5 px-3 text-right">
        <ScoreBar score={entry.last_score} />
      </td>
      <td className="py-2.5 px-3 text-right hidden md:table-cell">
        <span className={`text-xs mono ${
          entry.confidence >= 0.8 ? 'text-profit' :
          entry.confidence >= 0.7 ? 'text-solana-light' :
          'text-gray-400'
        }`}>
          {(entry.confidence * 100).toFixed(0)}%
        </span>
      </td>
      <td className="py-2.5 px-3 text-right hidden md:table-cell">
        <span className="text-xs mono text-gray-300">{entry.rr_ratio.toFixed(1)}</span>
      </td>
      <td className="py-2.5 px-3 text-right">
        <div className="flex flex-col items-end">
          <span className="text-xs mono text-white">
            ${formatPrice(entry.current_price ?? entry.entry_price_target ?? 0)}
          </span>
          {priceVsEntry != null && (
            <span className={`text-[10px] mono ${priceVsEntry >= 0 ? 'text-profit' : 'text-loss'}`}>
              {priceVsEntry >= 0 ? '+' : ''}{priceVsEntry.toFixed(1)}%
            </span>
          )}
        </div>
      </td>
      <td className="py-2.5 px-3 text-right hidden lg:table-cell">
        <span className="text-xs mono text-gray-500">
          ${formatPrice(entry.entry_price_target ?? 0)}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right hidden lg:table-cell">
        <span className="text-xs mono text-profit/60">
          ${formatPrice(entry.tp_target ?? 0)}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right hidden lg:table-cell">
        <span className="text-xs mono text-loss/60">
          ${formatPrice(entry.sl_target ?? 0)}
        </span>
      </td>
      <td className="py-2.5 px-3 text-right hidden xl:table-cell">
        <MiniSparkline history={entry.score_history} />
      </td>
    </tr>
  );
}

function WatchlistThesisCard({ entry }: { entry: WatchlistEntry }) {
  const isTaken = entry.status === 'taken';

  return (
    <details className={`card group ${isTaken ? 'ring-1 ring-profit/20' : ''}`}>
      <summary className="cursor-pointer flex items-center gap-2">
        <span className={`text-sm font-bold mono ${isTaken ? 'text-profit' : 'text-solana-light'}`}>
          #{entry.rank}
        </span>
        <span className="text-sm font-semibold text-white">{entry.token_symbol}</span>
        <StatusBadge status={entry.status} />
        <span className="text-xs text-gray-500 ml-auto">
          Score {entry.last_score.toFixed(0)} · {(entry.confidence * 100).toFixed(0)}% conf · {entry.rr_ratio.toFixed(1)} R/R
        </span>
      </summary>
      <div className="mt-3 pt-3 border-t border-surface-border/30">
        <p className="text-sm text-gray-200 leading-relaxed">{entry.thesis}</p>

        {/* Signal breakdown */}
        {entry.signals && Object.keys(entry.signals).length > 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3">
            {Object.entries(entry.signals).map(([key, value]) => (
              value ? (
                <div key={key} className="bg-surface-2/30 rounded px-2.5 py-1.5">
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">{formatSignalKey(key)}</span>
                  <p className="text-xs text-gray-300 mt-0.5 leading-relaxed">{value}</p>
                </div>
              ) : null
            ))}
          </div>
        )}

        {/* Price levels */}
        <div className="flex gap-4 mt-3 pt-2 border-t border-surface-border/20">
          {entry.entry_price_target && (
            <div>
              <span className="text-[10px] text-gray-600 uppercase">Entry </span>
              <span className="text-xs mono text-gray-300">${formatPrice(entry.entry_price_target)}</span>
            </div>
          )}
          {entry.tp_target && (
            <div>
              <span className="text-[10px] text-profit/70 uppercase">TP </span>
              <span className="text-xs mono text-profit/80">${formatPrice(entry.tp_target)}</span>
            </div>
          )}
          {entry.sl_target && (
            <div>
              <span className="text-[10px] text-loss/70 uppercase">SL </span>
              <span className="text-xs mono text-loss/80">${formatPrice(entry.sl_target)}</span>
            </div>
          )}
        </div>
      </div>
    </details>
  );
}

function StatusBadge({ status }: { status: WatchlistEntry['status'] }) {
  if (status === 'taken') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-profit/15 text-profit font-medium uppercase">Taken</span>;
  }
  if (status === 'dropped') {
    return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-600/15 text-gray-500 font-medium uppercase">Dropped</span>;
  }
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-solana/15 text-solana-light font-medium uppercase">Watching</span>;
}

function ScoreBar({ score }: { score: number }) {
  const width = Math.min(100, Math.max(0, score));
  const color = score >= 80 ? 'bg-profit' : score >= 60 ? 'bg-solana' : 'bg-gray-500';
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-xs mono text-gray-300 w-7 text-right">{score.toFixed(0)}</span>
      <div className="w-12 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function MiniSparkline({ history }: { history: Array<{ time: string; score: number }> }) {
  if (!history || history.length < 2) {
    return <span className="text-[10px] text-gray-700">—</span>;
  }

  // Take last 12 data points for the sparkline
  const points = history.slice(-12);
  const scores = points.map((p) => p.score);
  const min = Math.min(...scores);
  const max = Math.max(...scores);
  const range = max - min || 1;

  const width = 48;
  const height = 16;
  const pathPoints = scores.map((s, i) => {
    const x = (i / (scores.length - 1)) * width;
    const y = height - ((s - min) / range) * height;
    return `${x},${y}`;
  });

  const trend = scores[scores.length - 1] - scores[0];
  const strokeColor = trend >= 0 ? '#34d399' : '#f87171';

  return (
    <svg width={width} height={height} className="inline-block">
      <polyline
        points={pathPoints.join(' ')}
        fill="none"
        stroke={strokeColor}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ─── Shared components ────────────────────────────────────────────────────────

function StatCard({ label, value, sublabel, accent, color }: {
  label: string; value: string; sublabel?: string; accent?: boolean; color?: string;
}) {
  return (
    <div className="card-sm text-center">
      <p className={`text-2xl font-bold mono ${color ?? (accent ? 'text-solana-light' : 'text-white')}`}>
        {value}
      </p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider mt-0.5">{label}</p>
      {sublabel && <p className="text-[10px] text-gray-600 mt-0.5">{sublabel}</p>}
    </div>
  );
}

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);

  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHours = Math.floor(diffMins / 60);
  if (diffHours < 24) return `${diffHours}h ago`;

  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function formatTimeShort(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

function formatPrice(price: number): string {
  if (price >= 100) return price.toFixed(2);
  if (price >= 1) return price.toFixed(4);
  if (price >= 0.01) return price.toFixed(5);
  return price.toPrecision(4);
}

function formatSignalKey(key: string): string {
  return key.replace(/([A-Z])/g, ' $1').replace(/^./, (s) => s.toUpperCase());
}
