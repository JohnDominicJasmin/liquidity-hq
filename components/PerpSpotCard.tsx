'use client';
import { useMarket } from '@/lib/marketStore';
import { usePerpSpot, useAbsorption } from '@/lib/usePerpSpot';

/* Perps vs spot (#328) - "is there a real buyer, or is the pump just futures?"
 *
 * ── THE NUMBER, AND WHY IT IS THIS ONE ──────────────────────────────────────
 *
 * The owner revised the ask mid-build: not a pair, but *"a number with
 * explanation below for user to interpret just like other items in dashboard"*.
 * With a pair the user does the comparison; with one figure we have already
 * done it, so which figure it is matters far more.
 *
 * It is NOT perp volume, and NOT perp share of total. Measured on #328 across
 * 168 hourly bars, perps run 7-14x spot as the ordinary state - BTC 7.8x, ETH
 * 14.4x, SOL 10.4x. Either of those numbers would sit at "futures dominate"
 * every hour of every day: true about crypto market structure, silent about
 * today, and unreadable as a signal.
 *
 * The number shown is the ratio measured against THIS COIN'S OWN recent median.
 * 1.0x is a completely ordinary day. That is the only version of this figure
 * that moves when something is actually happening.
 *
 * ── SHAPE ───────────────────────────────────────────────────────────────────
 *
 * Matches GlobalMacroContext deliberately - micro uppercase label, a verdict
 * pill, the value, then a sentence. The owner asked for it to read as one more
 * item in a list they already understand, not a new kind of widget.
 *
 * NOT wired into the Confluence Score. The ask was to SEE the split, not to
 * have the score change underneath them, and QA was explicit on #328.
 */

const LABEL = 'FUTURES ACTIVITY VS NORMAL';

export default function PerpSpotCard() {
  const { store } = useMarket();
  const coin = store.selectedCoin;
  // Shared with the Arena prompts and the chart signal (#340) - one fetch, one
  // reading, so the card and the AI cannot disagree on screen.
  const reading = usePerpSpot(coin);
  const absorption = useAbsorption(coin);

  if (!reading) return null;

  const unknown = reading.lean === 'unknown';
  // --txt2, not --txt-dim (#546 C9): --txt-dim isn't in terminal's
  // 16-token palette.
  const tone =
    reading.lean === 'perp' ? 'var(--amber)' :
    reading.lean === 'spot' ? 'var(--green-2)' :
    unknown ? 'var(--txt3)' : 'var(--txt2)';

  const verdict =
    reading.lean === 'perp' ? 'FUTURES LEADING' :
    reading.lean === 'spot' ? 'SPOT LEADING' :
    reading.lean === 'normal' ? 'NORMAL' :
    'CANNOT MEASURE';

  return (
    <div data-testid="perp-spot-card">
      <div style={{
        fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase',
        letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 4,
      }}>
        Perps vs Spot · {coin.toUpperCase()}
      </div>

      <div className="psc-verdict-pill" style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
        marginBottom: 8,
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        border: `0.5px solid color-mix(in srgb, ${tone} 40%, transparent)`,
      }}>
        {/* Text is --txt, not `tone` (#590 review, design ruling) - a self-tint
         * where text colour equals the tint's source colour is structurally
         * marginal in light theme by construction (the surface drags toward
         * the text), independent of alpha. State is carried by the tint and
         * border alone now. Same shape as CorrelationTerminal's diagonal fix. */}
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: 'var(--txt)', letterSpacing: '0.05em' }}>
          {verdict}
        </span>
      </div>

      {/* The number. A dash when it could not be measured - never a 1.0x, which
          would read as "an ordinary day" and be indistinguishable from having
          checked. */}
      <div style={{ display: 'flex', flexDirection: 'column', marginBottom: 8 }}>
        <span style={{
          fontSize: 'var(--fs-micro)', color: 'var(--txt3)', textTransform: 'uppercase',
          letterSpacing: '0.05em', marginBottom: 1,
        }}>
          {LABEL}
        </span>
        <span style={{
          fontSize: 'var(--fs-section)', fontWeight: 700, color: unknown ? 'var(--txt3)' : 'var(--txt)',
          fontFamily: 'var(--font-mono), monospace', fontVariantNumeric: 'tabular-nums',
        }}>
          {unknown ? '-' : `${reading.relative!.toFixed(1)}x`}
        </span>
      </div>

      <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55 }}>
        {reading.explanation}
      </div>

      {absorption?.available && (
        <>
          <div style={{ borderTop: '0.5px solid var(--bdr)', margin: '10px 0' }} />
          <div style={{
            fontSize: 'var(--fs-micro)', fontWeight: 700, textTransform: 'uppercase',
            letterSpacing: '0.08em', color: 'var(--txt3)', marginBottom: 4,
          }}>
            Spot Absorption
          </div>
          <div style={{ fontSize: 'var(--fs-caption)', color: 'var(--txt2)', lineHeight: 1.55 }}>
            {absorption.observation}
          </div>
        </>
      )}
    </div>
  );
}
