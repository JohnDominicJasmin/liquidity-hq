'use client';
/* Landing's price ticker (#413 canvas mirror, landing.md). Deliberately a
 * separate component from dashboard's PriceTickerStrip, not a shared one:
 * landing.md is explicit that ALL tracked coins render here ("Frame shows 8
 * coins. We have 50... EXTEND... Do NOT truncate to 8"), single overflow-
 * hidden row, and its mobile geometry (height 30 not 34, cell padding 0 12px
 * not 16, gap 6 not 8, price omitted, mask-image edge fade) has no
 * dashboard equivalent - dashboard's ticker has never had a mobile spec.
 * Whether dashboard's own curated-8 was ever correct is a separate, open
 * question (flagged to QA, not resolved here) - this file only answers it
 * for landing, where the spec is explicit. */
import { useMarket, COINS, COIN_DEC, fmtPrice } from '@/lib/marketStore';
import { withAlpha } from '@/lib/color';

export default function LandingTicker({ mobile, dir }: { mobile: boolean; dir: 'ltr' | 'rtl' }) {
  const { store } = useMarket();
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
              {id.toUpperCase()}
            </span>
            {!mobile && (
              <span style={{ fontSize: 11, color: 'var(--txt)', fontVariantNumeric: 'tabular-nums' }}>
                {d?.price ? fmtPrice(d.price, COIN_DEC[id]) : '—'}
              </span>
            )}
            <span style={{
              fontSize: mobile ? 10 : 11, fontVariantNumeric: 'tabular-nums',
              color: chg == null ? 'var(--txt2)' : withAlpha(up ? 'var(--green)' : 'var(--red)', 'cc'),
            }}>
              {chg == null ? '—' : `${up ? '+' : '−'}${Math.abs(chg).toFixed(2)}%`}
            </span>
          </div>
        );
      })}
    </div>
  );
}
