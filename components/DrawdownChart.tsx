'use client';
import { deadlineSignal } from '@/lib/deadlineSignal';
import { useEffect, useState } from 'react';
import { useMarket, COINS, CoinId } from '@/lib/marketStore';
import Tip from '@/components/Tip';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';

interface AthEntry {
  ath: number;
  athDate: string;
  /** Absent when /api/ath is serving its persisted cold-cache fallback, which carries the ATH but
   *  not a percentage computed against a price from hours ago - see that route's header. */
  drawdownPct?: number;
}

function drawdownColor(pct: number): string {
  const abs = Math.abs(pct);
  if (abs >= 80) return 'var(--red)';
  if (abs >= 60) return 'var(--red)';
  if (abs >= 40) return 'var(--orange)';
  if (abs >= 20) return 'var(--amber)';
  return 'var(--green-2)';
}

function fmtDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  } catch {
    return '-';
  }
}

function fmtPrice(p: number): string {
  if (p >= 1000)  return '$' + p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return '$' + p.toFixed(2);
  if (p >= 0.01)  return '$' + p.toFixed(4);
  return '$' + p.toFixed(7);
}

/* /api/ath covers 17 coins (CG_IDS in app/api/ath/route.ts), and every one of
   them ends up as a row here, so the loading skeleton renders the same count.
   Kept as a constant rather than inlined so the link between the two is
   visible: if that map grows, this follows. */
const SKELETON_ROWS = 17;

/* THE LAST GOOD ATH MAP IS KEPT IN THE BROWSER (failure-text audit A9). An all-time high ages well, so a stored copy is still true after a reload while /api/ath is down.
   Only the ATH and its date are stored: the route's `drawdownPct` is measured against a price from the moment it was fetched, so a stored one would be wrong, and the drawdown is recomputed from the live price instead (see `rows`). */
const ATH_CACHE_KEY = 'lhq.ath.cache.v1';
/* Waits before each retry after a failed read, in ms. After the last one the card is left out until the page is opened again. */
const ATH_RETRY_MS = [4_000, 12_000, 30_000, 60_000];

function readAthCache(): Record<string, AthEntry> | null {
  try {
    const raw = localStorage.getItem(ATH_CACHE_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw) as { data?: Record<string, AthEntry> } | null;
    return j && j.data && typeof j.data === 'object' ? j.data : null;
  } catch { return null; }
}

function writeAthCache(data: Record<string, AthEntry>) {
  try {
    const slim: Record<string, AthEntry> = {};
    for (const [k, v] of Object.entries(data)) {
      if (v && typeof v.ath === 'number') slim[k] = { ath: v.ath, athDate: v.athDate };
    }
    localStorage.setItem(ATH_CACHE_KEY, JSON.stringify({ ts: Date.now(), data: slim }));
  } catch { /* storage blocked or full: the card still works without it */ }
}

export default function DrawdownChart() {
  const { t } = useLabels();
  const { store } = useMarket();
  const [ath, setAth] = useState<Record<string, AthEntry> | null>(null);
  /* True once every retry has failed. It only matters while there is nothing to show: a stored or earlier copy keeps the card on screen. */
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const cached = readAthCache();
    if (cached) setAth(cached);
    const attempt = (n: number) => {
      fetch('/api/ath', { signal: deadlineSignal(20_000) })
        .then(r => r.ok ? r.json() : Promise.reject(new Error(String(r.status))))
        .then((data: Record<string, AthEntry>) => {
          if (cancelled) return;
          setAth(data);
          setFailed(false);
          writeAthCache(data);
        })
        .catch(() => {
          if (cancelled) return;
          if (n < ATH_RETRY_MS.length) { timer = setTimeout(() => attempt(n + 1), ATH_RETRY_MS[n]); return; }
          setFailed(true);
        });
    };
    attempt(0);
    return () => { cancelled = true; if (timer) clearTimeout(timer); };
  }, []);

  /* DRAWDOWN FROM OUR OWN PRICE WHEN THE ROUTE DID NOT SEND ONE (#1651).
   *
   * `/api/ath` omits `drawdownPct` when it is serving the persisted fallback after a cold cache,
   * because CoinGecko's percentage is computed against CoinGecko's price at ITS fetch time and a
   * stale copy of it is wrong rather than old. The ATH itself is a running maximum and ages well,
   * so the percentage is recomputed here from the live socket price. Verified against CoinGecko on
   * 8 coins, 2026-11-06: this reproduces their `ath_change_percentage` to within 0.006pp.
   *
   * THE SUPERSEDED CHECK. A stale ATH can only ever be too LOW, so if the live price is above it
   * the stored value is provably out of date - and the resulting "drawdown" would be POSITIVE,
   * drawn as a coin sitting at its peak when the truth is that we do not know its peak. That coin
   * is dropped (null, which the filter below already removes) rather than drawn, so the fallback
   * detects its own staleness from the price without needing to reason about the row's age. */
  const rows = COINS
    .map(c => {
      const entry    = ath?.[c];
      const curPrice = store.coins[c]?.price ?? null;
      const athPrice = entry?.ath ?? null;
      const drawdown = entry?.drawdownPct != null
        ? entry.drawdownPct
        : (athPrice != null && athPrice > 0 && curPrice != null && curPrice <= athPrice)
          ? (curPrice - athPrice) / athPrice * 100
          : null;
      return { c, curPrice, drawdown, ath: athPrice, athDate: entry?.athDate ?? null };
    })
    .filter(r => r.drawdown != null)
    .sort((a, b) => (a.drawdown ?? 0) - (b.drawdown ?? 0)); // most drawdown first

  const nearAth = rows.filter(r => Math.abs(r.drawdown!) < 20).length;

  /* Nothing to draw is never failure text. Still waiting on a price: the skeleton. Prices settled (or failed) and no row, or the ATH read failed with no stored copy: the card is left out (failure-text audit A9, A10). */
  const pricesPending = !store.pricesFailed && !COINS.some(c => store.coins[c]?.price != null);
  const showSkeleton = (!ath && !failed) || (ath != null && rows.length === 0 && pricesPending);
  if ((failed && !ath) || (ath != null && rows.length === 0 && !pricesPending)) return null;

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px', borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          <Tip text={t('DRAWDOWN_CHART_TOOLTIP')}>{t('DRAWDOWN_CHART_TITLE')}</Tip>
        </span>
        {nearAth > 0 && (
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: 'var(--green-2)', background: 'rgba(52,211,153,0.1)', border: '0.5px solid rgba(52,211,153,0.25)' }}>
            {t('DRAWDOWN_CHART_NEAR_ATH_BADGE', { count: nearAth })}
          </span>
        )}
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('DRAWDOWN_CHART_SOURCE')}</span>
      </div>

      {/* Loading / error states */}
      {showSkeleton && (
        /* One skeleton row per coin this card will actually show, shaped like a
           real row (label line + bar). Five generic bars reserved ~120px where
           the loaded card needs ~650, so the card grew by 454px the moment the
           data landed and shoved everything below it down the page - the
           single largest card-growth on /scanner. A skeleton that does not
           match the shape it is standing in for is decoration, not a
           placeholder. */
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 7 }} role="status" aria-live="polite">
          <span className="sr-only">{t('DRAWDOWN_CHART_LOADING_SR')}</span>
          {Array.from({ length: SKELETON_ROWS }).map((_, i) => (
            <div key={i} style={{ display: 'flex', flexDirection: 'column', gap: 3, opacity: Math.max(0.25, 1 - i * 0.05) }}>
              <SkeletonBar width="45%" height={11} radius={4} />
              <SkeletonBar height={10} radius={4} />
            </div>
          ))}
        </div>
      )}

      {/* Bar chart rows */}

      {ath && rows.length > 0 && (
        <div style={{ padding: '10px 14px 12px', display: 'flex', flexDirection: 'column', gap: 7 }}>
          {rows.map(({ c, curPrice, drawdown, ath: athPrice, athDate }) => {
            const absDd  = Math.abs(drawdown!);
            const barPct = Math.min(100, absDd);
            const col    = drawdownColor(drawdown!);
            const isNear = absDd < 20;
            return (
              <div key={c}>
                {/* Coin label + values */}
                <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, marginBottom: 3 }}>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: isNear ? 'var(--green-2)' : 'var(--txt)', width: 40, flexShrink: 0 }}>
                    {c.toUpperCase()}
                  </span>
                  <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: col, fontVariantNumeric: 'tabular-nums', minWidth: 52 }}>
                    {drawdown!.toFixed(1)}%
                  </span>
                  {curPrice != null && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {fmtPrice(curPrice)}
                    </span>
                  )}
                  {athPrice != null && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', fontVariantNumeric: 'tabular-nums' }}>
                      {t('DRAWDOWN_CHART_ATH_PRICE', { price: fmtPrice(athPrice) })}
                    </span>
                  )}
                  {athDate && (
                    <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', marginLeft: 'auto' }}>
                      {fmtDate(athDate)}
                    </span>
                  )}
                </div>
                {/* Bar */}
                <div style={{ height: 5, borderRadius: 99, background: 'rgba(255,255,255,0.05)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%', borderRadius: 99,
                    width: barPct + '%',
                    background: col,
                    transition: 'width .5s ease',
                  }} />
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div style={{ padding: '5px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)', display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        {([
          { labelKey: 'DRAWDOWN_CHART_LEGEND_UNDER_20', col: 'var(--green-2)' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_20_40', col: 'var(--amber)' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_40_60', col: 'var(--orange)' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_60_80', col: 'var(--red)' },
          { labelKey: 'DRAWDOWN_CHART_LEGEND_OVER_80', col: 'var(--red)' },
        ] as const).map(({ labelKey, col }) => (
          <span key={labelKey} style={{ fontSize: 'var(--fs-caption)', color: col, fontWeight: 600 }}>{t(labelKey)}</span>
        ))}
      </div>
    </div>
  );
}
