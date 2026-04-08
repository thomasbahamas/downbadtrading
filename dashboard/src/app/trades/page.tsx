import { supabase } from '@/lib/supabase';
import type { Trade, AgentActivity } from '@/lib/types';
import TradeHistory from '@/components/TradeHistory';
import RejectedTrades from '@/components/RejectedTrades';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const PAGE_SIZE = 50;

interface PageProps {
  searchParams: { page?: string; status?: string };
}

async function getTrades(page: number, status?: string) {
  const from = page * PAGE_SIZE;
  const to = from + PAGE_SIZE - 1;

  let query = supabase
    .from('trades')
    .select('*', { count: 'exact' })
    .order('opened_at', { ascending: false })
    .range(from, to);

  if (status && status !== 'all') {
    query = query.eq('status', status);
  }

  const { data, count, error } = await query;
  return {
    trades: (data as Trade[]) ?? [],
    total: count ?? 0,
    error: error?.message,
  };
}

async function getRejections() {
  const { data } = await supabase
    .from('agent_activity')
    .select('*')
    .in('type', ['rejected', 'no_trade'])
    .order('created_at', { ascending: false })
    .limit(20);
  return (data as AgentActivity[]) ?? [];
}

export default async function TradesPage({ searchParams }: PageProps) {
  const page = parseInt(searchParams.page ?? '0', 10);
  const status = searchParams.status;
  const [{ trades, total, error }, rejections] = await Promise.all([
    getTrades(page, status),
    getRejections(),
  ]);
  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="space-y-6 animate-fade-in">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-white">Trade History</h1>
          <p className="text-sm text-gray-500 mt-0.5">{total} total trades</p>
        </div>
        <div className="flex gap-2">
          {['all', 'open', 'tp_hit', 'sl_hit', 'expired'].map((s) => (
            <a
              key={s}
              href={`/trades?status=${s}`}
              className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                (status ?? 'all') === s
                  ? 'bg-solana text-white'
                  : 'bg-surface-2 text-gray-400 hover:text-white'
              }`}
            >
              {s.replace('_', ' ')}
            </a>
          ))}
        </div>
      </div>

      {error && (
        <div className="card border-red-500/30 text-red-400 text-sm">
          Error loading trades: {error}
        </div>
      )}

      <TradeHistory trades={trades} />

      {/* Rejected trades — shows discipline */}
      {rejections.length > 0 && (
        <RejectedTrades rejections={rejections} />
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 pt-4">
          {page > 0 && (
            <a
              href={`/trades?page=${page - 1}&status=${status ?? 'all'}`}
              className="px-4 py-2 text-sm bg-surface-2 hover:bg-surface-3 text-gray-300 rounded-lg transition-colors"
            >
              &larr; Previous
            </a>
          )}
          <span className="text-sm text-gray-500">
            Page {page + 1} of {totalPages}
          </span>
          {page < totalPages - 1 && (
            <a
              href={`/trades?page=${page + 1}&status=${status ?? 'all'}`}
              className="px-4 py-2 text-sm bg-surface-2 hover:bg-surface-3 text-gray-300 rounded-lg transition-colors"
            >
              Next &rarr;
            </a>
          )}
        </div>
      )}
    </div>
  );
}
