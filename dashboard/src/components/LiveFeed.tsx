'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import type { AgentActivity } from '@/lib/types';

const TYPE_CONFIG: Record<string, { icon: string; color: string }> = {
  scan:           { icon: 'o', color: 'text-gray-500' },
  listing:        { icon: '!', color: 'text-yellow-400' },
  thesis:         { icon: '?', color: 'text-blue-400' },
  rejected:       { icon: 'x', color: 'text-gray-500' },
  executed:       { icon: '+', color: 'text-green-400' },
  position_close: { icon: '$', color: 'text-purple-400' },
  error:          { icon: '!', color: 'text-red-400' },
};

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

interface Props {
  initialActivities: AgentActivity[];
}

export default function LiveFeed({ initialActivities }: Props) {
  const [activities, setActivities] = useState<AgentActivity[]>(initialActivities);

  // Poll for new activities every 15s
  useEffect(() => {
    const poll = async () => {
      const { data } = await supabase
        .from('agent_activity')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(30);
      if (data) setActivities(data as AgentActivity[]);
    };

    const interval = setInterval(poll, 15_000);
    return () => clearInterval(interval);
  }, []);

  // Filter out scan events for cleaner feed (keep every 5th scan)
  const filtered = activities.filter((a, i) => {
    if (a.type !== 'scan') return true;
    // Show scan events only if they're the most recent one
    const scanIndex = activities.filter(x => x.type === 'scan').indexOf(a);
    return scanIndex === 0;
  });

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-sm font-semibold text-white">Live Activity</h2>
        <div className="flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-500">Live</span>
        </div>
      </div>

      <div className="space-y-1.5 max-h-80 overflow-y-auto pr-1 scrollbar-thin">
        {filtered.length === 0 ? (
          <p className="text-xs text-gray-600 text-center py-4">Waiting for agent activity...</p>
        ) : (
          filtered.slice(0, 15).map((a) => {
            const cfg = TYPE_CONFIG[a.type] || { icon: '-', color: 'text-gray-500' };
            return (
              <div key={a.id} className="flex items-start gap-2 py-1.5 border-b border-surface-border/20 last:border-0">
                <span className={`text-xs mono font-bold mt-0.5 w-3 text-center ${cfg.color}`}>
                  {cfg.icon}
                </span>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-gray-300 leading-relaxed">
                    {a.token_symbol && (
                      <span className="text-white font-medium">{a.token_symbol} </span>
                    )}
                    {a.title}
                  </p>
                  {a.details && (
                    <p className="text-xs text-gray-600 truncate">{a.details}</p>
                  )}
                </div>
                <span className="text-xs text-gray-600 whitespace-nowrap flex-shrink-0">
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
