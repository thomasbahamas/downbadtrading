import type { Pool, PoolStats } from '@/lib/types';

interface Props {
  pools: Pool[];
  stats: Map<string, PoolStats>;
}

/**
 * Read-only pool browser. Shows every pool the dashboard knows about along
 * with its aggregated performance stats. Intended as the data-model
 * scaffolding for eventually opening up multi-pool / public pool joining —
 * no deposit, withdraw, or create flows are exposed here.
 */
export default function PoolsPanel({ pools, stats }: Props) {
  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex items-start justify-between mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Trading Pools</h2>
            <p className="text-sm text-gray-500 mt-1">
              All pools the dashboard is aware of. Pool switching in the header
              re-scopes every metric and chart. Additional pools can be added
              by inserting rows in the <code className="text-gray-400">pools</code> table.
            </p>
          </div>
        </div>

        {pools.length === 0 ? (
          <p className="text-sm text-gray-500 text-center py-8">
            No pools configured. Run the 001_pools migration to seed the default pool.
          </p>
        ) : (
          <div className="space-y-3">
            {pools.map((pool) => {
              const s = stats.get(pool.id);
              const pnl = s?.total_pnl ?? 0;
              return (
                <div
                  key={pool.id}
                  className="bg-surface-2/40 rounded-lg p-4 border border-surface-border/50"
                >
                  <div className="flex items-start justify-between flex-wrap gap-3 mb-3">
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-semibold text-white">{pool.name}</h3>
                        {pool.is_default && (
                          <span className="text-[10px] uppercase tracking-wider text-solana-light bg-solana/10 px-2 py-0.5 rounded">
                            Default
                          </span>
                        )}
                        {pool.is_public && (
                          <span className="text-[10px] uppercase tracking-wider text-green-400 bg-green-500/10 px-2 py-0.5 rounded">
                            Public
                          </span>
                        )}
                      </div>
                      {pool.description && (
                        <p className="text-sm text-gray-400 mt-1">{pool.description}</p>
                      )}
                      <p className="text-[11px] text-gray-600 mt-1 font-mono">{pool.slug}</p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] uppercase tracking-wider text-gray-600">Total P&amp;L</p>
                      <p
                        className={`text-lg font-semibold mono ${
                          pnl >= 0 ? 'text-profit' : 'text-loss'
                        }`}
                      >
                        {pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}
                      </p>
                    </div>
                  </div>

                  {s ? (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-3 border-t border-surface-border/30">
                      <Metric label="Total trades" value={s.total_trades.toString()} />
                      <Metric label="Open positions" value={s.open_positions.toString()} />
                      <Metric
                        label="Win rate"
                        value={s.total_trades > 0 ? `${(s.win_rate * 100).toFixed(0)}%` : '--'}
                      />
                      <Metric label="W / L" value={`${s.wins} / ${s.losses}`} />
                    </div>
                  ) : (
                    <p className="text-xs text-gray-600 pt-3 border-t border-surface-border/30">
                      No activity yet.
                    </p>
                  )}

                  {pool.wallet_address && (
                    <div className="mt-3 pt-3 border-t border-surface-border/30">
                      <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-1">
                        Trading wallet
                      </p>
                      <p className="text-[11px] text-gray-400 mono break-all">
                        {pool.wallet_address}
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="card bg-surface-1/40 border-dashed">
        <h3 className="text-sm font-semibold text-white mb-2">About public pools</h3>
        <p className="text-xs text-gray-500 leading-relaxed">
          Public pool support (deposits, withdrawals, per-user auth) is on the roadmap but
          intentionally not enabled here. Managing other people&apos;s funds on-chain has real
          legal and custody implications — the read-only scaffolding you see on this tab
          is only step one. The agent still runs on a single trading wallet; the data model
          is just ready to attribute activity to multiple pools when that work is done.
        </p>
      </div>
    </div>
  );
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-0.5">{label}</p>
      <p className="text-sm font-semibold mono text-gray-200">{value}</p>
    </div>
  );
}
