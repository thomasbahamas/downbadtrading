'use client';

import { useState, type ReactNode } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import PoolSelector from './PoolSelector';
import type { Pool, PoolStats } from '@/lib/types';

type TabId = 'overview' | 'performance' | 'activity' | 'pools';

interface Props {
  pools: Pool[];
  poolStats: Map<string, PoolStats>;
  activePoolId: string;
  overview: ReactNode;
  performance: ReactNode;
  activity: ReactNode;
  poolsTab: ReactNode;
}

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: 'Overview' },
  { id: 'performance', label: 'Performance' },
  { id: 'activity', label: 'Activity' },
  { id: 'pools', label: 'Pools' },
];

/**
 * Client-side dashboard shell — wraps the tab system, the sticky header with
 * the pool selector, and all of the tabbed content panels. Receives panels
 * as pre-rendered ReactNodes so data fetching stays server-side.
 *
 * Tab state is local (useState); pool selection is URL-driven (router.push
 * sets `?pool=<slug>`) so the server component re-fetches scoped data.
 */
export default function DashboardShell({
  pools,
  poolStats,
  activePoolId,
  overview,
  performance,
  activity,
  poolsTab,
}: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const router = useRouter();
  const searchParams = useSearchParams();

  function handlePoolChange(poolId: string) {
    const nextPool = pools.find((p) => p.id === poolId);
    if (!nextPool) return;
    const params = new URLSearchParams(searchParams.toString());
    params.set('pool', nextPool.slug);
    router.push(`/?${params.toString()}`);
  }

  return (
    <div className="space-y-5 animate-fade-in">
      {/* Sticky header — title, pool selector, autonomous indicator */}
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-xl font-semibold text-white">DownBad Trading</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            Autonomous Solana trading agent — all trades executed by AI
          </p>
        </div>
        <div className="flex items-center gap-3">
          <PoolSelector
            pools={pools}
            stats={poolStats}
            activePoolId={activePoolId}
            onChange={handlePoolChange}
          />
          <div className="hidden sm:flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-surface-1/40 border border-surface-border/40">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
            <span className="text-[11px] text-gray-500 uppercase tracking-wider">Autonomous</span>
          </div>
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center gap-1 border-b border-surface-border/50 -mx-1 overflow-x-auto">
        {TABS.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id)}
              className={`relative px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
                isActive ? 'text-white' : 'text-gray-500 hover:text-gray-300'
              }`}
              aria-current={isActive ? 'page' : undefined}
            >
              {tab.label}
              {isActive && (
                <span className="absolute bottom-0 left-4 right-4 h-0.5 bg-solana-light rounded-full" />
              )}
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div key={activeTab} className="animate-fade-in">
        {activeTab === 'overview' && overview}
        {activeTab === 'performance' && performance}
        {activeTab === 'activity' && activity}
        {activeTab === 'pools' && poolsTab}
      </div>
    </div>
  );
}
