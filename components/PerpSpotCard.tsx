'use client';
import { useEffect, useState } from 'react';
import { useMarket } from '@/lib/marketStore';
import { BINANCE_SYMS } from '@/lib/coins';
import { computePerpSpot, type PerpSpotReading } from '@/lib/perpSpot';

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

const HOUR = 3600_000;
const BARS = 168;   // 7 days of hourly bars - enough for a stable median

type Kline = [number, string, string, string, string, string, number, string, ...unknown[]];

async function fetchBars(source: 'binance' | 'binance-futures', symbol: string) {
  const r = await fetch(
    `/api/market/klines?source=${source}&symbol=${symbol}&interval=1h&limit=${BARS}`,
    { signal: AbortSignal.timeout(12_000) },
  );
  if (!r.ok) throw new Error(`${source} ${r.status}`);
  const rows = (await r.json()) as Kline[];
  // Index 7 is quote-asset volume (USDT) - comparable across the two venues in
  // a way base volume is not. Index 0 is the bar's open time.
  return rows.map(k => ({ time: k[0], quoteVolume: parseFloat(k[7]) }));
}

const LABEL = 'FUTURES ACTIVITY VS NORMAL';

export default function PerpSpotCard() {
  const { store } = useMarket();
  const coin = store.selectedCoin;
  const [reading, setReading] = useState<PerpSpotReading | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const sym = BINANCE_SYMS[coin];

    (async () => {
      // No Binance spot pair means the question cannot be answered for this
      // coin at all. With a single number there is nowhere for a missing half
      // to show up, so it has to be said outright - otherwise the perp side
      // alone renders as though it had been measured against something.
      if (!sym) { if (!cancelled) setReading(computePerpSpot([], [])); return; }
      try {
        const [spot, perp] = await Promise.all([
          fetchBars('binance', sym),
          fetchBars('binance-futures', sym),
        ]);
        if (!cancelled) setReading(computePerpSpot(spot, perp, HOUR, Date.now()));
      } catch {
        // A failed fetch is not a quiet market.
        if (!cancelled) setReading(computePerpSpot([], []));
      }
    })();
    return () => { cancelled = true; };
  }, [coin, tick]);

  // Hourly bars, so refresh on the bar close rather than a rolling timer -
  // same reasoning as #316. Re-arms itself via `tick`.
  useEffect(() => {
    const id = setTimeout(() => setTick(t => t + 1), HOUR - (Date.now() % HOUR) + 3_000);
    return () => clearTimeout(id);
  }, [tick]);

  if (!reading) return null;

  const unknown = reading.lean === 'unknown';
  const tone =
    reading.lean === 'perp' ? 'var(--amber)' :
    reading.lean === 'spot' ? 'var(--green-2)' :
    unknown ? 'var(--txt3)' : 'var(--txt-dim)';

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

      <div style={{
        display: 'inline-flex', alignItems: 'center', gap: 5, padding: '3px 10px',
        borderRadius: 20, marginBottom: 8,
        background: `color-mix(in srgb, ${tone} 12%, transparent)`,
        border: `0.5px solid color-mix(in srgb, ${tone} 40%, transparent)`,
      }}>
        <span style={{ fontSize: 'var(--fs-caption)', fontWeight: 800, color: tone, letterSpacing: '0.05em' }}>
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
    </div>
  );
}
