'use client';
/* Liquidation density surface — Liquidation Map.dc.html region 4 (#652).
 *
 * Named LiqDensityMap, not LiqHeatmap: components/LiqHeatmap.tsx already
 * exists and is a different thing - arena's price-ladder card, taking
 * { levels, currentPrice } from store.btcLiqLevels. Two components can both
 * be "the heatmap" on a page called Liquidation Map, and the name went to
 * the one that was there first.
 *
 * The canvas's centrepiece, and the one region the terminal build never had:
 * `LiqTerminal` rendered a 154-row ladder and no surface, while the canvas
 * titles the whole page "BTC LIQUIDATION HEATMAP".
 *
 * WHAT IS THE CANVAS'S AND WHAT IS OURS. The frame builds its density with a
 * seeded PRNG — `carry = carry * 0.72 + hrnd() * 0.28`, commented "leverage
 * builds up" — which makes the surface *look* like density accumulating over
 * time. That is a FIXTURE, not a specification: a canvas generates
 * everything, its candles included (`mkCandles(64, 20260814)`). Real `ts`
 * buckets replace it here, and the streaking is not reproduced.
 *
 * What IS taken from the canvas, because it is presentation rather than
 * data: the 44×34 grid shape, the vertical bleed (0.6/0.2/0.2 over the rows
 * above and below), the threshold's 0.55 scaling, and the four intensity
 * ramps with their stops.
 *
 * WHAT THE DATA ACTUALLY IS, and why the header says so. `liq_events` has no
 * server-side writer — the table name appears only in lib/tables.ts. It is
 * populated exclusively by browsers with /liq open, via LiqFeed's two
 * websockets. So this surface shows liquidations WE OBSERVED, not all
 * liquidations, and a gap can mean a quiet market or nobody watching. That
 * distinction is in the subtitle rather than implied, on the same rule that
 * renamed "Liquidity" to "Taker flow" and "Volatility" to "BTC volatility":
 * substitute the metric, never the label.
 */

import { useMemo } from 'react';
import type { LiqEvent } from '@/components/LiqFeed';
import { useLabels } from '@/lib/labels';

/* Four intensity ramps, transcribed from Liquidation Map.dc.html:457-461.
   Pure presentation — no data question — so these are the canvas's own stops
   rather than tokens. They are a continuous colour field, not palette
   members, which is why the conformance check does not govern them. */
const RAMPS: [number, [number, number, number]][][] = [
  [[0, [10, 6, 20]], [.14, [42, 17, 78]], [.32, [104, 30, 122]], [.52, [181, 48, 106]], [.7, [232, 91, 58]], [.86, [249, 169, 74]], [1, [253, 243, 200]]],
  [[0, [8, 12, 18]], [.18, [23, 54, 76]], [.38, [22, 100, 96]], [.58, [45, 148, 88]], [.76, [140, 190, 62]], [1, [237, 240, 138]]],
  [[0, [8, 10, 22]], [.2, [24, 48, 108]], [.42, [30, 96, 176]], [.62, [56, 156, 214]], [.8, [140, 206, 232]], [1, [236, 248, 255]]],
  [[0, [14, 12, 10]], [.2, [64, 40, 26]], [.42, [124, 72, 32]], [.62, [186, 118, 40]], [.8, [226, 170, 74]], [1, [250, 236, 196]]],
];

export const RAMP_COUNT = RAMPS.length;

export function rampCss(idx: number): string {
  return 'linear-gradient(0deg,' +
    RAMPS[idx].map(s => `rgb(${s[1].join(',')}) ${(s[0] * 100).toFixed(0)}%`).join(',') + ')';
}

function rampColor(v: number, idx: number): string {
  const R = RAMPS[idx];
  for (let i = 1; i < R.length; i++) {
    if (v <= R[i][0]) {
      const [t0, c0] = R[i - 1], [t1, c1] = R[i];
      const k = (v - t0) / (t1 - t0);
      return `rgb(${c0.map((n, j) => Math.round(n + (c1[j] - n) * k)).join(',')})`;
    }
  }
  return `rgb(${R[R.length - 1][1].join(',')})`;
}

const ROWS = 44;
const COLS = 34;

interface Props {
  events: LiqEvent[];
  /** Live price, for the spot line. Null renders the surface without it
   *  rather than guessing a level. */
  spot: number | null;
  coin: string;
  threshold: number;
  palette: number;
  /** Window in ms. LiqFeed loads 24h from Supabase, so anything longer is
   *  drawing emptiness it cannot fill. */
  windowMs: number;
}

interface Row { top: string; h: string; bg: string }

export default function LiqDensityMap({ events, spot, coin, threshold, palette, windowMs }: Props) {
  const { t } = useLabels();

  const model = useMemo(() => {
    const now = Date.now();
    /* Hour-aligned, not now-relative (#655 review). `from = now - windowMs`
       puts the boundaries on arbitrary minutes, so at 14:37 a label reading
       "14:00" is not rounded, it is wrong - the axis asserts the column
       starts on the hour and it does not. Ceiling `to` to the next hour and
       measuring back means every label lands on a real hour AND the columns
       stop sliding with the clock between renders. The rightmost bucket is
       the hour in progress, which is what a live map should show. */
    const HOUR = 3_600_000;
    const to = Math.ceil(now / HOUR) * HOUR;
    const from = to - windowMs;
    const evts = events.filter(e => e.coin === coin && e.ts >= from);
    if (evts.length === 0) return null;

    /* Range from the events themselves plus spot, so the surface frames what
       actually happened rather than a fixed span. The canvas hardcodes
       111600-120100; that is fixture data for one BTC afternoon. */
    const prices = evts.map(e => e.price);
    if (spot != null) prices.push(spot);
    let lo = Math.min(...prices), hi = Math.max(...prices);
    if (hi - lo < 1e-9) { lo -= lo * 0.01; hi += hi * 0.01; }
    const pad = (hi - lo) * 0.07;
    lo -= pad; hi += pad;
    const range = hi - lo;

    /* Bucket into rows x cols by price and time. This is the whole
       substitution: the canvas smears eight hardcoded clusters with a
       Gaussian and streaks them with a PRNG; we sum real usd into the cell
       the event's price and timestamp fall in. */
    const grid: number[][] = Array.from({ length: ROWS }, () => new Array(COLS).fill(0));
    for (const e of evts) {
      const r = Math.min(ROWS - 1, Math.max(0, Math.floor(((hi - e.price) / range) * ROWS)));
      const c = Math.min(COLS - 1, Math.max(0, Math.floor(((e.ts - from) / (to - from)) * COLS)));
      grid[r][c] += e.usd;
    }

    const peak = Math.max(...grid.map(r => Math.max(...r)));
    if (peak <= 0) return null;
    const norm = grid.map(r => r.map(v => v / peak));

    /* Vertical bleed, from the canvas — presentation, so it is kept. */
    const sm = norm.map((row, r) => row.map((v, c) => {
      const up = norm[r - 1] ? norm[r - 1][c] : v;
      const dn = norm[r + 1] ? norm[r + 1][c] : v;
      return v * 0.6 + up * 0.2 + dn * 0.2;
    }));

    const cut = threshold * 0.55;
    const rows: Row[] = sm.map((row, r) => ({
      top: (r * (100 / ROWS)).toFixed(3) + '%',
      h: (100 / ROWS + 0.1).toFixed(3) + '%',
      bg: 'linear-gradient(90deg,' + row.map((v, c) => {
        const adj = v <= cut ? 0 : (v - cut) / (1 - cut);
        return rampColor(adj, palette) + ' ' + ((c / (COLS - 1)) * 100).toFixed(2) + '%';
      }).join(',') + ')',
    }));

    const priceAxis = Array.from({ length: 9 }, (_, i) =>
      Math.round(hi - (i / 8) * range).toLocaleString());

    /* Seven labels across an hour-aligned span, so each :00 is true. The
       zone is marked once at the end of the row rather than repeated - the
       reader is in Asia/Manila, UTC+8, so an unmarked axis is eight hours
       from what they will assume it means, and "when did this happen" is
       the question this axis exists to answer. */
    const timeAxis = Array.from({ length: 7 }, (_, i) => {
      const d = new Date(from + (i / 6) * (to - from));
      return `${String(d.getUTCHours()).padStart(2, '0')}:00`;
    });

    const spotTop = spot != null && spot >= lo && spot <= hi
      ? (((hi - spot) / range) * 100).toFixed(2) + '%'
      : null;

    return { rows, priceAxis, timeAxis, spotTop, peak, count: evts.length };
  }, [events, spot, coin, threshold, palette, windowMs]);

  if (!model) {
    /* No events in the window. Not an error and not zero - the honest
       statement is that nothing was observed, because with no server-side
       ingest an empty window means the market was quiet OR nobody had the
       page open. */
    return (
      <div className="liq-heat-empty">{t('LIQ_HEAT_NO_EVENTS', { coin: coin.toUpperCase() })}</div>
    );
  }

  const { rows, priceAxis, timeAxis, spotTop, peak } = model;

  return (
    <div className="liq-heat-wrap">
      {/* Intensity scale — max at the top, 0 at the bottom, canvas :86-90 */}
      <div className="liq-heat-scale">
        <div className="liq-heat-scale-max">{'$' + (peak / 1e6).toFixed(2) + 'M'}</div>
        <div className="liq-heat-scale-bar" style={{ background: rampCss(palette) }} />
        <div className="liq-heat-scale-min">0</div>
      </div>

      <div className="liq-heat-main">
        <div className="liq-heat-surface">
          {rows.map((r, i) => (
            <div key={i} className="liq-heat-row" style={{ top: r.top, height: r.h, background: r.bg }} />
          ))}
          {spotTop && (
            <>
              <div className="liq-heat-spot" style={{ top: spotTop }} />
              <div className="liq-heat-spot-label" style={{ top: spotTop }}>
                {spot!.toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </div>
            </>
          )}
        </div>
        <div className="liq-heat-time">
          {timeAxis.map((d, i) => <div key={i}>{d}</div>)}
          <div className="liq-heat-tz">{t('LIQ_HEAT_TZ')}</div>
        </div>
      </div>

      <div className="liq-heat-axis">
        {priceAxis.map((a, i) => <div key={i}>{a}</div>)}
      </div>
    </div>
  );
}
