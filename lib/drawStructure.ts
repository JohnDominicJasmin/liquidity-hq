/* DRAW STRUCTURE: the model PROPOSES lines, our geometry makes them drawable, the user decides.
 *
 * Owner decision 2026-10-31, option D on #1818, after three measurements each closed a door on the
 * automatic version:
 *
 *   1. Both engines sat at chance separating structured windows from noise - Grok AUC
 *      0.648 [0.389, 0.870], Claude 0.716 [0.457, 0.914], both intervals containing 0.5.
 *   2. Our own detector sat at chance against the owner: scored structure=1/maybe=0.5/noise=0, his
 *      mean was 0.67 on our high-confidence windows and 0.67 on our low ones.
 *   3. Held at one timeframe, there was no separation to find - and the decisive part is not the
 *      small inversion but that **he said "noise" zero times in sixteen charts** at 1h and 4h.
 *      **A classifier whose negative class is empty on the data it would run against is not a
 *      classifier.**
 *
 * **SO NOTHING HERE JUDGES WHETHER A STRUCTURE IS REAL.** The model proposes, this module turns a
 * list of claimed candle indices into a line with endpoints a chart can draw, and the trader
 * accepts or rejects it. That is a stronger position than the automatic version rather than a
 * retreat: an automatic detector would have had to CLAIM its lines were real, on a statistic
 * measured at chance against the only trader we have.
 *
 * WHAT THIS MODULE REFUSES TO DO, and each is a rule from that decision:
 *
 *   - **No confidence score reaches the caller.** The model emits one; it is dropped here rather
 *     than at the UI, so no later component can decide to render it. A number on screen implies a
 *     measurement we do not have.
 *   - **No structure is filtered out for being "weak".** There is no threshold, because there is
 *     no validated statistic to threshold on. Every well-formed proposal is returned and the user
 *     declines the ones they do not want.
 *   - **No wording that asserts.** The caller gets geometry and a type, never "detected" or
 *     "confirmed". Copy lives in label keys, which is also where the owner can change it.
 *
 * WHAT IT DOES ENFORCE, because these are correctness rather than judgement:
 *
 *   - an index must exist in the window, so a proposal cannot invent a candle;
 *   - a line needs at least 2 distinct points to have a slope at all, and `fitLine` needs 2;
 *   - the endpoints are clamped to the window, so nothing is drawn off the edge of the data.
 */
import { fitLine, lineValueAt, type StructureCandle } from './chartStructures.ts';

/** The structure types the model may propose. A value outside this set is dropped rather than
 *  passed through, so an unknown type cannot reach the chart and render as something else. */
export const STRUCTURE_TYPES = ['trendline', 'channel', 'flag', 'triangle', 'horizontal'] as const;
export type StructureType = (typeof STRUCTURE_TYPES)[number];

/** What the model returns, before validation. Deliberately loose - it is parsed, not trusted. */
export interface RawProposal {
  type?: unknown;
  side?: unknown;
  touchIndices?: unknown;
  /** Read so it can be explicitly DISCARDED - see the header. */
  confidence?: unknown;
}

/**
 * One drawable proposal.
 *
 * **No confidence field, on purpose.** The absence is the point: a component cannot render a
 * number that was never handed to it, which is a stronger guarantee than a styling convention.
 */
export interface DrawableStructure {
  type: StructureType;
  side: 'high' | 'low';
  /** The candle timestamps the model claimed, kept so the UI can mark them and the user can see
   *  WHAT the line was drawn through rather than only the line. */
  touchTimestamps: number[];
  /** The two endpoints a chart needs, in the window's own coordinates. */
  from: { timestamp: number; price: number };
  to: { timestamp: number; price: number };
}

/**
 * Indices are used rather than timestamps because the model will not emit timestamps.
 *
 * Measured on #1818: asked for exact 13-digit millisecond timestamps, Grok returned an empty list
 * on every one of three windows our geometry rated highly, across three runs - it could describe
 * the structure in prose on the same window and would not copy the numbers. Asked for index
 * numbers instead, it returned six structures immediately. **The refusal was the prompt's fault,
 * and asking for the wrong coordinate cost a flat zero that looked like blindness.**
 *
 * The cost is stated rather than hidden: an out-of-range index is still detectable invention, but
 * an in-range WRONG index is an off-by-one that cannot be told from a deliberate claim. That is
 * tolerable here precisely because nothing is asserted - the user sees the line through the
 * marked candles and declines it if the points are wrong.
 */
export function toDrawable(
  raw: RawProposal,
  candles: readonly StructureCandle[],
): DrawableStructure | null {
  if (!candles.length) return null;

  const type = STRUCTURE_TYPES.includes(raw.type as StructureType) ? raw.type as StructureType : null;
  if (!type) return null;
  const side: 'high' | 'low' = raw.side === 'high' ? 'high' : 'low';

  const indices = Array.isArray(raw.touchIndices)
    ? [...new Set(raw.touchIndices.map(Number).filter(
        i => Number.isInteger(i) && i >= 0 && i < candles.length))].sort((a, b) => a - b)
    : [];
  /* Two DISTINCT indices minimum. `fitLine` needs two points, and two points at one index have no
     slope - a vertical line is not a structure, it is a parse failure wearing one. */
  if (indices.length < 2) return null;

  const points = indices.map(i => ({
    index: i,
    price: side === 'high' ? candles[i].high : candles[i].low,
  }));
  const fit = fitLine(points);
  if (!fit) return null;

  /* ENDPOINTS AT THE CLAIMED POINTS, NOT AT THE WINDOW EDGES. Extending a 3-point line across 200
     candles turns a local observation into a claim about the whole window, which is the assertion
     this feature exists to avoid making. The user can see where the line was actually fitted. */
  const first = indices[0];
  const last = indices[indices.length - 1];
  const priceAt = (i: number) => {
    const v = lineValueAt(fit, i);
    return Number.isFinite(v) ? v : null;
  };
  const p0 = priceAt(first);
  const p1 = priceAt(last);
  if (p0 === null || p1 === null) return null;

  return {
    type,
    side,
    touchTimestamps: indices.map(i => candles[i].timestamp),
    from: { timestamp: candles[first].timestamp, price: p0 },
    to: { timestamp: candles[last].timestamp, price: p1 },
  };
}

/**
 * THE TIMEFRAMES THIS IS OFFERED ON, and the numbers behind each.
 *
 * From the owner's own answers on 28 blind charts, not from a guess about what traders like:
 *
 *     15m    0 of 4 structure      never offered - a product decision, not a setting
 *     1h     0.63                  ambivalent; round 2's 1h cells were four "maybe" answers
 *     4h     0.94                  ship
 *     1d     2 of 3                ship
 *
 * **15m is absent rather than configurable.** He said no to all four, and a setting would invite
 * someone to turn it on. 1h is excluded for now and is the open edge: it is a later question with
 * real usage behind it, not a number to pick today.
 */
export const DRAW_STRUCTURE_TFS = ['4h', '1d'] as const;

/* TIED TO THE CHART'S OWN TIMEFRAME TYPE, the same assertion `lib/limits.ts` uses.
 *
 * The first version of this list included `'1w'`, which this app does not have - the chart stops
 * at `1d`. A string list would have shipped a timeframe that can never match, so the button would
 * simply never appear and nothing would say why. Type-only import, so no runtime dependency on a
 * component from `lib/`. */
type IsChartTf<T extends import('../components/KLineProChart.tsx').ChartTf> = T;
const _drawTfsAreReal: IsChartTf<(typeof DRAW_STRUCTURE_TFS)[number]> = '4h';
void _drawTfsAreReal;

/**
 * Whether the button appears at all for a timeframe.
 *
 * **`2h` is absent and that is not an oversight.** "4h and above" reads as if it included it, but
 * the owner never saw a 2-hour chart - his 28 answers covered 15m, 1h, 4h and 1d. 2h is untested
 * in exactly the way 1h is, so it is excluded by the same rule rather than included by rounding.
 */
export function drawStructureAvailable(tf: string): boolean {
  return (DRAW_STRUCTURE_TFS as readonly string[]).includes(tf);
}
