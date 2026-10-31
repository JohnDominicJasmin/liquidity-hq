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
 * TIMESTAMPS RATHER THAN INDICES, because an index is only meaningful against an array whose
 * ordering the model has to trust itself to have preserved. A timestamp is checkable: the scorer
 * maps it back, and a timestamp that is not in the window is a detectable invention rather than an
 * off-by-one.
 */

/** The JSON contract. Kept as a string in the prompt AND parsed by the scorer, so there is one
 *  definition of the shape rather than a prompt and a parser that can drift apart. */
export const SCHEMA = `{
  "structures": [
    {
      "type": "trendline" | "channel" | "flag" | "triangle" | "horizontal",
      "side": "high" | "low",
      "touchTimestamps": [<integer ms>, ...],
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
    'For each structure, list the exact timestamps of the candles you claim touch it. Use only',
    'timestamps that appear above. A trendline or horizontal level needs at least 3 touch points;',
    'a channel, flag or triangle needs at least 3 on the side you name.',
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
  const valid = new Set(candles.map(c => c.timestamp));
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
    const ts = Array.isArray(s?.touchTimestamps) ? s.touchTimestamps.map(Number) : [];
    const kept = ts.filter(t => valid.has(t));
    out.invalidTimestamps += ts.length - kept.length;
    out.structures.push({
      type: typeof s?.type === 'string' ? s.type : 'unknown',
      side: s?.side === 'high' || s?.side === 'low' ? s.side : null,
      touchTimestamps: kept,
      claimedTimestamps: ts.length,
      confidence: Number.isFinite(Number(s?.confidence)) ? Number(s.confidence) : null,
    });
  }
  return out;
}
