'use client';
import { useState, useEffect } from 'react';
import { useMarket, COINS, CoinId } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';
import Tip from '@/components/Tip';
import { useLabels } from '@/lib/labels';

/* How often the heatmap re-ranks itself. See the effect in the component. */
const RERANK_MS = 60_000;
/* If a feed never reports, rank anyway rather than sitting in declared order. */
const FIRST_RANK_TIMEOUT_MS = 12_000;

type Cat = 'all' | 'majors' | 'alts' | 'defi' | 'meme';

const CAT: Record<Cat, readonly CoinId[]> = {
  all:    COINS,
  majors: ['btc', 'eth', 'sol', 'xrp', 'bnb', 'ltc', 'bch', 'ada'],
  alts:   ['near', 'sui', 'avax', 'link', 'dot', 'atom', 'arb', 'op', 'apt', 'sei', 'inj', 'tia', 'trx', 'xlm', 'etc', 'fil', 'stx'],
  defi:   ['hype', 'aave', 'uni', 'ldo', 'rune', 'gmx', 'crv', 'jup', 'wld', 'render', 'tao', 'fet', 'ondo', 'pyth', 'ena', 'dydx', 'xau', 'spx'],
  meme:   ['doge', 'pepe', 'wif', 'bonk', 'gmt', 'sand', 'mana'],
};

function changeColor(chg: number | null): { bg: string; text: string } {
  if (chg == null) return { bg: 'rgba(255,255,255,0.04)', text: '#444' };
  if (chg >=  10) return { bg: 'rgba(52,211,153,0.30)',  text: '#34d399' };
  if (chg >=   5) return { bg: 'rgba(52,211,153,0.22)',  text: '#6ee7b7' };
  if (chg >=   2) return { bg: 'rgba(52,211,153,0.13)',  text: '#86efac' };
  if (chg >=   0) return { bg: 'rgba(52,211,153,0.07)',  text: '#4ade80' };
  if (chg >= -2)  return { bg: 'rgba(248,113,113,0.07)', text: '#fca5a5' };
  if (chg >= -5)  return { bg: 'rgba(248,113,113,0.15)', text: '#f87171' };
  if (chg >= -10) return { bg: 'rgba(248,113,113,0.25)', text: '#ef4444' };
  return              { bg: 'rgba(248,113,113,0.38)',     text: '#dc2626' };
}

function fmtPrice(p: number): string {
  if (p >= 1000)  return p.toLocaleString('en-US', { maximumFractionDigits: 0 });
  if (p >= 1)     return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  if (p >= 0.01)  return p.toFixed(4);
  return p.toFixed(6);
}

export default function CoinHeatmap() {
  const { t } = useLabels();
  const { store } = useMarket();
  const [cat, setCat] = useState<Cat>('all');
  /* Frozen tile order per category - see the comment above the effect below. */
  const [order, setOrder] = useState<Partial<Record<Cat, CoinId[]>>>({});

  const CAT_LABELS: Record<Cat, string> = {
    all: t('COIN_HEATMAP_CAT_ALL'),
    majors: t('COIN_HEATMAP_CAT_MAJORS'),
    alts: t('COIN_HEATMAP_CAT_ALTS'),
    defi: t('COIN_HEATMAP_CAT_DEFI'),
    meme: t('COIN_HEATMAP_CAT_MEME'),
  };

  const entries = [...(CAT[cat] as CoinId[])].map(c => ({ c, coin: store.coins[c] }));

  /* Rank on a schedule, never on a price tick.
   *
   * This grid used to re-sort every time any price moved. Prices arrive
   * continuously, so tiles swapped places continuously - 63% of /scanner's
   * layout shift came from this one component reordering itself, and it never
   * settled, because there is always another tick. It is also unpleasant to
   * use: tiles move under the cursor while you are reading them.
   *
   * Two rules replace it. Rank once the category has data for every coin (or
   * after FIRST_RANK_TIMEOUT_MS, so a permanently-missing feed cannot stop it
   * forever), then re-rank every RERANK_MS. Between those moments the ORDER is
   * frozen while prices, colours and percentages keep updating live inside
   * each tile.
   *
   * Waiting for complete data before the first rank is the part that took two
   * attempts. Ranking at 80% coverage put the late-arriving 20% wherever their
   * missing value sorted them and then held that for a full minute - measured
   * a coin sitting 16.7% out of position. Partial data ranked confidently is
   * worse than no ranking at all, because it looks authoritative. */
  const withData = entries.filter(e => e.coin?.change != null).length;
  const complete = withData === entries.length;

  const [rankTick, setRankTick] = useState(0);
  const [rankedOnce, setRankedOnce] = useState(false);

  /* Fallback so an incomplete category still ranks eventually. */
  useEffect(() => {
    if (rankedOnce) return;
    const id = setTimeout(() => setRankedOnce(true), FIRST_RANK_TIMEOUT_MS);
    return () => clearTimeout(id);
  }, [rankedOnce]);

  useEffect(() => {
    const id = setInterval(() => setRankTick(n => n + 1), RERANK_MS);
    return () => clearInterval(id);
  }, []);

  /* Recomputes when the category changes, when the data first becomes complete
     (or times out), and on the timer - never simply because a price moved. */
  useEffect(() => {
    if (!complete && !rankedOnce) return;
    if (complete) setRankedOnce(true);
    setOrder(prev => ({
      ...prev,
      [cat]: [...(CAT[cat] as CoinId[])]
        .map(c => ({ c, coin: store.coins[c] }))
        .sort((x, y) => (y.coin?.change ?? -999) - (x.coin?.change ?? -999))
        .map(e => e.c),
    }));
    // store.coins is read inside but is deliberately not a dependency -
    // reacting to it is the jitter this exists to prevent.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [complete, rankedOnce, cat, rankTick]);

  /* Until the ranking exists, render placeholders rather than the unranked
     tiles. Showing real tiles in declared order and then re-ordering them is a
     genuine layout shift - it was 51% of what remained. Placeholders are keyed
     by index, so when the ranking lands React replaces them outright instead of
     moving 50 identified nodes around, and the real tiles mount already in
     their final position. Same geometry, so nothing around the grid moves
     either. Costs about a second of dashes on a cold load, which is honest -
     the ranking genuinely is not known yet. */
  const ranked = order[cat];
  const coins  = ranked ? ranked.map(c => ({ c, coin: store.coins[c] })) : null;
  const positiveCount = coins?.filter(x => x.coin?.change != null && x.coin.change >= 0).length ?? 0;
  const negativeCount = coins?.filter(x => x.coin?.change != null && x.coin.change < 0).length ?? 0;

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
          <Tip text={t('COIN_HEATMAP_TOOLTIP')}>{t('COIN_HEATMAP_TITLE')}</Tip>
        </span>
        {positiveCount > 0 && (
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#34d399', background: 'rgba(52,211,153,0.1)', border: '0.5px solid rgba(52,211,153,0.25)' }}>
            ↑ {positiveCount}
          </span>
        )}
        {negativeCount > 0 && (
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '0.5px solid rgba(248,113,113,0.25)' }}>
            ↓ {negativeCount}
          </span>
        )}
      </div>

      {/* Category filter */}
      <div style={{ padding: '8px 12px 6px', display: 'flex', gap: 4 }}>
        {(Object.keys(CAT) as Cat[]).map(c => (
          <button
            key={c}
            onClick={() => setCat(c)}
            style={{
              fontSize: 'var(--fs-caption)', fontWeight: 600, padding: '3px 10px', borderRadius: 20, cursor: 'pointer',
              border: `0.5px solid ${cat === c ? 'rgba(255,255,255,0.2)' : 'rgba(255,255,255,0.07)'}`,
              background: cat === c ? 'rgba(255,255,255,0.1)' : 'transparent',
              color: cat === c ? 'var(--txt)' : '#444',
              transition: 'all .15s',
            }}
          >
            {CAT_LABELS[c]}
          </button>
        ))}
      </div>

      {/* Heatmap grid */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fill, minmax(100px, 1fr))',
        gap: 4, padding: '0 12px 12px',
      }}>
        {!coins && Array.from({ length: entries.length }).map((_, i) => (
          <div key={`ph-${i}`} aria-hidden="true" style={{
            background: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: '10px 8px',
            display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
            border: '0.5px solid rgba(255,255,255,0.04)',
          }}>
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: '#333' }}>-</span>
            <span style={{ fontSize: 'var(--fs-caption)', color: '#2a2a2a' }}>-</span>
            <span style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: '#333', lineHeight: 1 }}>-</span>
          </div>
        ))}
        {coins?.map(({ c, coin }) => {
          const chg = coin?.change ?? null;
          const { bg, text } = changeColor(chg);
          const sign = chg == null ? '' : chg >= 0 ? '+' : '';
          return (
            <div
              key={c}
              style={{
                background: bg,
                borderRadius: 8,
                padding: '10px 8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                border: `0.5px solid ${withAlpha(text, '22')}`,
                transition: 'background .2s',
                cursor: 'default',
              }}
            >
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: text, letterSpacing: '.04em' }}>
                {c.toUpperCase()}
              </span>
              {/* Always rendered, even with no price yet. Conditionally
                  mounting this line made every tile two lines tall until its
                  price arrived and three lines after, so the whole grid grew
                  in steps as coins reported in - and each step pushed the two
                  cards below the heatmap down the page. A dash holds the
                  slot; the tile is the same height from first paint. */}
              <span style={{ fontSize: 'var(--fs-caption)', color: withAlpha(text, 'aa'), fontVariantNumeric: 'tabular-nums' }}>
                {coin?.price != null ? `$${fmtPrice(coin.price)}` : '-'}
              </span>
              <span style={{
                fontSize: 'var(--fs-label)', fontWeight: 700, color: text,
                fontVariantNumeric: 'tabular-nums', lineHeight: 1,
              }}>
                {chg != null ? `${sign}${chg.toFixed(1)}%` : '-'}
              </span>
            </div>
          );
        })}
      </div>

      {/* Color scale legend */}
      <div style={{
        padding: '5px 14px 8px', borderTop: '0.5px solid rgba(255,255,255,0.05)',
        display: 'flex', alignItems: 'center', gap: 3,
      }}>
        <span style={{ fontSize: 'var(--fs-caption)', color: '#333', marginRight: 4 }}>{t('COIN_HEATMAP_SCALE_LABEL')}</span>
        {[
          { label: '>+10%', c: '#34d399' }, { label: '+5%', c: '#6ee7b7' },
          { label: '+2%', c: '#86efac' },   { label: '0', c: '#555' },
          { label: '-2%', c: '#fca5a5' },   { label: '-5%', c: '#f87171' },
          { label: '<-10%', c: '#dc2626' },
        ].map(({ label, c }) => (
          <span key={label} style={{ fontSize: 'var(--fs-caption)', color: c, fontWeight: 600 }}>{label}</span>
        ))}
      </div>
    </div>
  );
}
