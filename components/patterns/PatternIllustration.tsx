/* Idealised drawings of each chart pattern, for a beginner who has never seen one named.
 *
 * The owner's ask: a beginner needs "A PICTURE of what a bull flag is" - and specifically the clean
 * textbook shape, not a messy real one. So none of this is generated from live data. Each drawing
 * is the same every render, which is also what lets a spec assert the whole shape.
 *
 * ── THREE RULES, EACH ONE A LESSON FROM SOMEWHERE ELSE IN THIS CODEBASE ─────────────────────────
 *
 * NO PROPS. Not a style preference: a component that takes no input cannot render differently from
 * one call site to another, so "the same picture every time" is enforced by the type rather than by
 * a convention someone has to keep. It also means a source-reading cell can assert the geometry.
 *
 * `currentColor` ONLY - no hex, no `var(--...)` baked into a path. `components/KLineProChart.tsx`
 * records why for overlays: a colour chosen where the thing is created survives a theme switch and
 * goes stale. Here the parent sets `color` and every stroke follows it, so light and dark both work
 * without this file knowing which is active. The same reason `lib/chartStructureOverlays.ts` keeps
 * colour out of `extendData`.
 *
 * NO TEXT INSIDE THE SVG. Every word a user reads comes from a label key (`PATTERN_<TYPE>_*`), so
 * copy stays translatable and QA can assert on it. A word baked into a path is untranslatable and
 * invisible to the copy cells - which is how a vendor name survived a sweep once already.
 *
 * ── WHAT THE DRAWINGS DELIBERATELY DO NOT SHOW ──────────────────────────────────────────────────
 *
 * No arrows out of the shape, no breakout, no target, no colour-coded up/down. A drawing that ends
 * in an arrow IS an outcome claim, however careful the words beside it are - and it is the claim
 * PRODUCT.md rule 1 forbids and the one a beginner would read first. The shape stops where the
 * measured geometry stops.
 *
 * Wedges and triangles are absent because they are no longer `PatternType`s at all - measured
 * unreachable, since a derived channel rail is parallel by construction. See
 * `UNDETECTABLE_PATTERN_TYPES` in `lib/chartPatterns.ts`. Drawing a shape the detector cannot find
 * would be a picture of a feature that does not exist.
 */
import type { PatternType } from '@/lib/chartPatterns';

/* One geometry, so the frame is identical across every drawing and the shapes are comparable when
   a user sees two of them. 120x72 is the panel's drawing slot at every breakpoint. */
const W = 120;
const H = 72;

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      width="100%"
      height="100%"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      /* Decorative: every word is in the label beside it, so a screen reader that announced this
         would read a shape it cannot convey and duplicate the text that follows. */
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

/* The rails are drawn at 1.5 and the price path thinner, so the LINES are the subject and the
   wiggle is context - the opposite emphasis from a real chart, and the right one here. */
const PATH = { strokeWidth: 1 as const, opacity: 0.55 };

function BullFlag() {
  return (
    <Frame>
      {/* pole, then a tight downward drift between two parallel rails */}
      <path d="M8 64 L40 16" {...PATH} />
      <path d="M40 16 L48 26 L56 20 L64 30 L72 24 L80 34" {...PATH} />
      <path d="M38 12 L82 30" />
      <path d="M42 26 L86 44" />
    </Frame>
  );
}

function BearFlag() {
  return (
    <Frame>
      <path d="M8 8 L40 56" {...PATH} />
      <path d="M40 56 L48 46 L56 52 L64 42 L72 48 L80 38" {...PATH} />
      <path d="M38 60 L82 42" />
      <path d="M42 46 L86 28" />
    </Frame>
  );
}

function ChannelRising() {
  return (
    <Frame>
      <path d="M12 58 L28 44 L44 50 L60 34 L76 40 L92 24 L108 30" {...PATH} />
      <path d="M8 50 L112 16" />
      <path d="M8 64 L112 30" />
    </Frame>
  );
}

function ChannelFalling() {
  return (
    <Frame>
      <path d="M12 14 L28 28 L44 22 L60 38 L76 32 L92 48 L108 42" {...PATH} />
      <path d="M8 8 L112 42" />
      <path d="M8 22 L112 56" />
    </Frame>
  );
}

function Range() {
  return (
    <Frame>
      <path d="M12 50 L26 22 L40 50 L54 22 L68 50 L82 22 L96 50 L108 36" {...PATH} />
      <path d="M8 20 L112 20" />
      <path d="M8 52 L112 52" />
    </Frame>
  );
}

function LineSupport() {
  return (
    <Frame>
      {/* price above a rising line, touching it from above three times */}
      <path d="M12 46 L26 30 L40 42 L54 26 L68 38 L82 22 L96 34 L108 20" {...PATH} />
      <path d="M8 52 L112 22" />
    </Frame>
  );
}

function LineResistance() {
  return (
    <Frame>
      {/* price below a falling line, touching it from below three times */}
      <path d="M12 26 L26 42 L40 30 L54 46 L68 34 L82 50 L96 38 L108 52" {...PATH} />
      <path d="M8 20 L112 50" />
    </Frame>
  );
}

/** Every pattern this layer can draw - TOTAL over `PatternType`, so a shape with no drawing does
 *  not compile.
 *
 *  This was `Partial`, for a reason that was sound while wedges and triangles were members of
 *  `PatternType`: a total record would have forced a picture of a shape nothing can produce. Those
 *  five are no longer members (see `UNDETECTABLE_PATTERN_TYPES`), so the honest version of that
 *  argument is now the total record - the vocabulary lists only producible shapes, and every one of
 *  them must have a drawing. "We cannot find this shape" is expressed by not being a `PatternType`,
 *  which is where it belongs, rather than by a null the caller has to remember to handle. */
export const PATTERN_ILLUSTRATIONS: Record<PatternType, React.JSX.Element> = {
  bull_flag: <BullFlag />,
  bear_flag: <BearFlag />,
  channel_rising: <ChannelRising />,
  channel_falling: <ChannelFalling />,
  range: <Range />,
  line_support: <LineSupport />,
  line_resistance: <LineResistance />,
};

/** The drawing for a pattern. Never null now that the record is total - a `PatternType` without a
 *  drawing is a build error, not a blank box at runtime.
 *
 *  ELEMENTS, NOT COMPONENT FUNCTIONS. Returning a factory meant the caller looked a component up at
 *  runtime and rendered `<Illustration />`, which is creating a component during render - React can
 *  remount it on any re-render and the lint rule that caught it is right to. These take no props and
 *  are deterministic, so one element each, built once at module scope, is both correct and simpler. */
export function illustrationFor(type: PatternType): React.JSX.Element {
  return PATTERN_ILLUSTRATIONS[type];
}
