/* LIMITS ON FREE TEXT THAT GOES INTO AN AI PROMPT (security audit #1413, 2026-11-14).
 * thesis-check, strategy-research and pine-script took text with no maximum, so one request could carry a huge prompt (cost abuse). The Arena's own AI routes already cap
 * at 64k; these are the tighter, per-field limits for the three tool routes. */
export const AI_TOOL_LIMITS = {
  /** A strategy / thesis / description a person types. */
  text: 4000,
  /** The analysis text pine-script is given to turn into code. */
  analysis: 20000,
  assumptions: 20,
  assumption: 500,
  symbol: 20,
  shortField: 40,
} as const;

/** A string within `max`, trimmed, or null when it is not a string or is too long. */
export function boundedString(v: unknown, max: number): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length <= max ? t : null;
}
