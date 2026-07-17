'use client';
// Shared display components for strategy validation stats - used by both the
// historical backtest page and the live outcome tracking page so the two stay
// visually comparable.

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
      <div style={{ fontSize: '0.6875rem', opacity: 0.4, padding: '32px 0', textAlign: 'center' }}>
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

export function StatRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', fontSize: '0.75rem' }}>
      <span style={{ opacity: 0.55 }}>{label}</span>
      <span style={{ fontWeight: 600, color: color ?? 'var(--txt)' }}>{value}</span>
    </div>
  );
}

export function SideCard({ title, stats, color }: { title: string; stats: DisplayStats; color: string }) {
  return (
    <div style={{ background: 'var(--bg2)', border: '1px solid var(--bdr)', borderRadius: 12, padding: 16, flex: 1, minWidth: 260 }}>
      <div style={{ fontSize: '0.8125rem', fontWeight: 700, color, marginBottom: 10, letterSpacing: '0.02em' }}>{title}</div>
      <EquityCurve data={stats.equityCurve} color={color} />
      <div style={{ marginTop: 10 }}>
        <StatRow label="Win Rate" value={fmtPct(stats.winRate)} color={stats.winRate >= 0.5 ? '#34d399' : '#f87171'} />
        <StatRow label="Trades" value={`${stats.totalTrades} (${stats.wins}W / ${stats.losses}L / ${stats.open} open)`} />
        <StatRow label="Profit Factor" value={isFinite(stats.profitFactor) ? stats.profitFactor.toFixed(2) : '∞'} />
        <StatRow label="Avg R / Trade" value={fmtR(stats.avgR)} color={stats.avgR >= 0 ? '#34d399' : '#f87171'} />
        <StatRow label="Max Drawdown" value={`-${stats.maxDrawdownR.toFixed(2)}R`} color="#f87171" />
      </div>
    </div>
  );
}
