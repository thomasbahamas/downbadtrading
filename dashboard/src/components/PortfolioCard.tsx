'use client';

import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

interface Props {
  deployedCapital: number;
  dailyPnl: number;
  dailyPnlPct: number;
  totalPnl: number;
  openPositions: number;
  totalTrades: number;
}

interface HeartbeatWallet {
  portfolioValueUsd: number;
  usdcBalance: number;
  solBalance: number;
}

function pnlColor(n: number): string {
  if (n > 0) return 'text-profit';
  if (n < 0) return 'text-loss';
  return 'text-gray-400';
}

function formatUsd(n: number): string {
  return n.toLocaleString('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function formatPct(n: number): string {
  const sign = n > 0 ? '+' : '';
  return `${sign}${(n * 100).toFixed(2)}%`;
}

export default function PortfolioCard({
  deployedCapital,
  dailyPnl,
  dailyPnlPct,
  totalPnl,
  openPositions,
  totalTrades,
}: Props) {
  const [wallet, setWallet] = useState<HeartbeatWallet | null>(null);

  useEffect(() => {
    const fetch = async () => {
      const { data } = await supabase
        .from('circuit_breaker_state')
        .select('value')
        .eq('key', 'agent_heartbeat')
        .single();
      if (data?.value) {
        const v = data.value as HeartbeatWallet;
        if (v.portfolioValueUsd != null) setWallet(v);
      }
    };
    void fetch();
    const interval = setInterval(fetch, 30_000);
    return () => clearInterval(interval);
  }, []);

  const totalValue = wallet?.portfolioValueUsd ?? deployedCapital;

  return (
    <div className="card h-full">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-sm font-semibold text-white">Portfolio</h2>
        <span className="text-xs text-gray-500">Live</span>
      </div>

      {/* Total portfolio value */}
      <div className="mb-4">
        <p className="text-3xl font-bold text-white mono">
          {formatUsd(totalValue)}
        </p>
        <p className="text-xs text-gray-500 mt-0.5">
          {deployedCapital > 0 ? `${formatUsd(deployedCapital)} deployed` : 'Total wallet value'}
        </p>
        {wallet && wallet.usdcBalance > 0 && (
          <p className="text-xs text-gray-600 mt-0.5">
            {formatUsd(wallet.usdcBalance)} USDC + {wallet.solBalance.toFixed(4)} SOL
          </p>
        )}
        {dailyPnl !== 0 && (
          <div className="flex items-center gap-2 mt-1">
            <span className={`text-sm mono ${pnlColor(dailyPnl)}`}>
              {dailyPnl >= 0 ? '+' : ''}{formatUsd(dailyPnl)}
            </span>
            <span className={`text-xs ${pnlColor(dailyPnlPct)}`}>
              ({formatPct(dailyPnlPct)})
            </span>
            <span className="text-xs text-gray-600">today</span>
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3 pt-3 border-t border-surface-border">
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Total P&L</p>
          <p className={`text-sm mono ${pnlColor(totalPnl)}`}>
            {totalPnl >= 0 ? '+' : ''}{formatUsd(totalPnl)}
          </p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Open Positions</p>
          <p className="text-sm mono text-white">{openPositions}</p>
        </div>
        <div>
          <p className="text-xs text-gray-500 mb-0.5">Total Trades</p>
          <p className="text-sm mono text-white">{totalTrades}</p>
        </div>
      </div>
    </div>
  );
}
