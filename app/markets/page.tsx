'use client';
import { useState, useMemo, useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useMarket, COINS, COIN_DEC, fmtPrice, fmtVol, computeCoinHealth } from '@/lib/marketStore';
import type { CoinId, CoinData } from '@/lib/marketStore';
import { coinBadgeColor } from '@/lib/coinBadge';
import { withAlpha } from '@/lib/color';
import Sparkline24h from '@/components/Sparkline24h';
import Tip from '@/components/Tip';
import CoinIcon from '@/components/CoinIcon';
import { SkeletonBar } from '@/components/Skeleton';
import { useLabels } from '@/lib/labels';
import type { LabelKey } from '@/lib/labelKeys';
import { useSettings } from '@/lib/settings';
import {
  COLUMNS, FILTERS, DEFAULT_VISIBLE, gridTemplate, toggleColumn, pickableColumns,
  ROW_HEIGHT, type ColumnKey, type Filter,
} from '@/lib/marketsColumns';

const MAJORS: CoinId[] = ['btc', 'eth', 'sol', 'xrp', 'bnb'];
const PAGE_SIZE = 22;

const FILTER_LABELS: Record<Filter, LabelKey> = {
  all:       'MARKETS_FILTER_ALL',
  watchlist: 'MARKETS_FILTER_WATCHLIST',
  majors:    'MARKETS_FILTER_MAJORS',
  firing:    'MARKETS_FILTER_FIRING',
  gainers:   'MARKETS_FILTER_GAINERS',
};

function topSignal(d: CoinData | undefined): { key: LabelKey | null; col: string } {
  if (!d) return { key: null, col: 'var(--txt3)' };
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
  if (d.oiTrend === 'weak_down')   return { key: 'MARKETS_SIGNAL_LONGS_EXITING', col: 'var(--txt3)' };
  return { key: 'MARKETS_SIGNAL_NONE', col: 'var(--txt3)' };
}

function fmtFunding(rate: number | null | undefined): { txt: string; col: string } {
  if (rate == null) return { txt: '–', col: 'var(--txt3)' };
  const pct = rate * 100;
  const sign = pct >= 0 ? '+' : '';
  const col = pct >= 0.04 ? 'var(--red)' : pct <= -0.02 ? 'var(--green-2)' : 'var(--txt2)';
  return { txt: `${sign}${pct.toFixed(4)}%`, col };
}

function fmtOI1h(oiTrend: CoinData['oiTrend'] | undefined): { txt: string; col: string } {
  switch (oiTrend) {
    case 'strong_up':   return { txt: '▲▲', col: 'var(--green-2)' };
    case 'weak_up':     return { txt: '▲',  col: 'var(--green-soft)' };
    case 'strong_down': return { txt: '▼▼', col: 'var(--red)' };
    case 'weak_down':   return { txt: '▼',  col: 'var(--red-soft)' };
    default:            return { txt: '–',  col: 'var(--txt3)' };
  }
}

const GRADE_STYLE: Record<string, { bg: string; col: string }> = {
  A: { bg: 'rgba(52,211,153,0.12)',  col: 'var(--green-2)' },
  B: { bg: 'rgba(96,165,250,0.12)',  col: 'var(--accent-2)' },
  C: { bg: 'rgba(245,158,11,0.12)',  col: '#f59e0b' },
  D: { bg: 'rgba(248,113,113,0.12)', col: 'var(--red)' },
  F: { bg: 'rgba(239,68,68,0.12)',   col: 'var(--red)' },
};

export default function MarketsPage() {
  const { t } = useLabels();
  const { store, selectCoin } = useMarket();
  const { settings } = useSettings();
  const router = useRouter();
  const wsReady = store.wsStatus !== 'Connecting...';

  const [query, setQuery]         = useState('');
  const [filter, setFilter]       = useState<Filter>('all');
  const [visibleCols, setVisibleCols] = useState<ColumnKey[]>([...DEFAULT_VISIBLE]);
  const [showPicker, setShowPicker]   = useState(false);
  const [pageSize, setPageSize]   = useState(PAGE_SIZE);
  const pickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!showPicker) return;
    function onOutside(e: MouseEvent) {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setShowPicker(false);
      }
    }
    document.addEventListener('mousedown', onOutside);
    return () => document.removeEventListener('mousedown', onOutside);
  }, [showPicker]);

  const rows = useMemo(() => {
    const filtered = COINS.filter(id => {
      if (query && !id.toLowerCase().includes(query.toLowerCase())) return false;
      const d = store.coins[id];
      if (filter === 'watchlist') return settings.watchlist.includes(id);
      if (filter === 'majors')    return MAJORS.includes(id);
      if (filter === 'firing') {
        const sig = topSignal(d);
        return sig.col !== 'var(--txt3)';
      }
      if (filter === 'gainers') return (d?.change ?? 0) > 0;
      return true;
    });
    filtered.sort((a, b) => (store.coins[b]?.vol24 ?? 0) - (store.coins[a]?.vol24 ?? 0));
    return filtered;
  }, [store.coins, query, filter, settings.watchlist]);

  useEffect(() => { setPageSize(PAGE_SIZE); }, [query, filter]);

  const pageRows   = rows.slice(0, pageSize);
  const canLoadMore = pageSize < rows.length;
  const template   = gridTemplate(visibleCols);

  function goToArena(id: CoinId) {
    selectCoin(id);
    router.push(`/arena?coin=${id}`);
  }

  function cellVal(key: ColumnKey, id: CoinId, d: CoinData | undefined): React.ReactNode {
    const dec = COIN_DEC[id] ?? 2;
    switch (key) {
      case 'coin': {
        const col = coinBadgeColor(id);
        return (
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            <CoinIcon coin={id} size={16} color={col} bg={withAlpha(col, '20')} />
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--txt)', letterSpacing: '.02em' }}>
              {id.toUpperCase()}
            </span>
          </div>
        );
      }
      case 'price':
        return (
          <span className="mkt3-mono" style={{ fontSize: 12.5, fontWeight: 400, color: 'var(--txt)' }}>
            {d?.price ? '$' + fmtPrice(d.price, dec) : '–'}
          </span>
        );
      case 'change24h': {
        const chg = d?.change ?? null;
        if (chg == null) return <span style={{ color: 'var(--txt3)' }}>–</span>;
        const up = chg >= 0;
        return (
          <span className="mkt3-mono" style={{ fontSize: 12, fontWeight: 400, color: up ? 'var(--green-2)' : 'var(--red)' }}>
            {up ? '+' : ''}{chg.toFixed(2)}%
          </span>
        );
      }
      case 'funding8h': {
        const f = fmtFunding(d?.fundingRate);
        return <span className="mkt3-mono" style={{ fontSize: 12, fontWeight: 400, color: f.col }}>{f.txt}</span>;
      }
      case 'oi1h': {
        const o = fmtOI1h(d?.oiTrend);
        return <span className="mkt3-mono" style={{ fontSize: 12, fontWeight: 400, color: o.col }}>{o.txt}</span>;
      }
      case 'signal': {
        const sig = topSignal(d);
        return (
          <span style={{ fontSize: 12, fontWeight: 400, color: sig.col, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {sig.key ? t(sig.key) : '–'}
          </span>
        );
      }
      case 'change7d':
        return <span className="mkt3-mono" style={{ fontSize: 12, color: 'var(--txt3)' }}>–</span>;
      case 'volume': {
        const v = d?.vol24;
        return <span className="mkt3-mono" style={{ fontSize: 12, color: 'var(--txt2)' }}>{v ? fmtVol(v) : '–'}</span>;
      }
      case 'takerRatio': {
        const tbp = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : null;
        const col = tbp == null ? 'var(--txt3)' : tbp >= 55 ? 'var(--green-2)' : tbp <= 45 ? 'var(--red)' : 'var(--txt2)';
        return <span className="mkt3-mono" style={{ fontSize: 12, color: col }}>{tbp != null ? tbp + '%' : '–'}</span>;
      }
      case 'sparkline':
        return <Sparkline24h coin={id} width={80} height={24} />;
      case 'grade': {
        const h = computeCoinHealth(d);
        const gs = GRADE_STYLE[h.grade] ?? GRADE_STYLE.F;
        return (
          <span style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            width: 22, height: 22, borderRadius: 4,
            fontSize: 11, fontWeight: 800, fontFamily: 'var(--font-mono), monospace',
            background: gs.bg, color: gs.col,
          }}>
            {h.grade}
          </span>
        );
      }
      case 'oiChange': {
        const o = fmtOI1h(d?.oiTrend);
        return <span className="mkt3-mono" style={{ fontSize: 12, color: o.col }}>{o.txt}</span>;
      }
      default:
        return null;
    }
  }

  const picklist = pickableColumns();

  return (
    <>
      <style>{`
        .mkt3-mono { font-family: var(--font-mono), monospace; font-variant-numeric: tabular-nums; }
        .mkt3-header {
          position: sticky;
          top: calc(74px + var(--banner-h, 0px));
          z-index: 10;
          background: var(--bg);
          border-bottom: 0.5px solid var(--bdr);
          padding: 10px 17px 0;
        }
        .mkt3-titlerow {
          display: flex; align-items: center; gap: 12px; flex-wrap: wrap;
          padding-bottom: 10px;
        }
        .mkt3-titlegroup { display: flex; align-items: baseline; gap: 10px; }
        .mkt3-title { font-size: 13px; font-weight: 700; color: var(--txt); letter-spacing: .04em; text-transform: uppercase; }
        .mkt3-perpcount { font-size: 10px; font-weight: 400; color: var(--txt3); letter-spacing: .02em; font-family: var(--font-mono), monospace; }
        .mkt3-chips { display: flex; gap: 6px; padding-bottom: 10px; }
        .mkt3-chip {
          padding: 4px 10px; font-size: 10px; font-weight: 400; letter-spacing: .04em;
          text-transform: uppercase; border: 0.5px solid var(--bdr); border-radius: 4px;
          background: transparent; color: var(--txt3); cursor: pointer;
          font-family: var(--font-mono), monospace; transition: color .12s, border-color .12s, background .12s;
        }
        .mkt3-chip.active, .mkt3-chip:hover { border-color: var(--accent-bdr); color: var(--accent); background: var(--accent-bg); }
        .mkt3-search {
          flex: 1; min-width: 107px; max-width: 200px; height: 24px;
          background: var(--bg1); border: 0.5px solid var(--bdr2); border-radius: 4px;
          padding: 0 10px; font-size: 10px; color: var(--txt); outline: none;
          font-family: var(--font-mono), monospace; letter-spacing: .04em;
        }
        .mkt3-search::placeholder { color: var(--txt4); }
        /* Desktop-only / mobile-only visibility helpers */
        .mkt3-perp-mobile { display: none; }
        .mkt3-perp-desktop { display: inline; }
        .mkt3-desktop-col { display: block; }
        .mkt3-row-line1, .mkt3-row-line2 { display: none; }
        .mkt3-colhdr {
          position: sticky;
          top: calc(74px + var(--banner-h, 0px) + 72px);
          z-index: 9;
          background: var(--bg);
          display: grid;
          padding: 6px 17px;
          border-bottom: 0.5px solid var(--bdr);
        }
        .mkt3-colhdr-cell {
          font-family: var(--font-mono), monospace; font-size: 9px; font-weight: 600;
          letter-spacing: .1em; text-transform: uppercase; color: var(--txt3);
        }
        .mkt3-row {
          display: grid; align-items: center;
          padding: 0 17px; min-height: ${ROW_HEIGHT}px;
          border-bottom: 0.5px solid rgba(255,255,255,0.03);
          cursor: pointer; transition: background .1s;
        }
        .mkt3-row:hover { background: rgba(255,255,255,0.025); }
        .mkt3-arena-btn {
          padding: 4px 10px; font-size: 9px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; border: 0.5px solid var(--bdr); border-radius: 4px;
          background: transparent; color: var(--txt3); cursor: pointer;
          font-family: var(--font-mono), monospace; white-space: nowrap;
          transition: border-color .12s, color .12s, background .12s;
        }
        .mkt3-row:hover .mkt3-arena-btn { border-color: var(--accent-bdr); color: var(--accent); background: var(--accent-bg); }
        .mkt3-footer {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          padding: 12px 17px; font-family: var(--font-mono), monospace; font-size: 9px;
          color: var(--txt3); letter-spacing: .08em; text-transform: uppercase;
          border-top: 0.5px solid var(--bdr);
        }
        .mkt3-loadmore {
          padding: 5px 14px; font-size: 9px; font-weight: 600; letter-spacing: .1em;
          text-transform: uppercase; border: 0.5px solid var(--bdr); border-radius: 4px;
          background: transparent; color: var(--txt3); cursor: pointer;
          font-family: var(--font-mono), monospace;
          transition: border-color .12s, color .12s;
        }
        .mkt3-loadmore:hover { border-color: var(--accent-bdr); color: var(--accent); }
        .mkt3-picker-wrap { position: relative; flex-shrink: 0; }
        .mkt3-picker-btn {
          padding: 4px 10px; font-size: 9px; font-weight: 600; letter-spacing: .08em;
          text-transform: uppercase; border: 0.5px solid var(--bdr); border-radius: 4px;
          background: transparent; color: var(--txt3); cursor: pointer;
          font-family: var(--font-mono), monospace;
          transition: border-color .12s, color .12s;
        }
        .mkt3-picker-btn:hover, .mkt3-picker-btn.open { border-color: var(--bdr2); color: var(--txt2); }
        .mkt3-picker-panel {
          position: absolute; top: calc(100% + 4px); right: 0; z-index: 20;
          background: var(--bg1); border: 0.5px solid var(--bdr); border-radius: 6px;
          padding: 6px 0; min-width: 160px;
          box-shadow: 0 4px 16px rgba(0,0,0,.4);
        }
        .mkt3-picker-row {
          display: flex; align-items: center; gap: 8px; padding: 6px 12px;
          font-size: 11px; color: var(--txt2); cursor: pointer;
          transition: background .1s;
        }
        .mkt3-picker-row:hover { background: rgba(255,255,255,0.04); }
        .mkt3-picker-check {
          width: 14px; height: 14px; border-radius: 3px; flex-shrink: 0;
          border: 0.5px solid var(--bdr); background: transparent; display: flex;
          align-items: center; justify-content: center; font-size: 10px;
        }
        .mkt3-picker-check.on { border-color: var(--accent-bdr); background: var(--accent-bg); color: var(--accent); }
        /* Mobile: two-line rows */
        @media (max-width: 640px) {
          .mkt3-header { padding: 8px 12px 0; }
          .mkt3-titlerow { padding-bottom: 8px; }
          .mkt3-titlegroup { flex-direction: row; justify-content: space-between; width: 100%; }
          .mkt3-titlegroup-right { margin-left: auto; }
          .mkt3-chips { gap: 5px; flex-wrap: wrap; padding-bottom: 8px; }
          .mkt3-chip { padding: 3px 8px; font-size: 9px; }
          .mkt3-search, .mkt3-colhdr, .mkt3-picker-wrap { display: none; }
          .mkt3-desktop-col { display: none !important; }
          .mkt3-perp-desktop { display: none !important; }
          .mkt3-perp-mobile { display: inline !important; }
          .mkt3-row { display: flex !important; flex-direction: column; padding: 8px 12px; min-height: unset; gap: 0; }
          .mkt3-row-line1, .mkt3-row-line2 {
            display: flex; align-items: center; gap: 6px; width: 100%;
            min-height: 18px;
          }
          .mkt3-row-line2 { margin-top: 2px; }
          .mkt3-arena-btn { display: none; }
          .mkt3-footer { padding: 10px 12px; }
        }
      `}</style>

      {/* PAGE HEADER */}
      <div className="mkt3-header">
        <div className="mkt3-titlerow">
          <div className="mkt3-titlegroup">
            <span className="mkt3-title">{t('MARKETS_PAGE_TITLE')}</span>
            <span className="mkt3-perpcount mkt3-perp-desktop">
              {t('MARKETS_PERP_COUNT', { count: rows.length })}
            </span>
            <span className="mkt3-perpcount mkt3-perp-mobile">
              {t('MARKETS_PERP_COUNT_MOBILE', { count: rows.length })}
            </span>
          </div>
          <div style={{ display: 'flex', gap: 6, flex: 1, justifyContent: 'flex-end', flexWrap: 'wrap' as const }}>
            <input
              className="mkt3-search"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder={t('MARKETS_SEARCH_COIN')}
            />
          </div>
        </div>
        <div className="mkt3-chips">
          {FILTERS.map(f => (
            <button
              key={f}
              className={`mkt3-chip${filter === f ? ' active' : ''}`}
              onClick={() => setFilter(f)}
            >
              {t(FILTER_LABELS[f])}
            </button>
          ))}
        </div>
      </div>

      {/* COLUMN HEADERS */}
      <div
        className="mkt3-colhdr mkt3-mono"
        style={{ gridTemplateColumns: template }}
      >
        {visibleCols.map(key => {
          const col = COLUMNS.find(c => c.key === key);
          if (!col) return null;
          const isRight = col.align === 'right';
          const cell = (
            <div
              key={key}
              className="mkt3-colhdr-cell"
              style={{ textAlign: isRight ? 'right' : 'left' }}
            >
              {key === 'funding8h'
                ? <Tip width={280} text={t('MARKETS_FUNDING8H_TIP')}>{t('MARKETS_COL_FUNDING8H')}</Tip>
                : key === 'oi1h'
                ? <Tip width={280} text={t('MARKETS_OI1H_TIP')}>{t('MARKETS_COL_OI1H')}</Tip>
                : key === 'signal'
                ? <Tip width={280} text={t('MARKETS_SIGNAL_TIP')}>{col.label}</Tip>
                : col.label}
            </div>
          );
          return cell;
        })}
        {/* Column picker cell */}
        <div style={{ textAlign: 'right' }}>
          <div className="mkt3-picker-wrap" ref={pickerRef}>
            <button
              className={`mkt3-picker-btn${showPicker ? ' open' : ''}`}
              onClick={() => setShowPicker(v => !v)}
            >
              {t('MARKETS_COL_PICKER')}
            </button>
            {showPicker && (
              <div className="mkt3-picker-panel" role="listbox" aria-label="Column picker">
                {picklist.map(col => {
                  const on = visibleCols.includes(col.key);
                  return (
                    <div
                      key={col.key}
                      className="mkt3-picker-row"
                      role="option"
                      aria-selected={on}
                      onClick={() => setVisibleCols(v => toggleColumn(v, col.key))}
                    >
                      <span className={`mkt3-picker-check${on ? ' on' : ''}`}>{on ? '✓' : ''}</span>
                      {col.label}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* ROWS */}
      {!wsReady ? (
        <div role="status" aria-live="polite" style={{ padding: '8px 17px', display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span className="sr-only">{t('MARKETS_LOADING_SR')}</span>
          {Array.from({ length: 8 }).map((_, i) => (
            <SkeletonBar key={i} height={ROW_HEIGHT} radius={4} style={{ opacity: 1 - i * 0.08 }} />
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div style={{ padding: '32px 17px', textAlign: 'center', fontSize: 12, color: 'var(--txt3)', fontFamily: 'var(--font-mono), monospace' }}>
          {t('MARKETS_NO_MATCH', { query })}
        </div>
      ) : (
        pageRows.map(id => {
          const d = store.coins[id];
          const sig = topSignal(d);
          const funding = fmtFunding(d?.fundingRate);

          return (
            <div
              key={id}
              className="mkt3-row"
              style={{ gridTemplateColumns: template }}
              onClick={() => goToArena(id)}
            >
              {/* Desktop: one cell per visible column */}
              {visibleCols.map(key => {
                const col = COLUMNS.find(c => c.key === key);
                if (!col) return null;
                return (
                  <div
                    key={key}
                    style={{ textAlign: col.align === 'right' ? 'right' : 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: key === 'signal' ? 'nowrap' : undefined }}
                    className="mkt3-desktop-col"
                  >
                    {cellVal(key, id, d)}
                  </div>
                );
              })}

              {/* Action */}
              <div style={{ textAlign: 'right' }} className="mkt3-desktop-col">
                <button className="mkt3-arena-btn" onClick={e => { e.stopPropagation(); goToArena(id); }}>
                  {t('MARKETS_OPEN_ARENA')}
                </button>
              </div>

              {/* Mobile: two-line layout */}
              <div className="mkt3-row-line1">
                <CoinIcon coin={id} size={14} color={coinBadgeColor(id)} bg={withAlpha(coinBadgeColor(id), '20')} />
                <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.02em', fontFamily: 'var(--font-mono), monospace' }}>
                  {id.toUpperCase()}
                </span>
                {d?.price && (
                  <span style={{ fontSize: 12, fontWeight: 400, color: 'var(--txt2)', fontFamily: 'var(--font-mono), monospace' }}>
                    ${fmtPrice(d.price, COIN_DEC[id] ?? 2)}
                  </span>
                )}
                <span style={{ marginLeft: 'auto', fontSize: 12, fontWeight: 400, fontFamily: 'var(--font-mono), monospace', color: (d?.change ?? 0) >= 0 ? 'var(--green-2)' : 'var(--red)' }}>
                  {(d?.change ?? 0) >= 0 ? '+' : ''}{(d?.change ?? 0).toFixed(2)}%
                </span>
              </div>
              <div className="mkt3-row-line2">
                <span style={{ fontSize: 11, fontWeight: 400, color: sig.col, fontFamily: 'var(--font-mono), monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {sig.key ? t(sig.key) : '–'}
                </span>
                <span style={{ fontSize: 10.5, fontWeight: 400, color: funding.col, fontFamily: 'var(--font-mono), monospace', flexShrink: 0, marginLeft: 8 }}>
                  {funding.txt}
                </span>
              </div>
            </div>
          );
        })
      )}

      {/* FOOTER */}
      {rows.length > 0 && (
        <div className="mkt3-footer">
          <span>{t('MARKETS_SHOWING', { start: 1, end: pageRows.length, total: rows.length })}</span>
          {canLoadMore && (
            <button className="mkt3-loadmore" onClick={() => setPageSize(p => p + PAGE_SIZE)}>
              {t('MARKETS_LOAD_MORE')}
            </button>
          )}
        </div>
      )}
    </>
  );
}
