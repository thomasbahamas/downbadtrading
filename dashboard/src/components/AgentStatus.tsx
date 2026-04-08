'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface HeartbeatData {
  status: string;
  loopCount: number;
  paperTrade: boolean;
  uptime: number;
  activePositions: number;
  portfolioValueUsd: number;
  usdcBalance: number;
  solBalance: number;
  timestamp: string;
  lastError: string | null;
}

type StatusIndicator = 'online' | 'offline' | 'loading';

export default function AgentStatus() {
  const [heartbeat, setHeartbeat] = useState<HeartbeatData | null>(null);
  const [status, setStatus] = useState<StatusIndicator>('loading');

  useEffect(() => {
    const fetchHeartbeat = async () => {
      try {
        const { data, error } = await supabase
          .from('circuit_breaker_state')
          .select('value, updated_at')
          .eq('key', 'agent_heartbeat')
          .single();

        if (error || !data) {
          setStatus('offline');
          return;
        }

        const hb = data.value as HeartbeatData;
        const lastUpdate = new Date(data.updated_at).getTime();
        const ageMs = Date.now() - lastUpdate;

        // Consider online if updated within last 5 minutes
        setStatus(ageMs < 5 * 60 * 1000 ? 'online' : 'offline');
        setHeartbeat(hb);
      } catch {
        setStatus('offline');
      }
    };

    void fetchHeartbeat();
    const interval = setInterval(fetchHeartbeat, 15_000);
    return () => clearInterval(interval);
  }, []);

  const dotClass =
    status === 'online'
      ? 'bg-profit animate-pulse-slow'
      : status === 'offline'
      ? 'bg-loss'
      : 'bg-gray-500 animate-pulse';

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">Agent Status</h2>
        <div className="flex items-center gap-2">
          <span className={`w-2 h-2 rounded-full ${dotClass}`} />
          <span className="text-xs text-gray-400 capitalize">{status}</span>
        </div>
      </div>

      {heartbeat ? (
        <div className="space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Mode</span>
            <span className={heartbeat.paperTrade ? 'text-warning' : 'text-profit'}>
              {heartbeat.paperTrade ? 'Paper Trade' : 'Live'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Loop Count</span>
            <span className="text-white mono">{heartbeat.loopCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Positions</span>
            <span className="text-white mono">{heartbeat.activePositions}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Uptime</span>
            <span className="text-gray-300 mono">{formatUptime(heartbeat.uptime)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Last Ping</span>
            <span className="text-gray-400">
              {new Date(heartbeat.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
      ) : status === 'offline' ? (
        <p className="text-sm text-gray-500 text-center py-4">Agent not running</p>
      ) : (
        <div className="space-y-3">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="flex justify-between">
              <div className="h-3 w-16 bg-surface-3 rounded animate-pulse" />
              <div className="h-3 w-20 bg-surface-3 rounded animate-pulse" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}
