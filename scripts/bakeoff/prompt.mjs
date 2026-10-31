/* THE ONE PROMPT BOTH ENGINES GET (#1818).
 *
 * **IDENTICAL BY CONSTRUCTION, because a comparison of two models given two prompts is not a
 * comparison of two models.** Both adapters import this and neither may alter it. The only
 * per-engine difference permitted anywhere in this harness is how the request is shaped for each
 * vendor's API - never the instruction or the data.
 *
 * COORDINATES, NOT PROSE. The model returns the exact candle timestamps it claims as touch
 * points, so our own geometry can check whether a line through them fits and whether those points
 * are pivots at all. A prose answer would make the scorer a reader rather than a calculator, and
 * then the result is a taste contest again.
 *
 * ── TWO THINGS IN HERE THAT LOOK LIKE DETAIL AND ARE THE EXPERIMENT ──────────────────────────
 *
 * **"none" IS AN EXPLICITLY CORRECT ANSWER, SAID ONCE AND WITHOUT ENCOURAGEMENT.** Group B is the
 * fabrication test, and the spec says it decides the result. Omitting the permission would measure
 * whether a model guesses that silence is allowed; repeating it or praising it would coach the
 * refusal and measure our prompt instead of the engine. One neutral sentence is the honest middle.
 *
 * **NO HINT OF WHICH GROUP A FIXTURE IS IN.** The window arrives with no coin name, no timeframe
 * and no group. A model told "this is a messy window" would be answering a different question, and
 * a model told the symbol could lean on what it remembers about that asset rather than on the
 * candles in front of it.
 *
 * ── INDICES, AND THIS FILE ASKED FOR TIMESTAMPS FIRST. THE CHANGE WAS FORCED BY A FAILED CONTROL
 *    AND IT IS THE MOST IMPORTANT THING IN THE FILE ──────────────────────────────────────────────
 *
 * The first version asked for the exact candle TIMESTAMP of each touch point, reasoning that a
 * timestamp is checkable while an index is only meaningful against an array whose ordering the
 * model has to trust itself to have preserved. **That reasoning is sound and it was wrong in
 * practice.** Measured on group A, which exists to catch exactly this:
 *
 *     200 candles, timestamps asked for      0 structures on all 3 fixtures, 3/3 runs
 *     + an index column in the TSV           0 structures
 *     + the refusal sentence removed         0 structures
 *     60 candles instead of 200              0 structures
 *     asked in PROSE, no coordinates         describes a downtrend, a consolidation near 1.00
 *                                            and an ascending channel in the final third
 *     INDICES instead of timestamps          6 structures, immediately
 *
 * **The model could see the structure the whole time and would not commit to 13-digit
 * millisecond numbers copied out of a 200-row table.** Returning nothing rather than inventing a
 * timestamp is defensible behaviour; the fault was the prompt's, and the cost was a total refusal
 * that looked like an engine finding no structure. The control is the only reason this surfaced
 * before 72 calls were spent on it.
 *
 * WHAT IS GIVEN UP, STATED RATHER THAN GLOSSED. An index outside `0..n-1` is as detectable as an
 * unknown timestamp, so invention is still caught. An index that is IN range but wrong is an
 * off-by-one the scorer cannot distinguish from a deliberate claim - that is the real price, and
 * it is worth paying, because the alternative measured zero answers from an engine that can
 * clearly do the task.
 */

/** The JSON contract. Kept as a string in the prompt AND parsed by the scorer, so there is one
 *  definition of the shape rather than a prompt and a parser that can drift apart. */
export const SCHEMA = `{
  "structures": [
    {
      "type": "trendline" | "channel" | "flag" | "triangle" | "horizontal",
      "side": "high" | "low",
      "touchIndices": [<integer 0..n-1>, ...],
      "confidence": <number 0..1>
    }
  ]
}`;

export const SYSTEM = [
  'You are a technical analyst reading raw OHLC candles.',
  'You answer only with JSON matching the given schema. No prose, no markdown fence, no explanation.',
].join(' ');

/**
 * The user message for one window.
 *
 * The candles are given as a compact TSV rather than JSON objects: ~200 rows of
 * `{"timestamp":...,"open":...}` is roughly four times the tokens for the same information, and
 * token count is one of the things this test measures.
 */
export function buildPrompt(candles) {
  const rows = candles.map(c =>
    `${c.timestamp}\t${c.open}\t${c.high}\t${c.low}\t${c.close}`).join('\n');

  return [
    `Below are ${candles.length} consecutive candles, oldest first, as TSV:`,
    'timestamp(ms)\topen\thigh\tlow\tclose',
    '',
    rows,
    '',
    'Identify every chart structure you can support from these candles: trendlines, channels,',
    'flags, triangles, horizontal levels.',
    '',
    'For each structure, list the index numbers of the candles you claim touch it. A trendline or',
    'horizontal level needs at least 3 touch points; a channel, flag or triangle needs at least 3',
    'on the side you name.',
    '',
    'If this window has no structure you can support from the candles, return an empty list.',
    'An empty list is a valid and correct answer.',
    '',
    `Reply with JSON only, matching exactly this schema:`,
    SCHEMA,
  ].join('\n');
}

/**
 * Parse a model reply into claims, tolerantly about FORMAT and strictly about CONTENT.
 *
 * Tolerant on format because a fence or a stray sentence is a formatting slip, and scoring it as a
 * fabrication would measure instruction-following rather than chart reading - which is a real
 * difference between engines but not the one being tested, so it is reported separately as
 * `formatRepairs`.
 *
 * Strict on content: a timestamp not present in the window is dropped and counted, because that is
 * the model inventing a candle rather than misreading one.
 */
export function parseReply(text, candles) {
  const out = { structures: [], formatRepaired: false, parseFailed: false, invalidTimestamps: 0 };

  let raw = (text ?? '').trim();
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) { raw = fence[1].trim(); out.formatRepaired = true; }
  if (!raw.startsWith('{')) {
    const brace = raw.indexOf('{');
    const last = raw.lastIndexOf('}');
    if (brace >= 0 && last > brace) { raw = raw.slice(brace, last + 1); out.formatRepaired = true; }
  }

  let parsed;
  try { parsed = JSON.parse(raw); } catch { out.parseFailed = true; return out; }
  if (!parsed || !Array.isArray(parsed.structures)) { out.parseFailed = true; return out; }

  for (const s of parsed.structures) {
    /* `touchTimestamps` is still read, so a model that answers the old way is not scored as
       having said nothing - a silent zero there is the failure this whole section is about. */
    const byTs = new Map(candles.map((c, i) => [c.timestamp, i]));
    const rawIdx = Array.isArray(s?.touchIndices) ? s.touchIndices.map(Number)
      : Array.isArray(s?.touchTimestamps) ? s.touchTimestamps.map(Number).map(t => byTs.get(t) ?? -1)
      : [];
    const kept = rawIdx.filter(i => Number.isInteger(i) && i >= 0 && i < candles.length);
    out.invalidTimestamps += rawIdx.length - kept.length;
    out.structures.push({
      type: typeof s?.type === 'string' ? s.type : 'unknown',
      side: s?.side === 'high' || s?.side === 'low' ? s.side : null,
      /* Mapped back to timestamps so everything downstream is unchanged and the scorer still
         reasons about candles rather than array positions. */
      touchTimestamps: kept.map(i => candles[i].timestamp),
      claimedTimestamps: rawIdx.length,
      confidence: Number.isFinite(Number(s?.confidence)) ? Number(s.confidence) : null,
    });
  }
  return out;
}
