'use client';
// Shared display components for strategy validation stats - used by both the
// historical backtest page and the live outcome tracking page so the two stay
// visually comparable.
import Tip from '@/components/Tip';

export interface DisplayStats {
  totalTrades:  number;
  wins:         number;
  losses:       number;
  open:         number;
  winRate:      number;
  avgR:         number;
  profitFactor: number;
  maxDrawdownR: number;
  equityCurve:  number[];
}

export function fmtPct(n: number) { return (n * 100).toFixed(1) + '%'; }
export function fmtR(n: number) { return (n >= 0 ? '+' : '') + n.toFixed(2) + 'R'; }

export function EquityCurve({ data, color }: { data: number[]; color: string }) {
  if (data.length < 2) {
    return (
      <div style={{ fontSize: 'var(--fs-caption)', opacity: 0.4, padding: '32px 0', textAlign: 'center' }}>
        Not enough resolved trades to chart
      </div>
    );
  }
  const w = 100, h = 100;
  const min = Math.min(0, ...data);
  const max = Math.max(0, ...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * w;
    const y = h - ((v - min) / range) * h;
    return `${x},${y}`;
  }).join(' ');
  const zeroY = h - ((0 - min) / range) * h;
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 90, display: 'block' }} preserveAspectRatio="none">
      <line x1={0} y1={zeroY} x2={w} y2={zeroY} stroke="rgba(255,255,255,0.15)" strokeWidth={0.5} />
      <polyline points={points} fill="none" stroke={color} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

export function StatRow({ label, value, color, tip }: { label: string; value: string; color?: string; tip?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: 'var(--fs-caption)' }}>
      <span style={{ opacity: 0.55 }}>
        {tip ? <Tip text={tip}>{label}</Tip> : label}
      </span>
      <span style={{ fontWeight: 600, color: color ?? 'var(--txt)' }}>{value}</span>
    </div>
  );
}

/* Shared explanations for the four core strategy-validation stats, so the
   backtest page and live-tracking page describe them identically. */
export const STAT_TIPS = {
  winRate:      'The share of signals that hit take-profit before stop-loss. On its own it can mislead - a strategy can win under half its trades and still profit if the wins are larger than the losses.',
  profitFactor: 'Gross profit divided by gross loss. Above 1.0 means the strategy made money overall, and 1.5+ is strong; below 1.0 means it lost money across all trades.',
  avgR:         'Average result per trade in R - multiples of the amount risked. +0.20R means each trade netted a fifth of what was risked on average, which is the clearest single measure of a real edge.',
  maxDrawdown:  'The largest peak-to-trough drop in cumulative R before the strategy recovered. It shows the worst losing streak you would have had to sit through - how painful the strategy is to actually hold.',
} as const;

export function SideCard({ title, stats, color }: { title: string; stats: DisplayStats; color: string }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 12, padding: 16, flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color, marginBottom: 10, letterSpacing: '0.02em' }}>{title}</div>
      <EquityCurve data={stats.equityCurve} color={color} />
      <div style={{ marginTop: 10 }}>
        <StatRow label="Win Rate" tip={STAT_TIPS.winRate} value={fmtPct(stats.winRate)} color={stats.winRate >= 0.5 ? '#34d399' : '#f87171'} />
        <StatRow label="Trades" value={`${stats.totalTrades} (${stats.wins}W / ${stats.losses}L / ${stats.open} open)`} />
        <StatRow label="Profit Factor" tip={STAT_TIPS.profitFactor} value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} />
        <StatRow label="Avg R / Trade" tip={STAT_TIPS.avgR} value={fmtR(stats.avgR)} color={stats.avgR >= 0 ? '#34d399' : '#f87171'} />
        <StatRow label="Max Drawdown" tip={STAT_TIPS.maxDrawdown} value={`-${stats.maxDrawdownR.toFixed(2)}R`} color="#f87171" />
      </div>
    </div>
  );
}
