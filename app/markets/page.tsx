'use client';
import { useState, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useMarket, COINS, COIN_DEC, fmtPrice, computeCoinHealth, computeSqueezeScore } from '@/lib/marketStore';
import type { CoinId } from '@/lib/marketStore';

type SortKey = 'volume' | 'change' | 'grade' | 'signal' | 'name';

function topSignal(d: ReturnType<typeof useMarket>['store']['coins'][CoinId]): { text: string; col: string } {
  if (!d) return { text: '—', col: '#333' };
  if (d.fundingRate != null) {
    const fr = d.fundingRate * 100;
    if (fr >= 0.04) return { text: 'Longs overcrowded', col: '#f87171' };
    if (fr <= -0.02) return { text: 'Shorts squeezed', col: '#34d399' };
  }
  if (d.cvdDivergence === 'bullish') return { text: 'Smart buyers active', col: '#34d399' };
  if (d.cvdDivergence === 'bearish') return { text: 'Smart sellers active', col: '#f87171' };
  if (d.oiTrend === 'strong_up')   return { text: 'New buyers opening', col: '#34d399' };
  if (d.oiTrend === 'strong_down') return { text: 'New sellers opening', col: '#f87171' };
  if (d.oiTrend === 'weak_up')     return { text: 'Short covering', col: '#fbbf24' };
  if (d.oiTrend === 'weak_down')   return { text: 'Longs exiting', col: '#94a3b8' };
  return { text: 'No signal', col: '#333' };
}

const GRADE_ORDER: Record<string, number> = { A: 0, B: 1, C: 2, D: 3, F: 4, '—': 5 };

export default function MarketsPage() {
  const { store, selectCoin } = useMarket();
  const router = useRouter();
  const [query, setQuery]   = useState('');
  const [sort, setSort]     = useState<SortKey>('volume');
  const [sortAsc, setSortAsc] = useState(false);

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
        const sa = topSignal(da).col === '#34d399' ? 0 : topSignal(da).col === '#f87171' ? 2 : 1;
        const sb = topSignal(db).col === '#34d399' ? 0 : topSignal(db).col === '#f87171' ? 2 : 1;
        cmp = sa - sb;
      }
      return sortAsc ? cmp : -cmp;
    });
  }, [store.coins, query, sort, sortAsc]);

  const bullCount = COINS.filter(id => topSignal(store.coins[id]).col === '#34d399').length;
  const bearCount = COINS.filter(id => topSignal(store.coins[id]).col === '#f87171').length;

  function handleSort(key: SortKey) {
    if (sort === key) setSortAsc(v => !v);
    else { setSort(key); setSortAsc(false); }
  }

  function goToArena(id: string) {
    selectCoin(id);
    router.push('/arena');
  }

  const GRADE_STYLE: Record<string, { bg: string; col: string }> = {
    A: { bg: 'rgba(52,211,153,0.15)',  col: '#34d399' },
    B: { bg: 'rgba(96,165,250,0.15)',  col: '#60a5fa' },
    C: { bg: 'rgba(245,158,11,0.15)',  col: '#f59e0b' },
    D: { bg: 'rgba(248,113,113,0.15)', col: '#f87171' },
    F: { bg: 'rgba(239,68,68,0.15)',   col: '#ef4444' },
  };

  return (
    <>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Mono:wght@400;600;700&display=swap');
        .mkt-mono { font-family: 'IBM Plex Mono', monospace; }
        .mkt-row { transition: background 0.1s; }
        .mkt-row:hover { background: rgba(255,255,255,0.03) !important; }
        .mkt-sort-btn { transition: color 0.15s, border-color 0.15s, background 0.15s; }
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
              fontSize: 11, color: 'var(--txt3)', padding: '4px 10px',
              border: '0.5px solid var(--bdr)', borderRadius: 6,
              background: 'none', cursor: 'pointer', flexShrink: 0,
            }}
          >
            ← Back
          </button>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.04em', textTransform: 'uppercase' }}>
              Markets
            </div>
            <div style={{ fontSize: 9, color: 'var(--txt3)', marginTop: 1, letterSpacing: '.02em' }}>
              {COINS.length} coins live
            </div>
          </div>
          <div className="mkt-mono" style={{ marginLeft: 'auto', display: 'flex', gap: 14, fontSize: 10 }}>
            <span style={{ color: '#34d399' }}>▲ {bullCount} bullish</span>
            <span style={{ color: '#f87171' }}>▼ {bearCount} bearish</span>
            <span style={{ color: 'var(--txt3)' }}>— {COINS.length - bullCount - bearCount} neutral</span>
          </div>
        </div>

        {/* Search + Sort */}
        <div style={{ display: 'flex', gap: 8, marginBottom: 10, flexWrap: 'wrap' }}>
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search coins…"
            style={{
              flex: 1, minWidth: 120,
              background: 'var(--card)', border: '0.5px solid var(--bdr)',
              borderRadius: 8, padding: '7px 12px',
              fontSize: 12, color: 'var(--txt)', outline: 'none',
            }}
          />
          {(['volume', 'change', 'grade', 'signal', 'name'] as SortKey[]).map(key => (
            <button
              key={key}
              className="mkt-sort-btn"
              onClick={() => handleSort(key)}
              style={{
                padding: '6px 12px', fontSize: 11,
                border: `0.5px solid ${sort === key ? 'rgba(184,174,255,0.4)' : 'var(--bdr)'}`,
                borderRadius: 8,
                background: sort === key ? 'rgba(184,174,255,0.08)' : 'transparent',
                color: sort === key ? '#b8aeff' : 'var(--txt3)',
                cursor: 'pointer', textTransform: 'capitalize',
              }}
            >
              {key} {sort === key ? (sortAsc ? '↑' : '↓') : ''}
            </button>
          ))}
        </div>

        {/* Column headers */}
        <div className="mkt-mono" style={{
          display: 'grid',
          gridTemplateColumns: '28px 1fr 96px 58px 80px 1fr',
          padding: '0 10px 6px',
          fontSize: 9, fontWeight: 700, letterSpacing: '.1em',
          textTransform: 'uppercase', color: 'var(--txt3)',
          borderBottom: '0.5px solid var(--bdr)', marginBottom: 2,
        }}>
          <div />
          <div style={{ paddingLeft: 10 }}>Coin</div>
          <div style={{ textAlign: 'right' }}>Price</div>
          <div style={{ textAlign: 'right' }}>24h</div>
          <div style={{ paddingLeft: 4 }}>Pressure</div>
          <div style={{ paddingLeft: 12 }}>Signal</div>
        </div>

        {/* Rows */}
        {rows.map(id => {
          const d      = store.coins[id];
          const dec    = COIN_DEC[id] ?? 2;
          const chg    = d?.change ?? 0;
          const up     = chg >= 0;
          const health = computeCoinHealth(d);
          const sig    = topSignal(d);
          const tbp    = d?.takerBuyRatio != null ? Math.round(d.takerBuyRatio * 100) : 50;
          const gradeStyle = GRADE_STYLE[health.grade] ?? GRADE_STYLE.F;
          const barCol = tbp >= 55 ? '#34d399' : tbp <= 45 ? '#f87171' : '#555';

          return (
            <div
              key={id}
              className="mkt-row"
              onClick={() => goToArena(id)}
              style={{
                display: 'grid',
                gridTemplateColumns: '28px 1fr 96px 58px 80px 1fr',
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
                fontSize: 9, fontWeight: 800,
                background: gradeStyle.bg, color: gradeStyle.col,
                fontFamily: 'IBM Plex Mono, monospace',
              }}>
                {health.grade}
              </div>

              {/* Coin name */}
              <div style={{ paddingLeft: 10, fontSize: 12, fontWeight: 700, color: 'var(--txt)', letterSpacing: '.02em' }}>
                {id.toUpperCase()}
              </div>

              {/* Price */}
              <div className="mkt-mono" style={{ textAlign: 'right', fontSize: 12, fontWeight: 600, color: 'var(--txt2)' }}>
                {d?.price ? '$' + fmtPrice(d.price, dec) : '—'}
              </div>

              {/* Change */}
              <div className="mkt-mono" style={{
                textAlign: 'right', fontSize: 11, fontWeight: 700,
                color: up ? '#34d399' : '#f87171',
              }}>
                {up ? '+' : ''}{chg.toFixed(2)}%
              </div>

              {/* Pressure bar */}
              <div style={{ paddingLeft: 4, paddingRight: 8 }}>
                <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2 }}>
                  <div style={{ height: '100%', width: tbp + '%', background: barCol, borderRadius: 2, transition: 'width 0.5s' }} />
                </div>
                <div className="mkt-mono" style={{ fontSize: 8, color: 'var(--txt3)', marginTop: 2 }}>
                  {tbp}% buy
                </div>
              </div>

              {/* Signal */}
              <div style={{
                paddingLeft: 12, fontSize: 10,
                color: sig.col === '#333' ? 'var(--txt3)' : sig.col,
                whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
              }}>
                {sig.text}
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
          <div style={{ padding: '32px 10px', textAlign: 'center', fontSize: 12, color: 'var(--txt3)' }}>
            No coins match &ldquo;{query}&rdquo;
          </div>
        )}
      </div>
    </>
  );
}
