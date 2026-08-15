/* Every colour decision on Arena, in one place (#413).
 *
 * Spec: design_handoff_arena/specs/arena.md §Colour is data.
 *
 * WHY A LIBRARY, AND WHY THIS ONE MATTERS MOST.
 *
 * QA mapped the spec's 31 criteria and found 11 automated and 20 not. Criteria
 * 12-18 - colour as data - are in the group where "a defect reaches dev
 * unopposed", because no stub exists to drive a coloured state and inspection
 * is the only check. Pure functions with tests are the only opposition
 * available.
 *
 * And this is the failure that hides best. From the spec:
 *
 *   "Colouring them green would look better, be wrong, and pass every
 *    automated check - --green is a legal token."
 *
 * A fully-coloured Arena passes design-tokens.spec.ts, passes contrast, passes
 * the palette check, and lies about every quiet signal on the screen. The only
 * thing that catches it is a rule stated as data.
 *
 * THE ONE RULE THAT GENERALISES: direction is not the sign of the number.
 * Crowded-long funding is +0.0132% and red. Overbought RSI is high and red. A
 * cleared penalty is a good outcome rendered quiet, not green. Sign maps to
 * colour in exactly one place on this route - the ticker - because a price
 * change genuinely is directional.
 */

export type Token =
  | 'var(--green)' | 'var(--red)' | 'var(--accent)'
  | 'var(--txt)' | 'var(--txt2)' | 'var(--txt3)' | 'var(--mark-idle)';

export interface Painted { value: Token; marker: Token; background?: string }

const GREEN: Token = 'var(--green)';
const RED:   Token = 'var(--red)';
const TXT:   Token = 'var(--txt)';
const TXT2:  Token = 'var(--txt2)';
const TXT3:  Token = 'var(--txt3)';
const IDLE:  Token = 'var(--mark-idle)';
const ACC:   Token = 'var(--accent)';

/* ── evidence rows ───────────────────────────────────────────────────────── */

/** `fire` decides, never the sign. A missing value is --txt2, not a zero. */
export function evidencePaint(fire: 'green' | 'red' | null, hasValue: boolean): Painted {
  if (!hasValue)     return { value: TXT2,  marker: IDLE };
  if (fire === 'green') return { value: GREEN, marker: GREEN };
  if (fire === 'red')   return { value: RED,   marker: RED };
  return { value: TXT, marker: IDLE };
}

/* ── verdict ─────────────────────────────────────────────────────────────── */

export type VerdictDir = 'bull' | 'bear' | 'neutral' | null;

/**
 * The verdict string and its confidence fill.
 *
 * Green in the frame because the fixture is bullish. NOT a green element - the
 * frame draws both variants so the switch is visible, and hardcoding green
 * would lie on every bearish read while passing every check we own.
 */
export function verdictPaint(dir: VerdictDir): Token {
  if (dir === 'bull') return GREEN;
  if (dir === 'bear') return RED;
  return TXT2;   // neutral, mixed, or no read
}

/* ── confluence factors ──────────────────────────────────────────────────── */

export type FactorKind =
  | { kind: 'directional'; dir: 'bull' | 'bear' | 'neutral' }
  | { kind: 'penalty'; active: boolean };

/**
 * Colour is the VOTE, not the sign.
 *
 * A cleared penalty is a good outcome rendered QUIET. It is not green - green
 * means a factor voted bullish, and a penalty that did not fire cast no vote.
 * Getting that wrong makes an inactive risk look like a positive signal.
 */
export function factorPaint(f: FactorKind): Painted {
  if (f.kind === 'penalty') {
    return f.active
      ? { value: ACC, marker: ACC, background: 'rgba(217,166,38,.06)' }
      : { value: TXT3, marker: IDLE };
  }
  if (f.dir === 'bull') return { value: GREEN, marker: GREEN };
  if (f.dir === 'bear') return { value: RED,   marker: RED };
  return { value: TXT3, marker: IDLE };
}

/* ── multi-timeframe ─────────────────────────────────────────────────────── */

export const MTF_BULL = 57;
export const MTF_BEAR = 43;

/** Thresholds, not sign: 50 is not bullish, 57 is. */
export function mtfPaint(rsi: number | null): { label: string; colour: Token } {
  if (rsi === null)      return { label: 'NO DATA', colour: TXT3 };
  if (rsi > MTF_BULL)    return { label: 'BULLISH', colour: GREEN };
  if (rsi < MTF_BEAR)    return { label: 'BEARISH', colour: RED };
  return { label: 'NEUTRAL', colour: TXT3 };
}

/* ── market structure ────────────────────────────────────────────────────── */

/**
 * Colour carries DIRECTION only.
 *
 * A CHoCH is not more significant in colour than a BOS - the label carries
 * significance, the colour carries which way. Colouring CHoCH differently
 * would encode importance in a channel already used for direction.
 */
export function structurePaint(dir: 'up' | 'down'): Token {
  return dir === 'up' ? GREEN : RED;
}

/* ── EMA conditions ──────────────────────────────────────────────────────── */

export function emaConditionPaint(pass: boolean): { glyph: string; glyphColour: Token; labelColour: Token } {
  return pass
    ? { glyph: '✓', glyphColour: GREEN, labelColour: TXT }
    : { glyph: '✕', glyphColour: RED,   labelColour: TXT2 };
}

/** The four EMA averages are ALWAYS --txt. Line colour is a chart concern. */
export const EMA_VALUE_COLOUR: Token = TXT;

/* ── clusters ────────────────────────────────────────────────────────────── */

/**
 * Cluster bars take SIDE, not size.
 *
 * Below spot is long liquidations (--red), above is short (--green). Scaling
 * colour by size would make a big cluster look like a strong signal when what
 * it encodes is which side gets liquidated.
 */
export function clusterPaint(clusterPrice: number, spot: number): Token {
  return clusterPrice < spot ? RED : GREEN;
}

/* ── prices are never signals ────────────────────────────────────────────── */

/** Entry / Stop / Target are --txt always. They are prices, not signals. */
export const LEVEL_COLOUR: Token = TXT;

/* ── the boundary ────────────────────────────────────────────────────────── */

/**
 * The only regions on this route permitted to render --green or --red.
 *
 * Exported so a test can assert the boundary rather than trusting each call
 * site - the spec ends its colour section with exactly this list, and anything
 * outside it rendering a signed colour is a defect.
 */
export const COLOUR_PERMITTED_REGIONS = [
  'ticker', 'verdict', 'evidence', 'confluence',
  'mtf', 'structure', 'ema-conditions', 'clusters',
] as const;
