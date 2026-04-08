import { supabase } from '@/lib/supabase';
import type { AgentActivity } from '@/lib/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

async function getResearchData() {
  const [thesesRes, rejectionsRes, noTradesRes, scansRes, loopSummariesRes] = await Promise.all([
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
  ]);

  const theses = (thesesRes.data as AgentActivity[]) ?? [];
  const rejections = (rejectionsRes.data as AgentActivity[]) ?? [];
  const noTrades = (noTradesRes.data as AgentActivity[]) ?? [];
  const latestScan = (scansRes.data as AgentActivity[])?.[0] ?? null;
  const loopSummaries = (loopSummariesRes.data as AgentActivity[]) ?? [];

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
  const { thesesWithOutcome, rejections, noTrades, loopSummaries, stats } = await getResearchData();

  const selectivityRate = stats.totalTheses > 0
    ? ((stats.totalExecuted / stats.totalTheses) * 100).toFixed(0)
    : '0';

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Page header */}
      <div>
        <h1 className="text-xl font-semibold text-white">Research</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          Every analysis the agent has produced — trades taken, trades rejected, and markets passed on
        </p>
      </div>

      {/* Research funnel stats */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
        <StatCard label="Loops Run" value={stats.totalScans.toString()} />
        <StatCard label="Tokens / Scan" value={stats.tokensPerScan.toString()} />
        <StatCard label="Theses Generated" value={stats.totalTheses.toString()} accent />
        <StatCard label="Risk Rejected" value={stats.totalRejections.toString()} color="text-orange-400" />
        <StatCard label="No-Trade Calls" value={stats.totalNoTrades.toString()} />
        <StatCard
          label="Selectivity"
          value={`${selectivityRate}%`}
          sublabel={`${stats.totalExecuted} of ${stats.totalTheses} executed`}
          color="text-solana-light"
        />
      </div>

      {/* Main content: two columns on desktop */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Theses (2/3 width) */}
        <div className="lg:col-span-2 space-y-6">
          {/* Generated theses with outcomes */}
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

                  return (
                    <div key={thesis.id} className="card group">
                      {/* Status + token header */}
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

                      {/* The thesis — primary content */}
                      <p className="text-sm text-gray-200 leading-relaxed">
                        {thesis.details}
                      </p>

                      {/* Price levels if available */}
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

                      {/* Rejection reason */}
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

        {/* Right column: No-trades + market reads (1/3 width) */}
        <div className="space-y-6">
          {/* Market reads — when the agent chose not to trade */}
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

          {/* Loop timeline */}
          {loopSummaries.length > 0 && (
            <div>
              <h2 className="text-sm font-semibold text-white mb-3">Decision Log</h2>
              <div className="space-y-1">
                {loopSummaries.slice(0, 20).map((ls) => {
                  const meta = ls.metadata as Record<string, unknown>;
                  const hadThesis = meta?.hadThesis as boolean;
                  const wasExecuted = meta?.wasExecuted as boolean;
                  const wasApproved = meta?.wasApproved as boolean;

                  let dotColor = 'bg-gray-600'; // no trade
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
