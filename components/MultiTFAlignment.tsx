'use client';
import { useMarket } from '@/lib/marketStore';

type Dir = 'bull' | 'bear' | 'neutral';

function rsiDir(rsi: number | null | undefined): Dir {
  if (rsi == null) return 'neutral';
  if (rsi > 57)   return 'bull';
  if (rsi < 43)   return 'bear';
  return 'neutral';
}

const DIR_COLOR: Record<Dir, string> = {
  bull:    '#34d399',
  bear:    '#f87171',
  neutral: '#6b7280',
};
const DIR_LABEL: Record<Dir, string> = {
  bull:    'Bullish',
  bear:    'Bearish',
  neutral: 'Neutral',
};
const DIR_ARROW: Record<Dir, string> = { bull: '▲', bear: '▼', neutral: '→' };

function TFRow({ tf, rsi, dir }: { tf: string; rsi: number | null | undefined; dir: Dir }) {
  const col = DIR_COLOR[dir];
  return (
    <div style={{
      display: 'grid', gridTemplateColumns: '44px 1fr 36px 92px',
      alignItems: 'center', gap: 10, padding: '7px 0',
      borderBottom: '0.5px solid var(--bdr)',
    }}>
      <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--txt2)', letterSpacing: '.02em' }}>{tf}</div>
      {/* RSI bar */}
      <div style={{ height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, position: 'relative' }}>
        <div style={{
          position: 'absolute', left: 0, top: 0, height: '100%', borderRadius: 2,
          width: rsi != null ? `${Math.min(rsi, 100)}%` : '50%',
          background: dir === 'neutral' ? '#374151' : col,
          transition: 'width 0.4s ease',
        }} />
        {/* 50-line tick */}
        <div style={{
          position: 'absolute', left: '50%', top: -2, width: 1, height: 8,
          background: 'rgba(255,255,255,0.2)',
        }} />
      </div>
      {/* Value */}
      <div style={{ fontSize: 12, fontWeight: 700, color: col, textAlign: 'right' }}>
        {rsi != null ? rsi.toFixed(0) : '—'}
      </div>
      {/* Bias pill */}
      <div style={{
        fontSize: 10, fontWeight: 700, textAlign: 'center',
        padding: '3px 6px', borderRadius: 5,
        color: col, background: col + '18', border: `0.5px solid ${col}40`,
        letterSpacing: '.02em',
      }}>
        {DIR_ARROW[dir]} {DIR_LABEL[dir]}
      </div>
    </div>
  );
}

export default function MultiTFAlignment() {
  const { store } = useMarket();
  const coin = store.selectedCoin;
  const d    = store.coins[coin];

  const dir15m = rsiDir(d?.rsi14);
  const dir1h  = rsiDir(d?.rsi1h);
  const dir4h  = rsiDir(d?.rsi4h);
  const dirs   = [dir15m, dir1h, dir4h];

  const bullCount = dirs.filter(x => x === 'bull').length;
  const bearCount = dirs.filter(x => x === 'bear').length;

  const oiBull  = d?.oiTrend === 'strong_up'   || d?.oiTrend === 'weak_up';
  const oiBear  = d?.oiTrend === 'strong_down'  || d?.oiTrend === 'weak_down';
  const cvdBull = d?.cvdDivergence === 'bullish';
  const cvdBear = d?.cvdDivergence === 'bearish';

  let verdict: { label: string; col: string; sub: string };

  if (bullCount === 3) {
    verdict = {
      label: 'Strong Setup',
      col: '#34d399',
      sub: oiBull  ? 'All three timeframes bullish · OI confirms with new longs'
         : cvdBull ? 'All three timeframes bullish · CVD confirms accumulation'
         :           'All three timeframes aligned bullish — high conviction',
    };
  } else if (bearCount === 3) {
    verdict = {
      label: 'Strong Setup',
      col: '#f87171',
      sub: oiBear  ? 'All three timeframes bearish · OI confirms with new shorts'
         : cvdBear ? 'All three timeframes bearish · CVD confirms distribution'
         :           'All three timeframes aligned bearish — high conviction',
    };
  } else if (bullCount === 2 && bearCount === 0) {
    verdict = {
      label: 'Leaning Bullish',
      col: '#86efac',
      sub: `15m/1h/4h: 2 of 3 bullish. Wait for ${dir15m !== 'bull' ? '15m' : dir1h !== 'bull' ? '1h' : '4h'} to confirm before entering.`,
    };
  } else if (bearCount === 2 && bullCount === 0) {
    verdict = {
      label: 'Leaning Bearish',
      col: '#fca5a5',
      sub: `15m/1h/4h: 2 of 3 bearish. Wait for ${dir15m !== 'bear' ? '15m' : dir1h !== 'bear' ? '1h' : '4h'} to confirm before entering.`,
    };
  } else if (bullCount >= 1 && bearCount >= 1) {
    verdict = {
      label: 'Conflicting',
      col: '#fbbf24',
      sub: 'Higher and lower timeframes disagree. Stay out or reduce size — no clear edge.',
    };
  } else {
    verdict = {
      label: 'Mixed Signals',
      col: '#6b7280',
      sub: 'No clear directional bias across timeframes. Wait for RSI to pick a side.',
    };
  }

  const hasData = d?.rsi14 != null || d?.rsi1h != null || d?.rsi4h != null;

  return (
    <div className="sms-card">
      <div className="sms-header">
        <div>
          <div className="sms-title">Multi-Timeframe Alignment</div>
          <div className="sms-sub">{coin.toUpperCase()} RSI direction — 15m · 1h · 4h</div>
        </div>
        <div className="sms-verdict" style={{ color: verdict.col }}>{verdict.label}</div>
      </div>

      {hasData ? (
        <>
          {/* Column headers */}
          <div style={{
            display: 'grid', gridTemplateColumns: '44px 1fr 36px 92px',
            gap: 10, paddingBottom: 4,
          }}>
            {(['TF', 'RSI(14)', 'Val', 'Bias'] as const).map((h, i) => (
              <div key={h} style={{
                fontSize: 9, fontWeight: 700, color: 'var(--txt3)',
                letterSpacing: '.05em', textTransform: 'uppercase',
                textAlign: i === 2 ? 'right' : i === 3 ? 'center' : 'left',
              }}>{h}</div>
            ))}
          </div>

          <TFRow tf="15m" rsi={d?.rsi14} dir={dir15m} />
          <TFRow tf="1h"  rsi={d?.rsi1h} dir={dir1h}  />
          <TFRow tf="4h"  rsi={d?.rsi4h} dir={dir4h}  />

          {/* Verdict callout */}
          <div style={{
            marginTop: 10, fontSize: 11, fontWeight: 600, lineHeight: 1.5,
            color: verdict.col, padding: '8px 10px', borderRadius: 8,
            background: verdict.col + '11',
            border: `0.5px solid ${verdict.col}33`,
          }}>
            {verdict.sub}
          </div>
        </>
      ) : (
        <div style={{ fontSize: 12, color: 'var(--txt3)', padding: '12px 0' }}>
          Warming up RSI data…
        </div>
      )}
    </div>
  );
}
