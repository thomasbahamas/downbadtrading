'use client';

import { useEffect, useState } from 'react';
import type { AgentHealth } from '@/lib/types';

const AGENT_URL = process.env.NEXT_PUBLIC_AGENT_URL ?? 'http://localhost:3001';

// Map loop state names to display labels
const STATE_LABELS: Record<string, string> = {
  observe: 'OBSERVE',
  analyze: 'ANALYZE',
  decide: 'DECIDE',
  execute: 'EXECUTE',
  report: 'REPORT',
  monitor: 'MONITOR',
};

type StatusIndicator = 'online' | 'offline' | 'loading';

export default function AgentStatus() {
  const [health, setHealth] = useState<AgentHealth | null>(null);
  const [status, setStatus] = useState<StatusIndicator>('loading');

  useEffect(() => {
    const fetchHealth = async () => {
      try {
        const res = await fetch(`${AGENT_URL}/health`, {
          cache: 'no-store',
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          const data = await res.json() as AgentHealth;
          setHealth(data);
          setStatus('online');
        } else {
          setStatus('offline');
        }
      } catch {
        setStatus('offline');
      }
    };

    void fetchHealth();
    const interval = setInterval(fetchHealth, 15_000);
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

      {health ? (
        <div className="space-y-3">
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Mode</span>
            <span className={health.paperTrade ? 'text-warning' : 'text-profit'}>
              {health.paperTrade ? 'Paper Trade' : 'Live'}
            </span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Loop Count</span>
            <span className="text-white mono">{health.loopCount.toLocaleString()}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Uptime</span>
            <span className="text-gray-300 mono">{formatUptime(health.uptime)}</span>
          </div>
          <div className="flex justify-between text-xs">
            <span className="text-gray-500">Last Ping</span>
            <span className="text-gray-400">
              {new Date(health.timestamp).toLocaleTimeString()}
            </span>
          </div>
        </div>
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
