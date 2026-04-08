'use client';

import type { AgentActivity } from '@/lib/types';

interface Props {
  rejections: AgentActivity[];
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export default function RejectedTrades({ rejections }: Props) {
  if (rejections.length === 0) return null;

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Passed Opportunities</h2>
          <span className="text-[10px] text-gray-600 bg-surface-2 px-2 py-0.5 rounded-full uppercase tracking-wider">
            Discipline
          </span>
        </div>
        <span className="text-xs text-gray-600">{rejections.length} rejected</span>
      </div>

      <div className="space-y-1">
        {rejections.map((r) => {
          const meta = r.metadata as Record<string, unknown> | null;
          const isNoTrade = r.type === 'no_trade';
          const isRejection = r.type === 'rejected';

          return (
            <div
              key={r.id}
              className="flex items-start gap-3 py-2 px-2 rounded-lg hover:bg-surface-2/30 transition-colors"
            >
              <span className={`text-xs mono font-bold mt-0.5 w-3 text-center flex-shrink-0 ${
                isRejection ? 'text-orange-400' : 'text-gray-500'
              }`}>
                {isRejection ? 'x' : '-'}
              </span>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  {r.token_symbol && (
                    <span className="text-xs text-white font-medium">{r.token_symbol}</span>
                  )}
                  <span className={`text-xs ${isRejection ? 'text-orange-400/70' : 'text-gray-500'}`}>
                    {isRejection ? 'Rejected' : 'No trade'}
                  </span>
                </div>
                <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">
                  {r.title}
                </p>
                {/* Show reasoning for rejected theses */}
                {r.details && (
                  <p className="text-xs text-gray-600 mt-0.5 leading-relaxed line-clamp-2">
                    {r.details}
                  </p>
                )}
                {/* Metadata badges */}
                {isRejection && meta && (
                  <div className="flex gap-2 mt-1">
                    {meta.confidence != null && (
                      <span className="text-[10px] text-gray-600 bg-surface-2 px-1.5 py-0.5 rounded">
                        Conf: {(Number(meta.confidence) * 100).toFixed(0)}%
                      </span>
                    )}
                    {meta.rr != null && (
                      <span className="text-[10px] text-gray-600 bg-surface-2 px-1.5 py-0.5 rounded">
                        R/R: {Number(meta.rr).toFixed(2)}
                      </span>
                    )}
                    {meta.entryPrice != null && (
                      <span className="text-[10px] text-gray-600 bg-surface-2 px-1.5 py-0.5 rounded">
                        @ ${Number(meta.entryPrice).toPrecision(4)}
                      </span>
                    )}
                  </div>
                )}
              </div>
              <span className="text-[10px] text-gray-700 whitespace-nowrap flex-shrink-0">
                {timeAgo(r.created_at)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
