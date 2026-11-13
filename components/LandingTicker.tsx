'use client';
/* Landing's price ticker (#413 canvas mirror, landing.md).
 *
 * It was deliberately a separate component from dashboard's
 * PriceTickerStrip rather than a shared one. That component no longer exists
 * - #718 deleted it with the dashboard canvas rebuild that created it - so
 * the comparison below is history, kept because it is the reason THIS
 * component owns its own geometry instead of taking props.
 *
 * landing.md is explicit that ALL tracked coins render here ("Frame shows 8
 * coins. We have 50... EXTEND... Do NOT truncate to 8"), single overflow-
 * hidden row, and its mobile geometry (height 30 not 34, cell padding 0 12px
 * not 16, gap 6 not 8, price omitted, mask-image edge fade) had no
 * dashboard equivalent - dashboard's ticker never had a mobile spec.
 * Whether dashboard's own curated-8 was ever correct is a separate, open
 * question (flagged to QA, not resolved here) - this file only answers it
 * for landing, where the spec is explicit. */
import { useMarket, COINS, COIN_DEC, coinLabel, fmtPrice } from '@/lib/marketStore';
import type { LandingDict } from '@/lib/i18n/dictionaries';

export default function LandingTicker({ mobile, dir, words }: { mobile: boolean; dir: 'ltr' | 'rtl'; words: LandingDict['ticker'] }) {
  const { store } = useMarket();
  /* A MISSING QUOTE SAYS WHICH KIND OF MISSING (#1263): an ellipsis while the bulk read is still in flight, otherwise "n/a" with a hover note, never a bare dash.
     THE WORDS COME FROM THE LANDING DICTIONARY (the `words` prop), not the label table: the landing page does not read the label table (landingReadsNoLabels, #1889), so this
     component must not call useLabels. */
  const LOADING = words.loading;
  const FAILED = words.failedNote;
  const NONE = words.noneNote;
  const feed = store.scannerFeed.universe;
  const gap = () => feed === 'pending'
    ? <span role="img" aria-label={LOADING} title={LOADING}>{'…'}</span>
    : <span title={feed === 'failed' ? FAILED : NONE}>{words.unavailable}</span>;

  // landing.md line 518: the fade is direction-dependent - under RTL the
  // gradient must mirror to 270deg, or it hides the first cell instead of
  // the last (#592 review).
  const maskAngle = dir === 'rtl' ? 270 : 90;

  return (
    <div
      className="lpt-ticker"
      style={{
        height: mobile ? 30 : 34, flexShrink: 0, borderBottom: '1px solid var(--bdr)',
        display: 'flex', alignItems: 'stretch', overflowX: 'auto',
        fontFamily: 'var(--font-mono), monospace',
        maskImage: mobile ? `linear-gradient(${maskAngle}deg, #000 86%, transparent)` : undefined,
        WebkitMaskImage: mobile ? `linear-gradient(${maskAngle}deg, #000 86%, transparent)` : undefined,
      }}
    >
      {COINS.map(id => {
        const d = store.coins[id];
        const chg = d?.change ?? null;
        const up = chg != null && chg >= 0;
        return (
          <div key={id} style={{
            display: 'flex', alignItems: 'center', gap: mobile ? 6 : 8,
            padding: mobile ? '0 12px' : '0 16px',
            borderRight: '1px solid var(--bdr3)', flexShrink: 0,
          }}>
            <span style={{ fontSize: mobile ? 10 : 11, fontWeight: 600, letterSpacing: '.06em', color: 'var(--txt2)' }}>
              {/* coinLabel, not id.toUpperCase() - `spx` is SPX6900 and this page was the most
                  public of the 26 surfaces that rendered the raw id. */}
              {coinLabel(id)}
            </span>
            {!mobile && (
              <span style={{ fontSize: 11, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>
                {d?.price ? fmtPrice(d.price, COIN_DEC[id]) : gap()}
              </span>
            )}
            <span style={{
              fontSize: mobile ? 10 : 11, fontVariantNumeric: 'tabular-nums',
              /* No alpha, both signs (#593). The Ticker panel spec mandated
                 80% on the change value, which put --red at 3.96:1 - but the
                 same document's accessibility section forbids exactly this:
                 "Do not apply alpha to a token to de-emphasise it. This
                 pattern has already produced sub-AA text five times. Size and
                 weight carry de-emphasis; the token is already tuned to the
                 line." The ticker rule was the current instance of the banned
                 pattern, so the fix is removing the alpha rather than tuning
                 it - raising it to 90% would have kept the pattern and just
                 moved the number. Verified against the design project itself,
                 not the repo's static copy. If this needs de-emphasising, use
                 size or weight. */
              color: chg == null ? 'var(--txt2)' : (up ? 'var(--green)' : 'var(--red)'),
            }}>
              {chg == null ? gap() : `${up ? '+' : '−'}${Math.abs(chg).toFixed(2)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
