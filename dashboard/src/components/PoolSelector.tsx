'use client';

import { useState, useRef, useEffect } from 'react';
import type { Pool, PoolStats } from '@/lib/types';

interface Props {
  pools: Pool[];
  stats: Map<string, PoolStats>;
  activePoolId: string;
  onChange: (poolId: string) => void;
}

/**
 * Pool selector dropdown — shown in the dashboard header when there's more
 * than one pool. For a single-pool install it renders as a static label.
 *
 * Read-only: selecting a pool just re-scopes what the dashboard reads; the
 * agent still runs on a single trading wallet configured in its env. Full
 * multi-pool agent support is a separate project.
 */
export default function PoolSelector({
  pools,
  stats,
  activePoolId,
  onChange,
}: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on outside click
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener('mousedown', handle);
    return () => document.removeEventListener('mousedown', handle);
  }, [open]);

  const active = pools.find((p) => p.id === activePoolId) ?? pools[0];
  if (!active) return null;

  // Single-pool install — no dropdown, just a static label
  if (pools.length <= 1) {
    return (
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-1/60 border border-surface-border/50">
        <PoolDot />
        <span className="text-xs font-medium text-gray-200">{active.name}</span>
      </div>
    );
  }

  const activeStats = stats.get(active.id);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface-1/60 border border-surface-border/50 hover:border-solana-light/50 transition-colors"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <PoolDot />
        <span className="text-xs font-medium text-gray-200">{active.name}</span>
        {activeStats && (
          <span className={`text-[10px] mono ${activeStats.total_pnl >= 0 ? 'text-profit' : 'text-loss'}`}>
            {activeStats.total_pnl >= 0 ? '+' : ''}${activeStats.total_pnl.toFixed(0)}
          </span>
        )}
        <Chevron open={open} />
      </button>

      {open && (
        <div
          role="listbox"
          className="absolute top-full left-0 mt-1 w-64 bg-surface-1 border border-surface-border rounded-lg shadow-xl overflow-hidden z-50 animate-fade-in"
        >
          {pools.map((pool) => {
            const s = stats.get(pool.id);
            const isActive = pool.id === active.id;
            return (
              <button
                key={pool.id}
                type="button"
                role="option"
                aria-selected={isActive}
                onClick={() => {
                  onChange(pool.id);
                  setOpen(false);
                }}
                className={`w-full px-3 py-2.5 flex items-start gap-3 text-left hover:bg-surface-2/50 transition-colors border-b border-surface-border/30 last:border-b-0 ${
                  isActive ? 'bg-surface-2/40' : ''
                }`}
              >
                <PoolDot />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium text-white truncate">{pool.name}</span>
                    {pool.is_public && (
                      <span className="text-[9px] uppercase tracking-wider text-solana-light bg-solana/10 px-1.5 py-0.5 rounded">
                        Public
                      </span>
                    )}
                  </div>
                  {pool.description && (
                    <p className="text-[11px] text-gray-500 mt-0.5 line-clamp-1">
                      {pool.description}
                    </p>
                  )}
                  {s && (
                    <div className="flex items-center gap-3 mt-1 text-[10px] text-gray-600">
                      <span>{s.total_trades} trades</span>
                      <span>·</span>
                      <span>{(s.win_rate * 100).toFixed(0)}% win</span>
                      <span>·</span>
                      <span className={s.total_pnl >= 0 ? 'text-profit' : 'text-loss'}>
                        {s.total_pnl >= 0 ? '+' : ''}${s.total_pnl.toFixed(0)}
                      </span>
                    </div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PoolDot() {
  return (
    <span className="flex items-center justify-center w-2 h-2">
      <span className="w-2 h-2 rounded-full bg-solana-light animate-pulse" />
    </span>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={`text-gray-500 transition-transform ${open ? 'rotate-180' : ''}`}
    >
      <path d="M2 4l3 3 3-3" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}
