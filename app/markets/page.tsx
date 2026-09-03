'use client';
import { useState, useMemo, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useDesignMode } from '@/components/DesignModeProvider';
import MarketsTerminal from '@/components/MarketsTerminal';
import { useMarket, COINS, COIN_DEC, fmtPrice, computeCoinHealth, computeSqueezeScore } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';
import { coinBadgeColor } from '@/lib/coinBadge';
import { withAlpha } from '@/lib/color';
import Sparkline24h from '@/components/Sparkline24h';
import Tip from '@/components/Tip';
import CoinIcon from '@/components/CoinIcon';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';

type SortKey = 'volume' | 'change' | 'grade' | 'signal' | 'name';

function topSignal(d: ReturnType<typeof useMarket>['store']['coins'][CoinId]): { key: LabelKey | null; col: string } {
  if (!d) return { key: null, col: 'var(--txt-dim)' };
  if (d.fundingRate != null) {
    const fr = d.fundingRate * 100;
    if (fr >= 0.04) return { key: 'MARKETS_SIGNAL_LONGS_OVERCROWDED', col: 'var(--red)' };
    if (fr <= -0.02) return { key: 'MARKETS_SIGNAL_SHORTS_SQUEEZED', col: 'var(--green-2)' };
  }
  if (d.cvdDivergence === 'bullish') return { key: 'MARKETS_SIGNAL_SMART_BUYERS', col: 'var(--green-2)' };
  if (d.cvdDivergence === 'bearish') return { key: 'MARKETS_SIGNAL_SMART_SELLERS', col: 'var(--red)' };
  if (d.oiTrend === 'strong_up')   return { key: 'MARKETS_SIGNAL_NEW_BUYERS', col: 'var(--green-2)' };
  if (d.oiTrend === 'strong_down') return { key: 'MARKETS_SIGNAL_NEW_SELLERS', col: 'var(--red)' };
  if (d.oiTrend === 'weak_up')     return { key: 'MARKETS_SIGNAL_SHORT_COVERING', col: 'var(--amber)' };
  if (d.oiTrend === 'weak_down')   return { key: 'MARKETS_SIGNAL_LONGS_EXITING', col: 'var(--txt-dim)' };
  return { key: 'MARKETS_SIGNAL_NONE', col: 'var(--txt-dim)' };
}

const SORT_LABEL_KEYS: Record<SortKey, LabelKey> = {
  volume: 'MARKETS_SORT_VOLUME', change: 'MARKETS_SORT_CHANGE', grade: 'MARKETS_SORT_GRADE',
  signal: 'MARKETS_SORT_SIGNAL', name: 'MARKETS_SORT_NAME',
};

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4, '-': 5 };
const PAGE_SIZE = 20;
const ROW_COLS = '48px 1fr 40px 96px 58px 92px 1fr';

export default function MarketsPage() {
  const mode = useDesignMode();
  const { t } = useLabels();
  const { store, selectCoin } = useMarket();
  const router = useRouter();
  // MarketProvider starts every coin at its zeroed defaultStore shape and fills
  // in over the WS connection - store.wsStatus flips 'Connecting...' -> 'Live'
  // once real data has arrived. This page never checked it, so it rendered the
  // full table instantly with blank/zero placeholder values and no loading
  // indicator at all.
  const wsReady = store.wsStatus !== 'Connecting...';
  const [query, setQuery]   = useState('');
  const [sort, setSort]     = useState<SortKey>('volume');
  const [sortAsc, setSortAsc] = useState(false);
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const filtered = COINS.filter(id => id.toLowerCase().includes(query.toLowerCase()));
    return filtered.sort((a, b) => {
      const da = store.coins[a];
      const db = store.coins[b];
      let cmp = 0;
      if (sort === 'volume') cmp = (da?.vol24 ?? 0) - (db?.vol24 ?? 0);
      if (sort === 'name')   cmp = a.localeCompare(b);
      if (sort === 'change') cmp = (da?.change ?? 0) - (db?.change ?? 0);
      if (sort === 'grade') {
        const ga = computeCoinHealth(da).grade;
        const gb = computeCoinHealth(db).grade;
        cmp = (GRADE_ORDER[ga] ?? 5) - (GRADE_ORDER[gb] ?? 5);
      }
      if (sort === 'signal') {
        const sa = topSignal(da).col === 'var(--green-2)' ? 0 : topSignal(da).col === 'var(--red)' ? 2 : 1;
        const sb = topSignal(db).col === 'var(--green-2)' ? 0 : topSignal(db).col === 'var(--red)' ? 2 : 1;
        cmp = sa - sb;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [store.coins, query, sort, sortAsc]);

  // Reset to page 1 whenever the result set changes shape
  useEffect(() => { setPage(0); }, [query, sort, sortAsc]);

  if (mode === 'terminal') return <MarketsTerminal />;

  const pageCount = Math.max(1, Math.ceil(rows.length / PAGE_SIZE));
  const pageSafe  = Math.min(page, pageCount - 1);
  const pageRows  = rows.slice(pageSafe * PAGE_SIZE, pageSafe * PAGE_SIZE + PAGE_SIZE);
  const rangeStart = rows.length === 0 ? 0 : pageSafe * PAGE_SIZE + 1;
  const rangeEnd   = Math.min(rows.length, pageSafe * PAGE_SIZE + PAGE_SIZE);

  const bullCount = COINS.filter(id => topSignal(store.coins[id]).col === 'var(--green-2)').length;
  const bearCount = COINS.filter(id => topSignal(store.coins[id]).col === 'var(--red)').length;

  function handleSort(key: SortKey) {
    if (sort === key) setSortAsc(v => !v);
    else { setSort(key); setSortAsc(false); }
  }

  function goToArena(id: CoinId) {
    selectCoin(id);
    // Arena reads its initial coin from the ?coin= URL param at mount, not from
    // the shared store (see app/arena/page.tsx's selectedCoin useState) - the
    // selectCoin() call above alone was a no-op for this navigation, so every
    // row click landed on Arena's default (BTC) regardless of which coin was
    // clicked. Pass it in the URL, same pattern the rest of the app uses.
    router.push(`/arena?coin=${id}`);
  }

  const GRADE_STYLE: Record<string, { bg: string; col: string }> = {
    A: { bg: 'rgba(52,211,153,0.15)',  col: 'var(--green-2)' },
    B: { bg: 'rgba(96,165,250,0.15)',  col: 'var(--accent-2)' },
    C: { bg: 'rgba(245,158,11,0.15)',  col: 'var(--amber)' },
    D: { bg: 'rgba(248,113,113,0.15)', col: 'var(--red)' },
    F: { bg: 'rgba(239,68,68,0.15)',   col: 'var(--red)' },
  };

  return (
    <>
      <style>{`
        .mkt-mono { font-family: var(--font-mono), monospace; }
        .mkt-row { transition: background 0.1s; }
        .mkt-row:hover { background: rgba(255,255,255,0.03) !important; }
        .mkt-sort-btn { transition: color 0.15s, border-color 0.15s, background 0.15s; }
        .mkt-page-btn { transition: color 0.15s, border-color 0.15s, background 0.15s; }
      `}</style>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 12px 80px' }}>

        {/* Header */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 10,
          padding: '12px 0 10px',
          borderBottom: '0.5px solid var(--bdr)',
          marginBottom: 12, position: 'sticky', top: 52,
          background: 'var(--bg)', zIndex: 10,
        }}>
          <button
            onClick={() => router.back()}
            style={{
              fontSize: 'var(--fs-caption)', color: 'var(--txt3)', padding: '4px 10px',
              border: '0.5px solid var(--bdr)', borderRadius: 6,
              background: 'none', cursor: 'pointer', flexShrink: 0,
            }}
          >
            {t('MARKETS_BACK_BUTTON')}
          </button>
          <div>
            <div style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              {t('MARKETS_PAGE_TITLE')}
            </div>
            <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 1, letterSpacing: '.02em' }}>
              {t('MARKETS_COINS_LIVE_SUFFIX', { count: COINS.length })}
            </div>
          </div>
          <div className="mkt-mono" style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 'var(--fs-caption)' }}>
            <span style={{ color: 'var(--green-2)' }}>{t('MARKETS_BULLISH_COUNT', { count: bullCount })}</span>
            <span style={{ color: 'var(--red)' }}>{t('MARKETS_BEARISH_COUNT', { count: bearCount })}</span>
            <span style={{ color: 'var(--txt3)' }}>{t('MARKETS_NEUTRAL_COUNT', { count: COINS.length - bullCount - bearCount })}</span>
          </div>
        </div>

        {/* Search + Sort */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder={t('MARKETS_SEARCH_PLACEHOLDER')}
            style={{
              flex: 1, minWidth: 120,
              background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
              borderRadius: 8, padding: '7px 12px',
              fontSize: 'var(--fs-caption)', color: 'var(--txt)', outline: 'none',
            }}
          />
          {(['volume', 'change', 'grade', 'signal', 'name'] as SortKey[]).map(key => (
            <button
              key={key}
              className="mkt-sort-btn"
              onClick={() => handleSort(key)}
              style={{
                padding: '6px 12px', fontSize: 'var(--fs-caption)',
                border: `0.5px solid ${sort === key ? 'var(--accent-bdr)' : 'var(--bdr)'}`,
                borderRadius: 8,
                background: sort === key ? 'var(--accent-bg)' : 'transparent',
                color: sort === key ? 'var(--accent-2)' : 'var(--txt3)',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {t(SORT_LABEL_KEYS[key])} {sort === key ? (sortAsc ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>

        {/* Column headers */}
        <div className="mkt-mono mkt-hdr-row" style={{
          display: 'grid',
          gridTemplateColumns: ROW_COLS,
          padding: '0 10px 6px',
          fontSize: 'var(--fs-micro)', fontWeight: 700, letterSpacing: '.1em',
          textTransform: 'uppercase', color: 'var(--txt3)',
          borderBottom: '0.5px solid var(--bdr)', marginBottom: 2,
        }}>
          <div>
            <Tip width={250} text={t('MARKETS_GRADE_TIP')}>{t('MARKETS_GRADE_COL_LABEL')}</Tip>
          </div>
          <div style={{ paddingLeft: 10 }}>{t('MARKETS_COIN_COL_LABEL')}</div>
          <div className="mkt-col-spark" />
          <div style={{ textAlign: 'right' }}>{t('MARKETS_PRICE_COL_LABEL')}</div>
          <div style={{ textAlign: 'right' }}>{t('MARKETS_24H_COL_LABEL')}</div>
          <div className="mkt-col-pressure" style={{ paddingLeft: 16 }}>
            <Tip width={250} text={t('MARKETS_PRESSURE_TIP')}>{t('MARKETS_PRESSURE_COL_LABEL')}</Tip>
          </div>
          <div style={{ paddingLeft: 12 }}>
            <Tip width={250} text={t('MARKETS_SIGNAL_TIP')}>{t('MARKETS_SIGNAL_COL_LABEL')}</Tip>
          </div>
        </div>

        {/* Rows */}
        {!wsReady ? (
          <div role="status" aria-live="polite" style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '8px 10px' }}>
            <span className="sr-only">{t('MARKETS_LOADING_SR')}</span>
            {Array.from({ length: 10 }).map((_, i) => (
              <SkeletonBar key={i} height={40} radius={8} style={{ opacity: 1 - i * 0.06 }} />
            ))}
          </div>
        ) : pageRows.map(id => {
          const d      = store.coins[id];
          const dec    = COIN_DEC[id] ?? 2;
          const chg    = d?.change ?? 0;
          const up     = chg >= 0;
          const health = computeCoinHealth(d);
          const sig    = topSignal(d);
          const tbp    = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : 50;
          const gradeStyle = GRADE_STYLE[health.grade] ?? GRADE_STYLE.F;
          const barCol = tbp >= 55 ? 'var(--green-2)' : tbp <= 45 ? 'var(--red)' : '#555';
          const badgeCol = coinBadgeColor(id);

          return (
            <div
              key={id}
              className="mkt-row"
              onClick={() => goToArena(id)}
              style={{
                display: 'grid',
                gridTemplateColumns: ROW_COLS,
                alignItems: 'center',
                padding: '8px 10px',
                borderBottom: '0.5px solid rgba(255,255,255,0.03)',
                cursor: 'pointer',
                position: 'relative',
              }}
            >
              {/* Grade */}
              <div style={{
                width: 22, height: 22, borderRadius: 5,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 'var(--fs-caption)', fontWeight: 800,
                background: gradeStyle.bg, color: gradeStyle.col,
                fontFamily: 'var(--font-mono), monospace',
              }}>
                {health.grade}
              </div>

              {/* Coin badge + name */}
              <div style={{ paddingLeft: 10, display: 'flex', alignItems: 'center', gap: 7, minWidth: 0 }}>
                <CoinIcon coin={id} size={18} color={badgeCol} bg={withAlpha(badgeCol, '24')} />
                <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: 'var(--txt)', letterSpacing: '.02em' }}>
                  {id.toUpperCase()}
                </span>
              </div>

              {/* Sparkline */}
              <div className="mkt-col-spark" style={{ display: 'flex', justifyContent: 'center' }}>
                <Sparkline24h coin={id} width={34} height={14} />
              </div>

              {/* Price */}
              <div className="mkt-mono" style={{ textAlign: 'right', fontSize: 'var(--fs-caption)', fontWeight: 600, color: 'var(--txt2)' }}>
                {d?.price ? '$' + fmtPrice(d.price, dec) : '-'}
              </div>

              {/* Change */}
              <div className="mkt-mono" style={{
                textAlign: 'right', fontSize: 'var(--fs-caption)', fontWeight: 700,
                color: up ? 'var(--green-2)' : 'var(--red)',
              }}>
                {up ? '+' : ''}{chg.toFixed(2)}%
              </div>

              {/* Pressure bar */}
              <div className="mkt-col-pressure" style={{ paddingLeft: 16, paddingRight: 8 }}>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: tbp + '%', background: barCol, borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
                <div className="mkt-mono" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)', marginTop: 2 }}>
                  {t('MARKETS_BUY_PCT_SUFFIX', { pct: tbp })}
                </div>
              </div>

              {/* Signal */}
              <div className="mkt-signal" style={{
                paddingLeft: 12, fontSize: 'var(--fs-caption)',
                color: sig.col === 'var(--txt-dim)' ? 'var(--txt3)' : sig.col,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {sig.key ? t(sig.key) : '-'}
              </div>

              {/* Bottom accent line = buy pressure */}
              <div style={{
                position: 'absolute', bottom: 0, left: 0,
                width: tbp + '%', height: 1,
                background: barCol, opacity: 0.2,
              }} />
            </div>
          );
        })}

        {rows.length === 0 && (
          <div style={{ padding: '32px 10px', textAlign: 'center', fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
            {t('MARKETS_NO_MATCH', { query })}
          </div>
        )}

        {/* Pagination */}
        {rows.length > 0 && (
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            gap: 10, flexWrap: 'wrap', padding: '14px 10px 0', marginTop: 4,
            borderTop: '0.5px solid var(--bdr)',
          }}>
            <span className="mkt-mono" style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt3)' }}>
              {t('MARKETS_RANGE_OF', { start: rangeStart, end: rangeEnd, total: rows.length })}
            </span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <button
                className="mkt-page-btn"
                onClick={() => setPage(p => Math.max(0, p - 1))}
                disabled={pageSafe === 0}
                style={{
                  padding: '5px 10px', fontSize: 'var(--fs-caption)', borderRadius: 6,
                  border: '0.5px solid var(--bdr)', background: 'transparent',
                  color: pageSafe === 0 ? 'var(--txt3)' : 'var(--txt2)',
                  cursor: pageSafe === 0 ? 'default' : 'pointer', opacity: pageSafe === 0 ? 0.4 : 1,
                }}
              >
                {t('MARKETS_PREV_BUTTON')}
              </button>
              {Array.from({ length: pageCount }, (_, i) => i).map(i => (
                <button
                  key={i}
                  className="mkt-page-btn"
                  onClick={() => setPage(i)}
                  style={{
                    width: 26, height: 26, fontSize: 'var(--fs-caption)', fontWeight: 700, borderRadius: 6,
                    border: `0.5px solid ${i === pageSafe ? 'var(--accent-bdr)' : 'var(--bdr)'}`,
                    background: i === pageSafe ? 'var(--accent)' : 'transparent',
                    color: i === pageSafe ? '#fff' : 'var(--txt3)',
                    cursor: 'pointer',
                  }}
                >
                  {i + 1}
                </button>
              ))}
              <button
                className="mkt-page-btn"
                onClick={() => setPage(p => Math.min(pageCount - 1, p + 1))}
                disabled={pageSafe >= pageCount - 1}
                style={{
                  padding: '5px 10px', fontSize: 'var(--fs-caption)', borderRadius: 6,
                  border: '0.5px solid var(--bdr)', background: 'transparent',
                  color: pageSafe >= pageCount - 1 ? 'var(--txt3)' : 'var(--txt2)',
                  cursor: pageSafe >= pageCount - 1 ? 'default' : 'pointer', opacity: pageSafe >= pageCount - 1 ? 0.4 : 1,
                }}
              >
                {t('MARKETS_NEXT_BUTTON')}
              </button>
            </div>
          </div>
        )}
      </div>
    </>
  );
}
