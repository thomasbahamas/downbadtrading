import { supabase } from './supabase';
import type { Pool, PoolStats } from './types';

/**
 * Fetches the list of pools plus the aggregated `pool_stats` view in a single
 * round trip. Falls back gracefully when the pools table / migration hasn't
 * been applied yet, so the dashboard still renders for pre-migration installs.
 *
 * This is read-only scaffolding — no pool creation or editing is exposed yet.
 * The agent still writes to a single default pool ("main") by backfill.
 */
export async function getPools(): Promise<{
  pools: Pool[];
  stats: Map<string, PoolStats>;
}> {
  const [poolsRes, statsRes] = await Promise.all([
    supabase.from('pools').select('*').order('display_order', { ascending: true }),
    supabase.from('pool_stats').select('*'),
  ]);

  // If the migration hasn't run yet, both queries 404/error — synthesize an
  // in-memory "main" pool so the dashboard still works.
  if (poolsRes.error || !poolsRes.data || poolsRes.data.length === 0) {
    const fallback: Pool = {
      id: 'fallback-main',
      slug: 'main',
      name: 'Main Pool',
      description: 'Primary DownBad trading pool',
      wallet_address: null,
      profit_wallet: null,
      is_public: false,
      is_default: true,
      display_order: 0,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    return { pools: [fallback], stats: new Map() };
  }

  const statsMap = new Map<string, PoolStats>();
  if (!statsRes.error && statsRes.data) {
    for (const row of statsRes.data as PoolStats[]) {
      statsMap.set(row.pool_id, row);
    }
  }

  return { pools: poolsRes.data as Pool[], stats: statsMap };
}

/**
 * Returns the pool that should be shown by default — the one flagged
 * `is_default` in the DB, or the first pool if nothing is flagged.
 */
export function pickDefaultPool(pools: Pool[]): Pool | null {
  if (pools.length === 0) return null;
  return pools.find((p) => p.is_default) ?? pools[0];
}
