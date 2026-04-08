'use client';

interface Props {
  tokensAnalyzed: number;
  thesesGenerated: number;
  tradesExecuted: number;
  openPositions: number;
  winRate: number;
  totalPnl: number;
  avgHoldTime: string;
  bestTrade: number | null;
  worstTrade: number | null;
}

export default function StatsBar({
  tokensAnalyzed,
  thesesGenerated,
  tradesExecuted,
  openPositions,
  winRate,
  totalPnl,
  avgHoldTime,
  bestTrade,
  worstTrade,
}: Props) {
  return (
    <div className="space-y-3">
      {/* Decision funnel — the hero stat */}
      <div className="flex items-center gap-3 px-4 py-3 bg-surface-1/50 rounded-xl border border-surface-border/50">
        <div className="flex items-center gap-2 flex-1">
          <FunnelStep label="Tokens Scanned" value={tokensAnalyzed.toLocaleString()} />
          <Arrow />
          <FunnelStep label="Theses Generated" value={thesesGenerated.toLocaleString()} />
          <Arrow />
          <FunnelStep label="Trades Taken" value={tradesExecuted.toLocaleString()} highlight />
        </div>
        <div className="hidden sm:flex items-center gap-1.5 ml-auto pl-4 border-l border-surface-border/50">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" />
          <span className="text-xs text-gray-500">Autonomous</span>
        </div>
      </div>

      {/* Track record stats */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-2.5 bg-surface-1/30 rounded-xl border border-surface-border/30">
        <Stat label="Open" value={openPositions.toString()} />
        <Sep />
        <Stat
          label="Win Rate"
          value={tradesExecuted > 0 ? `${(winRate * 100).toFixed(0)}%` : '--'}
          valueClass={winRate >= 0.5 ? 'text-profit' : winRate > 0 ? 'text-loss' : undefined}
        />
        <Sep />
        <Stat
          label="Total P&L"
          value={totalPnl !== 0 ? `${totalPnl > 0 ? '+' : ''}$${totalPnl.toFixed(2)}` : '$0.00'}
          valueClass={totalPnl > 0 ? 'text-profit' : totalPnl < 0 ? 'text-loss' : undefined}
        />
        <Sep />
        <Stat label="Avg Hold" value={avgHoldTime || '--'} />
        <Sep />
        <Stat
          label="Best"
          value={bestTrade !== null ? `+$${bestTrade.toFixed(2)}` : '--'}
          valueClass="text-profit"
        />
        <Sep />
        <Stat
          label="Worst"
          value={worstTrade !== null ? `-$${Math.abs(worstTrade).toFixed(2)}` : '--'}
          valueClass="text-loss"
        />
      </div>
    </div>
  );
}

function FunnelStep({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className="text-center">
      <p className={`text-lg font-bold mono ${highlight ? 'text-solana-light' : 'text-white'}`}>{value}</p>
      <p className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</p>
    </div>
  );
}

function Arrow() {
  return (
    <svg width="20" height="12" viewBox="0 0 20 12" className="text-gray-600 flex-shrink-0 mx-1">
      <path d="M0 6h16M12 1l5 5-5 5" stroke="currentColor" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function Sep() {
  return <div className="w-px h-3.5 bg-surface-border/50 hidden sm:block" />;
}

function Stat({ label, value, valueClass }: { label: string; value: string; valueClass?: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-[10px] text-gray-600 uppercase tracking-wider">{label}</span>
      <span className={`text-xs font-semibold mono ${valueClass ?? 'text-gray-300'}`}>{value}</span>
    </div>
  );
}
