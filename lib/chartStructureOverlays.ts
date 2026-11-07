/* Chart structures, Phase 1 rendering (#1818) - turning measured structures into overlay
 * descriptors, WITHOUT importing klinecharts or touching a chart instance.
 *
 * WHY A PURE ADAPTER RATHER THAN CODE INSIDE KLineProChart. Everything in this feature that could
 * be measured has been, and the half that could not be measured is where the defects were found by
 * someone else. So the mapping from `DetectedStructure[]` to what `createOverlay` is handed is
 * written here, where a spec can assert it against plain objects, and the component does the one
 * thing only it can do: call the chart.
 *
 * It also keeps the visual change separable. Anything the owner SEES needs his sign-off, and that
 * is a different review from "does the adapter put the line through the right candles". This file
 * can land and be tested without changing a pixel.
 *
 * ── WHAT THIS FILE MUST GET RIGHT, because the component cannot fix any of it ─────────────────
 *
 * `lock: true` ON EVERY DESCRIPTOR, and it is not a style choice. `components/KLineProChart.tsx`
 * records what happens without it: klinecharts treats an unlocked overlay as a user-editable
 * drawing, so grabbing an EMA line dragged it off the price data, and with hundreds of points
 * there was no way back short of switching coin or timeframe to force a rebuild. Every overlay on
 * that chart representing DATA rather than a user drawing sets this - emaSignal, reversalWarning,
 * srLevelLine, gexLevelLine, analysisLevelLine - and a structure rail is data.
 *
 * NO COLOUR IN `extendData`, which is the same file's other hard-won rule: an overlay is created
 * once and only its points are overridden afterwards, so a colour chosen at creation survives a
 * theme switch and goes stale. `createPointFigures` runs per repaint and reads the current theme.
 * So this adapter carries FACTS and the component carries appearance.
 *
 * OWN GROUP, SEPARATE FROM USER DRAWINGS. The chart already removes by group
 * (`getOverlays({ groupId: DRAWING_GROUP })`), so structures need a group of their own or clearing
 * them would delete whatever the user drew by hand. `STRUCTURE_GROUP` is that group, and each
 * structure additionally gets its own `structureId` in `extendData` so one structure's rails and
 * markers can be removed together without a second bookkeeping map in the component.
 *
 * ── DESCRIPTIVE, NEVER PREDICTIVE (the standing guardrail on this feature) ────────────────────
 *
 * `summary` is built only from what was measured: the kind, how many candles touched, and how long
 * ago. There is no target, no entry, no direction to trade, and no confidence or score - a
 * component cannot render a number it was never handed, which is the reasoning
 * `lib/drawStructure.ts` gives for omitting its own confidence field.
 *
 * `invalidationPrice` is passed through as DATA but deliberately kept OUT of `summary`, so a
 * caller has to decide to show it and phrase it. It is the structure's own line at the newest
 * candle - the price at which what was measured stops being present - and it is one careless
 * label away from reading as a stop loss.
 *
 * NO VENDOR OR MODEL NAME anywhere, per the owner's standing rule. Nothing here names one, and
 * nothing here should: this layer is the measured half, which has no vendor in it at all.
 *
 * ── THE GUARANTEE THE OVERLAY RESTS ON, stated honestly ───────────────────────────────────────
 *
 * The marked candles come from `rail.pivots`, which `lib/chartStructureDetect.ts` fills with the
 * pivots within tolerance of the rail. **On the SLOPED path that is currently the same set as the
 * pivots the line was fitted through** - QA measured 250 configurations and found the two sets
 * never diverge, because a displaced pivot is either refused by R-squared or absorbed by the
 * re-fitted line. So the real guarantee that a marked candle sits on its line comes from
 * `MIN_PIVOTS_ON_RAIL`, not from that field, and this comment says so rather than claiming a
 * protection the field does not currently provide. The field becomes load-bearing if the gates
 * ever change; it is not what is holding today.
 */
import type { DetectedStructure, StructureRail } from './chartStructureDetect.ts';

/** The overlay group every structure belongs to. Separate from the chart's user-drawing group so
 *  clearing structures never deletes something the user drew. */
export const STRUCTURE_GROUP = 'lhq-structure';

/** Registered overlay names. The component registers these once at module level, the same way it
 *  already does for srLevelLine and emaSignal. */
export const RAIL_OVERLAY = 'structureRail';
export const TOUCH_OVERLAY = 'structureTouch';

/** A point in chart coordinates. `{ timestamp, value }` is klinecharts' own shape, which is why
 *  overlays survive pan and zoom - see the proposal's §"a chart that can be drawn on". */
export interface OverlayPoint {
  timestamp: number;
  value: number;
}

/** What a rail's or marker's `extendData` carries. FACTS ONLY - see the header on colour. */
export interface StructureOverlayData {
  /** Groups one structure's rails and markers so they can be removed together. */
  structureId: string;
  kind: DetectedStructure['kind'];
  timeframe: string;
  /** Which gate admitted this rail: `'sloped'`, `'horizontal'` or `'derived'`. Carried so a label
   *  can avoid implying a derived rail was fitted - it was constructed from the anchor's slope. */
  gate: StructureRail['gate'];
  side: StructureRail['side'];
  touchCount: number;
  pivotsOnRail: number;
  excessTouches: number;
  /** Null on a derived rail, and that is meaningful rather than missing: no slope was fitted, so
   *  there is nothing for an R-squared to describe. A label should omit it, not print "null". */
  r2: number | null;
  barsSinceLastTouch: number;
  ageBars: number;
  /** DATA, not label text. See the header. */
  invalidationPrice: number;
  /** Plain-language, measured, no prediction. Safe to render as-is. */
  summary: string;
}

export interface StructureOverlayDescriptor {
  name: typeof RAIL_OVERLAY | typeof TOUCH_OVERLAY;
  groupId: typeof STRUCTURE_GROUP;
  /** Always true - see the header. Typed as the literal so a descriptor with it off cannot be
   *  constructed by mistake. */
  lock: true;
  points: OverlayPoint[];
  extendData: StructureOverlayData;
  /** Higher paints on top. Markers sit above rails so a touch is visible where they cross. */
  zLevel: number;
}

const RAIL_Z = 10;
const TOUCH_Z = 11;

/** How many candles touched, in words, with no claim about what happens next.
 *
 *  SIX KINDS OF SENTENCE AND NOT ONE OF THEM PREDICTS. A range and a channel read as the shape
 *  plus its evidence; a trendline names the side so "resistance" and "support" are not implied by
 *  position alone. "Last touched N bars ago" is the staleness figure §5 asks for - a structure
 *  last touched 200 bars ago is history, and the sentence should say so rather than let a drawn
 *  line imply currency. */
function describe(s: DetectedStructure): string {
  const touches = s.rails.reduce((n, r) => n + r.quality.touchCount, 0);
  const rising = s.rails[0].fit.slope > 0;
  const shape =
    s.kind === 'range' ? 'sideways range'
      : s.kind === 'channel' ? (rising ? 'rising channel' : 'falling channel')
        : s.rails[0].side === 'high' ? (rising ? 'rising resistance line' : 'falling resistance line')
          : (rising ? 'rising support line' : 'falling support line');
  const touched = `${touches} ${touches === 1 ? 'touch' : 'touches'}`;
  const when = s.barsSinceLastTouch === 0
    ? 'touching now'
    : `last touched ${s.barsSinceLastTouch} ${s.barsSinceLastTouch === 1 ? 'bar' : 'bars'} ago`;
  return `${shape} on ${s.timeframe} - ${touched}, ${when}`;
}

/** A stable id for one structure within one detection pass. Not a hash of the geometry: two
 *  structures in one pass differ by kind and index, and an id that changed when a price moved
 *  would defeat the component's ability to override an overlay rather than recreate it. */
function structureIdFor(s: DetectedStructure, index: number): string {
  return `${s.timeframe}:${s.kind}:${index}`;
}

function dataFor(s: DetectedStructure, rail: StructureRail, structureId: string): StructureOverlayData {
  return {
    structureId,
    kind: s.kind,
    timeframe: s.timeframe,
    gate: rail.gate,
    side: rail.side,
    touchCount: rail.quality.touchCount,
    pivotsOnRail: rail.pivotsOnRail,
    excessTouches: rail.excessTouches,
    r2: rail.fit.r2,
    barsSinceLastTouch: s.barsSinceLastTouch,
    ageBars: s.ageBars,
    invalidationPrice: s.invalidationPrice,
    summary: describe(s),
  };
}

/**
 * Overlay descriptors for a detection result: two points per rail, plus one marker per candle the
 * rail was drawn through.
 *
 * THE MARKERS ARE THE HONEST PART OF THIS FEATURE. A drawn line is a claim, and the only way a
 * user can check it is to see WHICH candles it was drawn through - the same reasoning
 * `lib/drawStructure.ts` gives for keeping `touchTimestamps` on a model-proposed structure. A rail
 * with no markers is a line asking to be trusted.
 *
 * Returns `[]` for an empty result. A caller clears the group and draws what comes back, so
 * "nothing cleared the thresholds" renders as an empty chart rather than as a stale structure -
 * which is the §Non-negotiable rule that a stale line is worse than no line.
 */
export function toStructureOverlays(
  structures: readonly DetectedStructure[],
): StructureOverlayDescriptor[] {
  const out: StructureOverlayDescriptor[] = [];

  structures.forEach((s, index) => {
    const structureId = structureIdFor(s, index);

    for (const rail of s.rails) {
      /* Two points. A rail is a straight line and klinecharts extends between the points it is
         given; handing it every touched candle would make it a polyline that happens to look
         straight, and a single bad point would then bend it visibly. */
      if (!Number.isFinite(rail.from.price) || !Number.isFinite(rail.to.price)) continue;

      out.push({
        name: RAIL_OVERLAY,
        groupId: STRUCTURE_GROUP,
        lock: true,
        points: [
          { timestamp: rail.from.timestamp, value: rail.from.price },
          { timestamp: rail.to.timestamp, value: rail.to.price },
        ],
        extendData: dataFor(s, rail, structureId),
        zLevel: RAIL_Z,
      });

      for (const pivot of rail.pivots) {
        if (!Number.isFinite(pivot.price)) continue;
        out.push({
          name: TOUCH_OVERLAY,
          groupId: STRUCTURE_GROUP,
          lock: true,
          points: [{ timestamp: pivot.timestamp, value: pivot.price }],
          extendData: dataFor(s, rail, structureId),
          zLevel: TOUCH_Z,
        });
      }
    }
  });

  return out;
}
