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
  if (chg == null) return { bg: 'color-mix(in srgb, var(--txt) 4%, transparent)', text: 'var(--txt-dim)' };
  if (chg >=  10) return { bg: 'color-mix(in srgb, var(--green-2) 30%, transparent)',  text: 'var(--green-2)' };
  if (chg >=   5) return { bg: 'color-mix(in srgb, var(--green-2) 22%, transparent)',  text: 'var(--green-soft)' };
  if (chg >=   2) return { bg: 'color-mix(in srgb, var(--green-2) 13%, transparent)',  text: 'var(--green-soft)' };
  if (chg >=   0) return { bg: 'color-mix(in srgb, var(--green-2) 7%, transparent)',  text: 'var(--green)' };
  /* The red ramp used to darken the text (#fca5a5 -> #f87171 -> #ef4444 ->
     #dc2626) at the same time as it made the tile background a more opaque red
     (0.07 -> 0.38). Both moving together collapses the contrast exactly where
     the number matters most: the -10% bucket measured 3.73:1 and the worst
     bucket 2.43:1, so the biggest losers on the board were the hardest to read.
     Text now LIGHTENS as the tile saturates - severity is carried by the tile,
     which is the part that reads at a glance anyway - giving 8.6:1 to 9.6:1
     across the whole ramp.
     The green side has the same shape but does not fail (its worst bucket is
     5.71:1) because green is inherently light; left as-is rather than churning
     a passing palette, but the same rule applies if that ramp is ever extended. */
  if (chg >= -2)  return { bg: 'color-mix(in srgb, var(--red) 7%, transparent)', text: 'var(--red-soft)' };
  if (chg >= -5)  return { bg: 'color-mix(in srgb, var(--red) 15%, transparent)', text: 'var(--red-soft)' };
  if (chg >= -10) return { bg: 'color-mix(in srgb, var(--red) 25%, transparent)', text: 'var(--red-soft)' };
  return              { bg: 'color-mix(in srgb, var(--red) 38%, transparent)',     text: '#fee2e2' };
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
        {/* --green-fg on the TEXT, --green-2 still on the tint and border
            (#738). This is the pattern the token exists for: a signal colour
            printed on a wash of itself. In terminal light --green is #14702c,
            and on its own 10% wash that measures 4.47 by token arithmetic and
            4.11 rendered - QA's number, three runs, same ratio each time.
            --green-fg is 6.03 there and is ALIASED to --green everywhere else,
            so the other three contexts are byte-identical. The tint keeps
            --green-2 deliberately: changing the wash would move the ground
            this was just measured against.

            The comment sits ABOVE the conditional, not inside it. A
            short-circuit render takes exactly one child, and a JSX comment in
            that slot is a second one - it compiles to an object where JSX
            expects an element. Third time in this session; tests pass every
            time, because nothing typechecks a .tsx, and only tsc says so.
            Braces are spelled out in words here for the same reason: this
            comment lives inside a JSX expression container, so a stray brace
            in the prose closes it early. */}
        {positiveCount > 0 && (
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: 'var(--green-fg)', background: 'color-mix(in srgb, var(--green-2) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--green-2) 25%, transparent)' }}>
            ↑ {positiveCount}
          </span>
        )}
        {negativeCount > 0 && (
          <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 700, padding: '2px 7px', borderRadius: 20, color: 'var(--red)', background: 'color-mix(in srgb, var(--red) 10%, transparent)', border: '0.5px solid color-mix(in srgb, var(--red) 25%, transparent)' }}>
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
              color: cat === c ? 'var(--txt)' : 'var(--txt-dim)',
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
            <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--txt-dim)' }}>-</span>
            <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dash)' }}>-</span>
            <span style={{ fontSize: 'var(--fs-label)', fontWeight: 700, color: 'var(--txt-dim)', lineHeight: 1 }}>-</span>
          </div>
        ))}
        {coins?.map(({ c, coin }) => {
          const chg = coin?.change ?? null;
          const { bg, text } = changeColor(chg);
          const sign = chg == null ? '' : chg >= 0 ? '+' : '';
          return (
            <div
              key={c}
              /* Only tiles WITH a value take the terminal override. QA's review
                 of #701: --heat-fg: var(--txt) applied to every tile would
                 override the no-data branch's --txt-dim too, so an empty
                 tile would read as prominently as one carrying a price.
                 That is #692's loss pointed the other way - contrast up,
                 meaning down - and --txt-dim was the signal that a tile has
                 nothing to say. It was never in the failing set, so it keeps
                 its own colour by simply not getting the class. */
              className={chg == null ? undefined : "chm-tile"}
              style={{
                background: bg,
                borderRadius: 8,
                padding: '10px 8px',
                display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 3,
                border: `0.5px solid ${withAlpha(text, '22')}`,
                /* #698: terminal overrides --heat-fg to --txt; the current design
                   leaves it unset so each span falls back to its ramp colour. */
                transition: 'background .2s',
                cursor: 'default',
              }}
            >
              <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: `var(--heat-fg, ${text})`, letterSpacing: '.04em' }}>
                {c.toUpperCase()}
              </span>
              {/* Always rendered, even with no price yet. Conditionally
                  mounting this line made every tile two lines tall until its
                  price arrived and three lines after, so the whole grid grew
                  in steps as coins reported in - and each step pushed the two
                  cards below the heatmap down the page. A dash holds the
                  slot; the tile is the same height from first paint. */}
              {/* withAlpha(text, 'aa') = 67%, which knocked this price down to
                  as little as 2.43:1 on the redder tiles. It is a live price,
                  not decoration. The caption size already sets it apart from
                  the percentage above it, so it takes the tile colour flat. */}
              <span style={{ fontSize: 'var(--fs-caption)', color: `var(--heat-fg, ${text})`, fontVariantNumeric: 'tabular-nums' }}>
                {coin?.price != null ? `$${fmtPrice(coin.price)}` : '-'}
              </span>
              <span style={{
                fontSize: 'var(--fs-label)', fontWeight: 700, color: `var(--heat-fg, ${text})`,
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
        <span style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt-dim)', marginRight: 4 }}>{t('COIN_HEATMAP_SCALE_LABEL')}</span>
        {[
          { label: '>+10%', c: 'var(--green-2)' }, { label: '+5%', c: 'var(--green-soft)' },
          { label: '+2%', c: 'var(--green-soft)' },   { label: '0', c: 'var(--txt-dim)' },
          { label: '-2%', c: 'var(--red-soft)' },   { label: '-5%', c: 'var(--red-soft)' },
          /* NOT '#fee2e2' (#761). That is the TILE's text colour, and it is
             correct there - the worst bucket's tile is var(--red) at 38%, and
             pale text on a saturated tile measures 8.6-9.6, which is the rule
             the comment at the top of this file sets out.

             The legend has no tile. It is text on the panel, var(--bg1), and
             the same value measures 1.22 in current light and 1.01 in terminal
             light. Dark hid it completely (16.49 / 14.96) because there the
             panel is dark and pale text is exactly right.

             Same fact, two grounds, and the copy took the value without the
             surface it depended on. var(--red) clears all four (7.28 / 6.47 /
             5.24 / 6.65) and reads as the strongest step of the ramp, which is
             what the legend is for. In terminal dark it coincides with
             --red-soft, so the last two steps look identical there; that is
             the palette's own doing, not this substitution's. */
          { label: '<-10%', c: 'var(--red)' },
        ].map(({ label, c }) => (
          <span key={label} style={{ fontSize: 'var(--fs-caption)', color: c, fontWeight: 600 }}>{label}</span>
        ))}
      </div>
    </div>
  );
}
