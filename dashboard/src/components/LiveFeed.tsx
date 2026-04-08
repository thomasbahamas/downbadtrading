'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AgentActivity } from '@/lib/types';

const TYPE_CONFIG: Record<string, { icon: string; color: string; bg: string }> = {
  loop_summary: { icon: '#', color: 'text-gray-400', bg: 'bg-surface-3/50' },
  scan:           { icon: 'o', color: 'text-gray-500', bg: '' },
  listing:        { icon: '!', color: 'text-yellow-400', bg: 'bg-yellow-400/5' },
  thesis:         { icon: '?', color: 'text-solana-light', bg: 'bg-solana/5' },
  no_trade:       { icon: '-', color: 'text-gray-500', bg: '' },
  rejected:       { icon: 'x', color: 'text-orange-400', bg: 'bg-orange-400/5' },
  executed:       { icon: '+', color: 'text-green-400', bg: 'bg-green-400/5' },
  position_close: { icon: '$', color: 'text-purple-400', bg: 'bg-purple-400/5' },
  error:          { icon: '!', color: 'text-red-400', bg: 'bg-red-400/5' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

function formatTime(dateStr: string): string {
  return new Date(dateStr).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}

interface Props {
  initialActivities: AgentActivity[];
}

export default function LiveFeed({ initialActivities }: Props) {
  const [activities, setActivities] = useState<AgentActivity[]>(initialActivities);

  useEffect(() => {
    const poll = async () => {
      const { data } = await supabase
        .from('agent_activity')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);
      if (data) setActivities(data as AgentActivity[]);
    };

    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Filter: show loop summaries, theses, rejections, executions, closes, no_trades, listings
  // Reduce scan noise: only show most recent scan
  const filtered = activities.filter((a, _i) => {
    if (a.type === 'scan') {
      const scanIndex = activities.filter(x => x.type === 'scan').indexOf(a);
      return scanIndex === 0;
    }
    return true;
  });

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-white">Agent Journal</h2>
          <span className="text-[10px] text-gray-600 bg-surface-2 px-1.5 py-0.5 rounded">
            Live
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-600">{activities.length} events</span>
        </div>
      </div>

      <div className="space-y-0.5 max-h-[600px] overflow-y-auto pr-1">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-8">Waiting for agent activity...</p>
        ) : (
          filtered.slice(0, 30).map((a) => {
            const cfg = TYPE_CONFIG[a.type] || { icon: '-', color: 'text-gray-500', bg: '' };
            const isHighlight = ['thesis', 'executed', 'position_close', 'listing'].includes(a.type);
            const isRejection = a.type === 'rejected';
            const isLoopSummary = a.type === 'loop_summary';

            return (
              <div
                key={a.id}
                className={`flex items-start gap-2.5 py-2 px-2 rounded-lg transition-colors ${cfg.bg} ${
                  isHighlight ? 'border-l-2 border-l-current' : ''
                }`}
                style={isHighlight ? { borderLeftColor: cfg.color.includes('green') ? '#22c55e' : cfg.color.includes('solana') ? '#9945FF' : cfg.color.includes('purple') ? '#a855f7' : cfg.color.includes('yellow') ? '#facc15' : '#6b7280' } : undefined}
              >
                <span className={`text-xs mono font-bold mt-0.5 w-3 text-center flex-shrink-0 ${cfg.color}`}>
                  {cfg.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-baseline gap-2">
                    <span className="text-[10px] text-gray-600 font-mono flex-shrink-0">
                      {formatTime(a.created_at)}
                    </span>
                    {a.token_symbol && (
                      <span className="text-xs text-white font-medium flex-shrink-0">{a.token_symbol}</span>
                    )}
                  </div>
                  <p className={`text-xs leading-relaxed mt-0.5 ${
                    isLoopSummary ? 'text-gray-400' :
                    isHighlight ? 'text-gray-200' :
                    isRejection ? 'text-gray-400' :
                    'text-gray-400'
                  }`}>
                    {a.title}
                  </p>
                  {a.details && (
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{a.details}</p>
                  )}
                  {/* Show rejection metadata */}
                  {isRejection && a.metadata && typeof a.metadata === 'object' && (
                    <div className="flex gap-3 mt-1">
                      {(a.metadata as Record<string, unknown>).confidence != null && (
                        <span className="text-[10px] text-gray-600">
                          Conf: {((a.metadata as Record<string, unknown>).confidence as number * 100).toFixed(0)}%
                        </span>
                      )}
                      {(a.metadata as Record<string, unknown>).rr != null && (
                        <span className="text-[10px] text-gray-600">
                          R/R: {((a.metadata as Record<string, unknown>).rr as number).toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}
                </div>
                <span className="text-[10px] text-gray-700 whitespace-nowrap flex-shrink-0 mt-0.5">
                  {timeAgo(a.created_at)}
                </span>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
