'use client';
import { useState, useRef } from 'react';
import { useMarket, COINS, CoinId, computeSqueezeScore } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

type TFDir = 'FLUSH' | 'SQUEEZE' | 'NEUTRAL';

interface TFSignal {
  dir: TFDir;
  strength: number;
  rsi: number | null;
}

function computeTFSignal(
  rsi: number | null,
  fr: number | null,
  longRatio: number | null,
  shortRatio: number | null,
): TFSignal {
  if (rsi == null) return { dir: 'NEUTRAL', strength: 0, rsi: null };

  let flushScore = 0;
  let sqzScore   = 0;
  let rsiFlush   = 0;
  let rsiSqz     = 0;

  // RSI is the primary per-timeframe signal - must contribute for a cell to be active
  if      (rsi >= 75) { rsiFlush = 55; }
  else if (rsi >= 70) { rsiFlush = 40; }
  else if (rsi >= 65) { rsiFlush = 22; }
  else if (rsi >= 60) { rsiFlush = 10; }
  else if (rsi <= 25) { rsiSqz   = 55; }
  else if (rsi <= 30) { rsiSqz   = 40; }
  else if (rsi <= 35) { rsiSqz   = 22; }
  else if (rsi <= 40) { rsiSqz   = 10; }

  flushScore += rsiFlush;
  sqzScore   += rsiSqz;

  // RSI must have contributed - FR and L/S only amplify an existing RSI signal
  if (rsiFlush === 0 && rsiSqz === 0) return { dir: 'NEUTRAL', strength: 0, rsi };

  // FR amplifies in the direction RSI already points
  if (fr != null) {
    const pct = fr * 100;
    if      (pct >= 0.05)   flushScore += 25;
    else if (pct >= 0.02)   flushScore += 15;
    else if (pct >= 0.01)   flushScore += 7;
    else if (pct <= -0.03)  sqzScore   += 25;
    else if (pct <= -0.015) sqzScore   += 15;
    else if (pct <= -0.005) sqzScore   += 7;
  }

  // L/S ratio amplifies in the direction RSI already points
  if (longRatio != null && shortRatio != null) {
    if      (longRatio  >= 0.65) flushScore += 20;
    else if (longRatio  >= 0.58) flushScore += 10;
    else if (shortRatio >= 0.65) sqzScore   += 20;
    else if (shortRatio >= 0.58) sqzScore   += 10;
  }

  const dominant = Math.max(flushScore, sqzScore);
  const dir: TFDir =
    flushScore > sqzScore ? 'FLUSH' :
    sqzScore > flushScore ? 'SQUEEZE' :
    'NEUTRAL';

  return { dir, strength: Math.min(100, dominant), rsi };
}

function cellColors(sig: TFSignal): { bg: string; text: string; border: string } {
  if (sig.dir === 'NEUTRAL') return { bg: 'transparent', text: 'var(--txt-dim)', border: 'transparent' };
  const isFlush = sig.dir === 'FLUSH';
  const base    = isFlush ? 'var(--red)' : 'var(--green-2)';
  /* #698: the TEXT takes the -fg variant, the tint keeps the base. Both used to
     be `base`, which is signal colour on a wash of itself - the shape #688 and
     #693 already answered on other screens.

     Measured, ground = the cell's own tint over --bg1, at the three alphas
     this ramp uses. THE ALPHAS ARE HEX BYTES, NOT PERCENTAGES - 0x28 is 15.7%,
     0x16 is 8.6%, 0x0c is 4.7%. Read as percent they give ratios about a factor
     of two out, turning a passing colour into a failing one; QA hit exactly that
     reviewing this and was one step from reporting dark green as broken. The
     unit belongs beside the number, like the ground beside a ratio:

                     dark                      light
         a   base -> -fg            base -> -fg
        0c   5.01    7.69           6.15    8.21     red
        16   4.80    7.36           5.76    7.68
        28   4.39    6.73           5.09    6.79     <- dark red failed here
        0c   6.77    6.77           4.81    6.49     green
        16   6.37    6.37           4.55    6.15
        28   5.63    5.63           4.12    5.57     <- light green fails here

     Dark green already passes and --green-fg aliases --green-2 there, so it is
     unchanged. LIGHT GREEN AT THE STRONGEST TINT IS 4.12 AND FAILS - that is
     not in QA's reopened count, which is dark only, so this fixes a failure
     nobody has measured yet rather than waiting for it to be reported. */
  const fg      = isFlush ? 'var(--red-fg)' : 'var(--green-fg)';
  const alpha   = sig.strength >= 70 ? '28' : sig.strength >= 40 ? '16' : '0c';
  return {
    bg:     withAlpha(base, alpha),
    text:   fg,
    border: withAlpha(base, '33'),
  };
}

const TF_LABEL_KEYS = [
  'MULTI_TF_SQUEEZE_VIEW_TF_15M',
  'MULTI_TF_SQUEEZE_VIEW_TF_1H',
  'MULTI_TF_SQUEEZE_VIEW_TF_4H',
  'MULTI_TF_SQUEEZE_VIEW_TF_1D',
] as const;

export default function MultiTFSqueezeView() {
  const { t } = useLabels();
  const { store } = useMarket();
  const [expanded, setExpanded] = useState(false);
  const [search, setSearch]     = useState('');
  const searchRef               = useRef<HTMLInputElement>(null);

  const rows = COINS.map(c => {
    const coin = store.coins[c];
    const fr   = coin?.fundingRate ?? null;
    const lr   = coin?.longRatio   ?? null;
    const sr   = coin?.shortRatio  ?? null;

    const tfs: TFSignal[] = [
      computeTFSignal(coin?.rsi14    ?? null, fr, lr, sr),
      computeTFSignal(coin?.rsi1h    ?? null, fr, lr, sr),
      computeTFSignal(coin?.rsi4h    ?? null, fr, lr, sr),
      computeTFSignal(coin?.rsiDaily ?? null, fr, lr, sr),
    ];

    const sq         = computeSqueezeScore(coin);
    const flushCount = tfs.filter(sig => sig.dir === 'FLUSH').length;
    const sqzCount   = tfs.filter(sig => sig.dir === 'SQUEEZE').length;
    const confluence = Math.max(flushCount, sqzCount); // 0-4 aligned TFs

    return { c, coin, tfs, sq, confluence, flushCount, sqzCount };
  }).sort((a, b) => {
    // Sort by highest confluence first, then by squeeze score
    if (b.confluence !== a.confluence) return b.confluence - a.confluence;
    return b.sq.score - a.sq.score;
  });

  const totalSqz   = rows.filter(r => r.sqzCount >= 2).length;
  const totalFlush = rows.filter(r => r.flushCount >= 2).length;

  return (
    <div style={{
      background: 'var(--bg1)', border: '0.5px solid var(--bdr)',
      borderRadius: 14, overflow: 'hidden', marginBottom: 12,
    }}>
      {/* Header */}
      <div style={{
        padding: '12px 14px 10px',
        borderBottom: '0.5px solid var(--bdr)',
        display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap',
      }}>
        <span style={{ fontSize: 'var(--fs-micro)', fontWeight: 700, color: 'var(--txt3)', letterSpacing: '.07em', textTransform: 'uppercase', flex: 1 }}>
          <Tip width={260} text={t('MULTI_TF_SQUEEZE_VIEW_TOOLTIP')}>{t('MULTI_TF_SQUEEZE_VIEW_TITLE')}</Tip>
        </span>
        {totalSqz > 0 && (
          <span style={{
            fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            color: 'var(--green-2)', background: 'rgba(52,211,153,0.1)', border: '0.5px solid rgba(52,211,153,0.25)',
          }}>{t('MULTI_TF_SQUEEZE_VIEW_SQUEEZE_BADGE', { count: totalSqz })}</span>
        )}
        {totalFlush > 0 && (
          <span style={{
            fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20,
            color: 'var(--red)', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.25)',
          }}>{t('MULTI_TF_SQUEEZE_VIEW_FLUSH_BADGE', { count: totalFlush })}</span>
        )}
      </div>

      {/* Column headers */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: '68px repeat(4, 1fr) 52px',
        padding: '5px 12px',
        borderBottom: '0.5px solid rgba(255,255,255,0.05)',
        background: 'rgba(255,255,255,0.02)',
      }}>
        <span style={hdrStyle}>{t('MULTI_TF_SQUEEZE_VIEW_COL_COIN')}</span>
        {TF_LABEL_KEYS.map(key => (
          <span key={key} style={{ ...hdrStyle, textAlign: 'center' }}>{t(key)}</span>
        ))}
        <span style={{ ...hdrStyle, textAlign: 'right' }}>{t('MULTI_TF_SQUEEZE_VIEW_COL_SQUEEZE')}</span>
      </div>

      {/* Search bar - visible only when expanded */}
      {expanded && (
        <div style={{ borderBottom: '0.5px solid rgba(255,255,255,0.06)', padding: '0 12px', display: 'flex', alignItems: 'center', gap: 6 }}>
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none" style={{ flexShrink: 0, opacity: 0.35 }}>
            <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.3"/>
            <line x1="8" y1="8" x2="11" y2="11" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round"/>
          </svg>
          <input
            ref={searchRef}
            type="text"
            placeholder={t('MULTI_TF_SQUEEZE_VIEW_SEARCH_PLACEHOLDER')}
            value={search}
            onChange={e => setSearch(e.target.value)}
            style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', padding: '8px 0', fontSize: 'var(--fs-caption)', color: 'var(--txt)' }}
          />
          {search && (
            <button onClick={() => setSearch('')} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: 'var(--txt3)', fontSize: '0.8125rem', lineHeight: 1 }} aria-label={t('MULTI_TF_SQUEEZE_VIEW_CLEAR_SEARCH_ARIA')}>×</button>
          )}
        </div>
      )}

      {/* Coin rows */}
      <div style={expanded ? { maxHeight: 320, overflowY: 'auto' } : {}}>
      {(() => {
        const displayRows = expanded
          ? (search ? rows.filter(r => r.c.toLowerCase().includes(search.toLowerCase())) : rows)
          : rows.slice(0, 5);
        return displayRows.length > 0 ? displayRows.map(({ c, tfs, sq, flushCount, sqzCount }) => {
        const dominantDir = sqzCount >= 2 ? 'SQUEEZE' : flushCount >= 2 ? 'FLUSH' : 'NEUTRAL';
        const rowActive   = dominantDir !== 'NEUTRAL';
        return (
          <div
            key={c}
            style={{
              display: 'grid',
              gridTemplateColumns: '68px repeat(4, 1fr) 52px',
              alignItems: 'center',
              padding: '5px 12px',
              borderBottom: '0.5px solid rgba(255,255,255,0.04)',
              background: rowActive
                ? (dominantDir === 'SQUEEZE' ? 'rgba(52,211,153,0.03)' : 'rgba(248,113,113,0.03)')
                : 'transparent',
            }}
          >
            {/* Coin name */}
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700,
              color: rowActive
                ? (dominantDir === 'SQUEEZE' ? 'var(--green-2)' : 'var(--red)')
                : 'var(--txt-dim)',
              letterSpacing: '.03em',
            }}>
              {c.toUpperCase()}
            </span>

            {/* TF cells */}
            {tfs.map((sig, i) => {
              const cols = cellColors(sig);
              const icon = sig.dir === 'FLUSH' ? '↓' : sig.dir === 'SQUEEZE' ? '↑' : '-';
              return (
                <div key={i} style={{ display: 'flex', justifyContent: 'center' }}>
                  <div style={{
                    display: 'inline-flex', alignItems: 'center', gap: 2,
                    padding: '2px 6px', borderRadius: 5,
                    background: cols.bg,
                    border: sig.dir !== 'NEUTRAL' ? `0.5px solid ${cols.border}` : 'none',
                    minWidth: 36, justifyContent: 'center',
                  }}>
                    <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, color: cols.text, letterSpacing: '.01em' }}>
                      {icon}
                    </span>
                    <span style={{
                      fontSize: 'var(--fs-caption)', fontWeight: 600, color: sig.rsi != null ? cols.text : 'var(--txt-dim)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {sig.rsi != null ? Math.round(sig.rsi) : '-'}
                    </span>
                  </div>
                </div>
              );
            })}

            {/* Global squeeze score */}
            <span style={{
              fontSize: 'var(--fs-caption)', fontWeight: 700, textAlign: 'right',
              color: sq.dir !== 'NEUTRAL' ? sq.color : 'var(--txt-dim)',
              fontVariantNumeric: 'tabular-nums',
            }}>
              {sq.score > 0 ? sq.score : '-'}
            </span>
          </div>
        );
        }) : <div style={{ padding: '10px 12px', fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('MULTI_TF_SQUEEZE_VIEW_NO_MATCH', { search })}</div>;
      })()}
      </div>

      {/* Show more toggle */}
      <button
        onClick={() => {
          setExpanded(v => {
            if (v) setSearch('');
            return !v;
          });
          if (!expanded) setTimeout(() => searchRef.current?.focus(), 60);
        }}
        aria-expanded={expanded}
        style={{
          width: '100%', padding: '9px 0', background: 'none', border: 'none',
          borderTop: '0.5px solid rgba(255,255,255,0.05)', cursor: 'pointer',
          fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', fontWeight: 600, letterSpacing: '.03em',
          transition: 'color 0.15s',
        }}
        onMouseEnter={e => (e.currentTarget.style.color = '#888')}
        onMouseLeave={e => (e.currentTarget.style.color = 'var(--txt-dim)')}
      >
        {expanded ? t('MULTI_TF_SQUEEZE_VIEW_SHOW_LESS') : t('MULTI_TF_SQUEEZE_VIEW_SHOW_ALL', { count: rows.length })}
      </button>

      {/* Footer legend */}
      <div style={{ padding: '6px 14px', borderTop: '0.5px solid rgba(255,255,255,0.05)', display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--green-2)' }}>{t('MULTI_TF_SQUEEZE_VIEW_LEGEND_SQUEEZE')}</span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>{t('MULTI_TF_SQUEEZE_VIEW_LEGEND_FLUSH')}</span>
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)' }}>{t('MULTI_TF_SQUEEZE_VIEW_LEGEND_FORMULA')}</span>
      </div>
    </div>
  );
}

const hdrStyle: React.CSSProperties = {
  fontSize: 'var(--fs-caption)', fontWeight: 600, letterSpacing: '.07em',
  textTransform: 'uppercase', color: 'var(--txt-dim)',
};
