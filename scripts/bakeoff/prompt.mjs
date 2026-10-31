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
 * ── THE ENGINE IS NEVER ASKED WHETHER STRUCTURE EXISTS. THAT IS THE DESIGN, AND IT IS THE
 *    SECOND DESIGN THIS FILE HAS HAD ─────────────────────────────────────────────────────────
 *
 * The first version said "an empty list is a valid and correct answer", once, neutrally, so group
 * B could be a fair fabrication test. **Measured, that sentence was not a permission but a
 * switch.** One A fixture, one B fixture, three phrasings:
 *
 *     "an empty list is a valid and correct answer"    A=0  B=0
 *     no mention of an empty list at all              A=3  B=3
 *     one symmetric factual clause                    A=0  B=0
 *
 * **Any mention of emptiness refused everything; no mention claimed structure on everything.** The
 * answer tracked two lines of my wording rather than the candles, so neither configuration could
 * separate A from B - the one thing the fabrication test had to do.
 *
 * **So the lever is removed rather than rephrased: the engine always returns exactly CANDIDATES
 * structures.** List length carries no information, so a permission sentence has nothing to act
 * on. What it reports instead is a CONFIDENCE per candidate, and the scorer asks whether
 * confidence RANKS group A above group B.
 *
 * **Why ranking and not level.** The level is still promptable - a sterner preamble lowers every
 * number, a looser one raises them - so scoring the level measures wording again, one layer down.
 * **A global shift moves A and B together and leaves the ranking untouched**, so a rank statistic
 * is prompt-robust by construction. PM's point, and the property Finding 2 says this test needs.
 *
 * It is also the better question for the product: "does it say 0.2 on noise and 0.8 on structure"
 * is what a trader's money depends on. A feature that draws a channel with no stated confidence
 * is the thing this project said it feared; one that ranks and quantifies can ship behind a
 * threshold.
 *
 * NO FIXTURE CARRIES ITS COIN, TIMEFRAME OR GROUP. A model told "this is a messy window" would be
 * answering a different question, and one told the symbol could lean on what it remembers about
 * that asset rather than the candles in front of it.
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

/** How many candidates the engine must always return. Fixed on purpose - see the header. */
export const CANDIDATES = 3;

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
  /* INDEX, not timestamp. The prompt asks for index numbers, so showing timestamps would ask the
     model to answer in a column it was never given - and asking for 13-digit numbers is exactly
     what produced a flat zero on group A. See Finding 1 in the header. */
  const rows = candles.map((c, i) =>
    `${i}\t${c.open}\t${c.high}\t${c.low}\t${c.close}`).join('\n');

  return [
    `Below are ${candles.length} consecutive candles, oldest first, as TSV:`,
    'index\topen\thigh\tlow\tclose',
    '',
    rows,
    '',
    `Return exactly ${CANDIDATES} candidate chart structures - your ${CANDIDATES} best guesses,`,
    'ranked most convincing first. Types: trendline, channel, flag, triangle, horizontal level.',
    '',
    'For each candidate, give the index numbers of the candles you claim touch it (at least 3),',
    'and a confidence between 0 and 1 for how well those candles support that structure.',
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
