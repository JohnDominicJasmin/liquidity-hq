'use client';
import { useEffect, useState } from 'react';
import { useMarket, BINANCE_SYMS } from '@/lib/marketStore';
import Sparkline from './Sparkline';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

/* ── Fear & Greed label → CSS class (existing .score-* tokens, previously
   unused - this widget is the first to actually wire them up). Derived from
   the API's own classification label rather than re-guessed numeric
   thresholds, so the color always agrees with the text ("Extreme Fear"
   showing in the Fear-tier orange instead of red was exactly this bug). ── */
function fngScoreClass(label: string): string {
  const l = label.toLowerCase();
  if (l.includes('extreme fear'))  return 'score-extreme-fear';
  if (l.includes('extreme greed')) return 'score-extreme-greed';
  if (l.includes('fear'))  return 'score-fear';
  if (l.includes('greed')) return 'score-greed';
  return 'score-neutral';
}

/* ── Semicircle dial - value 0-100, needle sweeps left (Fear) to right
   (Greed) across a red->orange->yellow->green arc. */
function FngGauge({ value }: { value: number | null }) {
  const cx = 100, cy = 100, r = 82;
  const v = value ?? 50;
  const angleDeg = 180 - (v / 100) * 180; // 0 -> 180deg (left), 100 -> 0deg (right)
  const rad = (angleDeg * Math.PI) / 180;
  const needleLen = r - 14;
  const tipX = cx + needleLen * Math.cos(rad);
  const tipY = cy - needleLen * Math.sin(rad);
  const arcStart = { x: cx - r, y: cy };
  const arcEnd   = { x: cx + r, y: cy };

  return (
    <svg width={168} height={92} viewBox="0 0 200 108" style={{ flexShrink: 0 }}>
      <defs>
        <linearGradient id="fngGaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stopColor="var(--red)" />
          <stop offset="25%"  stopColor="#f97316" />
          <stop offset="50%"  stopColor="#facc15" />
          <stop offset="75%"  stopColor="#a3e635" />
          <stop offset="100%" stopColor="#22c55e" />
        </linearGradient>
      </defs>
      <path
        d={`M ${arcStart.x} ${arcStart.y} A ${r} ${r} 0 0 1 ${arcEnd.x} ${arcEnd.y}`}
        fill="none" stroke="url(#fngGaugeGrad)" strokeWidth={14} strokeLinecap="round"
      />
      {value != null && (
        <>
          <line x1={cx} y1={cy} x2={tipX} y2={tipY} stroke="var(--txt)" strokeWidth={2.5} strokeLinecap="round" />
          <circle cx={cx} cy={cy} r={6} fill="var(--txt)" />
        </>
      )}
    </svg>
  );
}

const HISTORY_CACHE_KEY = 'lhq_fng_history';
const HISTORY_CACHE_TTL = 6 * 60 * 60_000; // 6h - daily data, no need to refetch often

function useFngHistory(): number[] {
  const [points, setPoints] = useState<number[]>([]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(HISTORY_CACHE_KEY);
      if (raw) {
        const { ts, data } = JSON.parse(raw) as { ts: number; data: number[] };
        if (Date.now() - ts < HISTORY_CACHE_TTL && data.length) { setPoints(data); return; }
      }
    } catch {}
    let cancelled = false;
    fetch('/api/proxy?type=fng&?limit=30&format=json')
      .then(r => r.json())
      .then((d: { data?: { value: string }[] }) => {
        if (cancelled || !d.data) return;
        const vals = d.data.map(x => parseInt(x.value)).reverse(); // oldest -> newest
        setPoints(vals);
        try { localStorage.setItem(HISTORY_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: vals })); } catch {}
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return points;
}

function useBtcLongShort(): { long: number; short: number } | null {
  const [ratio, setRatio] = useState<{ long: number; short: number } | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/proxy?type=lsr-global&symbol=${BINANCE_SYMS.btc}&period=1h&limit=1`)
      .then(r => r.json())
      .then((data: Array<{ longAccount: string; shortAccount: string }>) => {
        if (cancelled || !Array.isArray(data) || !data[0]) return;
        setRatio({ long: parseFloat(data[0].longAccount), short: parseFloat(data[0].shortAccount) });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);
  return ratio;
}

/* ── Market Conditions - Fear & Greed gauge (existing .fng-* CSS, built but
   never wired to a component until now) + 30-day trend + Crypto RSI +
   BTC Long/Short positioning. All real data: alternative.me F&G, BTC RSI14
   from the market store, Binance global long/short account ratio (same
   endpoint already used on /liq). ── */
export default function MarketConditionsWidget() {
  const { t } = useLabels();
  const { store } = useMarket();
  const history = useFngHistory();
  const longShort = useBtcLongShort();

  const fng     = store.fng;
  const fngPrev = store.fngPrev;
  const rsi     = store.coins.btc?.rsi14 ?? null;

  const delta = fng != null && fngPrev != null ? fng - fngPrev : null;

  const rsiCol   = rsi == null ? 'var(--txt3)' : rsi >= 70 ? 'var(--red)' : rsi <= 30 ? 'var(--green-2)' : 'var(--amber)';
  const rsiLabel = rsi == null ? '-' : rsi >= 70 ? t('MARKET_CONDITIONS_WIDGET_RSI_OVERBOUGHT') : rsi <= 30 ? t('MARKET_CONDITIONS_WIDGET_RSI_OVERSOLD') : t('MARKET_CONDITIONS_WIDGET_RSI_NEUTRAL');

  return (
    <div className="av-rail-panel">
      <div style={{ marginBottom: 10 }}>
        <div className="av-rail-panel-h" style={{ marginBottom: 1 }}>{t('MARKET_CONDITIONS_WIDGET_TITLE')}</div>
        <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('MARKET_CONDITIONS_WIDGET_SUBTITLE')}</div>
      </div>

      {/* Fear & Greed */}
      <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 4 }}>
        {t('MARKET_CONDITIONS_WIDGET_FNG_LABEL')}
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <FngGauge value={fng} />
        <div>
          <div className={`fng-score ${fng != null && store.fngLabel ? fngScoreClass(store.fngLabel) : ''}`}>{fng ?? '-'}</div>
          <div className="fng-label" style={{ color: fng != null ? `var(--txt)` : 'var(--txt3)', marginBottom: 6 }}>{store.fngLabel || '-'}</div>
          {delta != null && delta !== 0 && (
            <span className={`fng-delta-pill ${delta > 0 ? 'fng-delta-up' : 'fng-delta-down'}`}>
              {delta > 0 ? '▲' : '▼'} {Math.abs(delta)}
            </span>
          )}
        </div>
      </div>

      {/* 30-day trend */}
      {history.length > 1 && (
        <div style={{ marginTop: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>{t('MARKET_CONDITIONS_WIDGET_TREND_LABEL')}</span>
          <Sparkline points={history} width={90} height={20} />
        </div>
      )}

      {/* Crypto RSI */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--bdr)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
          <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--txt3)' }}>
            {t('MARKET_CONDITIONS_WIDGET_RSI_LABEL')}
          </span>
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: rsiCol }}>
            {rsi != null ? rsi.toFixed(1) : '-'} {rsi != null && `· ${rsiLabel}`}
          </span>
        </div>
        <div style={{ height: 5, borderRadius: 3, background: 'var(--bg3)', position: 'relative', overflow: 'hidden' }}>
          {rsi != null && (
            <div style={{ position: 'absolute', inset: 0, width: `${Math.min(100, rsi)}%`, background: rsiCol, borderRadius: 3 }} />
          )}
        </div>
      </div>

      {/* BTC Long/Short */}
      <div style={{ marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--bdr)' }}>
        <div style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: 'var(--txt3)', marginBottom: 5 }}>
          {t('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL')}
        </div>
        {longShort ? (() => {
          const total = longShort.long + longShort.short;
          const longPct  = total > 0 ? (longShort.long / total) * 100 : 50;
          const shortPct = 100 - longPct;
          return (
            <>
              <div style={{ display: 'flex', height: 5, borderRadius: 3, overflow: 'hidden', marginBottom: 5 }}>
                {/* Was hardcoded Tailwind emerald-400/red-400 (#546 C9) - off
                    the terminal palette, and mismatched the labels below,
                    which already used the real tokens. */}
                <div style={{ width: `${longPct}%`, background: 'var(--green-2)' }} />
                <div style={{ width: `${shortPct}%`, background: 'var(--red)' }} />
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 'var(--fs-caption)' }}>
                <span style={{ color: 'var(--green-2)', fontWeight: 600 }}>{t('MARKET_CONDITIONS_WIDGET_LONG_PCT', { pct: longPct.toFixed(1) })}</span>
                <span style={{ color: 'var(--red)', fontWeight: 600 }}>{t('MARKET_CONDITIONS_WIDGET_SHORT_PCT', { pct: shortPct.toFixed(1) })}</span>
              </div>
            </>
          );
        })() : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }} role="status" aria-live="polite">
            <span className="sr-only">{t('MARKET_CONDITIONS_WIDGET_LOADING_SR')}</span>
            <SkeletonBar height={5} radius={3} />
            <SkeletonBar width="60%" height={11} radius={4} />
          </div>
        )}
      </div>
    </div>
  );
}
