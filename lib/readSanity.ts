/* A READ'S PROSE MUST NOT CONTRADICT THE NUMBERS IT WAS GIVEN (PM audit 2026-11-17: a BTC Quick read said "price below EMA9 / below VWAP" while price was above both, and "price below both EMA9 and SMA200"
 * when it was above EMA9).
 *
 * The prompt already carries the inputs as text ("Last Close: $64,120", "EMA 9: $63,980", "SMA 200: $...", "price ABOVE VWAP"), so they are read back out of the PROMPT here, the same place the other result
 * checks in lib/grok.ts read from. What is wrong is fixed in the prose, never shown:
 *   - "below both A and B" where only A is wrong becomes "below B" (the true half stays);
 *   - a claim that is wrong in full drops its CLAUSE (clauses split on , ; / " - " and " and ");
 *   - a sentence whose first clause went, or that is left with fewer than five words, is dropped whole rather than shown as a broken fragment.
 * What was dropped or changed is returned so the caller records it. Pure, no I/O. */

export interface ReadInputs {
  close: number | null;
  ema9: number | null;
  sma200: number | null;
  /** 'above' | 'below' as the prompt states the price against its VWAP, or null. */
  vwapSide: 'above' | 'below' | null;
}

function money(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The inputs the prose is checked against, read from the finished prompt text. */
export function extractReadInputs(prompt: string): ReadInputs {
  const close = money(/Last Close:\s*\$([\d,]+(?:\.\d+)?)/.exec(prompt)?.[1]);
  const ema9 = money(/EMA 9:\s*\$([\d,]+(?:\.\d+)?)/.exec(prompt)?.[1]);
  const sma200 = money(/SMA 200:\s*\$([\d,]+(?:\.\d+)?)/.exec(prompt)?.[1]);
  const v = /price\s+(ABOVE|BELOW)\s+VWAP/i.exec(prompt)?.[1]?.toLowerCase();
  return { close, ema9, sma200, vwapSide: v === 'above' || v === 'below' ? v : null };
}

/** A price within this fraction of a moving average is too close to call: no claim about which side it is on is treated as wrong. */
const TOLERANCE = 0.0005;

type Target = 'ema9' | 'sma200' | 'vwap';
const T = String.raw`(?:EMA\s?9|9[\s-]?EMA|SMA\s?200|200[\s-]?(?:day\s+)?SMA|VWAP)`;
const FILLER = String.raw`(?:(?:both|the|its|a|1h|4h|1d|15m|5m|daily|current)\s+)*`;
// verb, filler words, a target, and optionally "and <target>" (the "below both A and B" form)
const CLAIM_SRC = String.raw`\b(below|under|above|over)\s+` + FILLER + `(${T})(?:\\s+and\\s+(${T}))?`;

function targetOf(raw: string): Target {
  const u = raw.toUpperCase();
  if (u.includes('VWAP')) return 'vwap';
  if (u.includes('SMA')) return 'sma200';
  return 'ema9';
}

/** true when the claim "<below|above> <target>" is the WRONG side for these inputs; false when right or unknowable. */
function wrong(claimedBelow: boolean, target: Target, inputs: ReadInputs): boolean {
  if (target === 'vwap') {
    return inputs.vwapSide != null && ((inputs.vwapSide === 'above') === claimedBelow);
  }
  const ref = target === 'ema9' ? inputs.ema9 : inputs.sma200;
  if (inputs.close == null || ref == null || !(ref > 0)) return false;
  const gap = (inputs.close - ref) / ref;
  return Math.abs(gap) > TOLERANCE && ((gap > 0) === claimedBelow);
}

const WRONG_MARK = '\u0000';

/** Pass 1: fix paired claims in place and mark claims that are wrong in full. */
function markClaims(sentence: string, inputs: ReadInputs): { text: string; changed: string[] } {
  const changed: string[] = [];
  const re = new RegExp(CLAIM_SRC, 'gi');
  const text = sentence.replace(re, (whole: string, verb: string, a: string, b: string | undefined) => {
    const below = /^(below|under)$/i.test(verb);
    const aWrong = wrong(below, targetOf(a), inputs);
    if (!b) return aWrong ? WRONG_MARK : whole;
    const bWrong = wrong(below, targetOf(b), inputs);
    if (aWrong && bWrong) return WRONG_MARK;
    if (aWrong) { changed.push(whole); return `${verb} ${b}`; }
    if (bWrong) { changed.push(whole); return `${verb} ${a}`; }
    return whole;
  });
  return { text, changed };
}

export interface SanityResult { text: string; dropped: string[] }

/** The text with wrong sides of EMA9 / SMA200 / VWAP fixed or removed, plus what was fixed or removed. */
export function dropContradictingClauses(text: string, inputs: ReadInputs): SanityResult {
  const known = inputs.vwapSide != null || (inputs.close != null && (inputs.ema9 != null || inputs.sma200 != null));
  if (!text || !known) return { text, dropped: [] };
  const dropped: string[] = [];
  const out: string[] = [];
  for (const sentence of text.split(/(?<=[.!?])\s+/)) {
    const marked = markClaims(sentence, inputs);
    for (const c of marked.changed) dropped.push(c.trim());
    if (!marked.text.includes(WRONG_MARK)) { out.push(marked.text); continue; }
    // clauses alternate with their separators
    const parts = marked.text.split(/(\s*[,;/]\s*|\s+-\s+|\s+and\s+)/);
    const kept: string[] = [];
    let pendingSep = '';
    let firstDropped = false;
    for (let i = 0; i < parts.length; i += 2) {
      const clause = parts[i];
      const sepAfter = parts[i + 1] ?? '';
      if (clause.includes(WRONG_MARK)) {
        dropped.push(clause.replace(new RegExp(WRONG_MARK, 'g'), '(wrong side)').trim());
        if (i === 0) firstDropped = true;
        continue;
      }
      if (kept.length > 0) kept.push(pendingSep);
      kept.push(clause);
      pendingSep = sepAfter;
    }
    const rebuilt = kept.join('').trim();
    // a sentence that lost its head, or is a stub, is dropped whole instead of shown as a fragment
    if (firstDropped || rebuilt.split(/\s+/).filter(Boolean).length < 5) continue;
    out.push(/[.!?]$/.test(rebuilt) ? rebuilt : rebuilt + '.');
  }
  return { text: out.join(' '), dropped };
}

/* ── THE LANGUAGE-INDEPENDENT HALF (QA review of #2569, PM 2026-11-18) ─────────────────────────────────────────────────────────────
 *
 * dropContradictingClauses above reads English direction words ("below", "above"), so a read written in ko/zh/ru/ar passed through it
 * unchecked. These checks compare STRUCTURED things only - the side the model declares in its SIDES line, the price it writes next to an
 * indicator, and each level's type against the close - none of which depend on the language of the sentence around them. The indicator
 * names (EMA 9, SMA 200, VWAP) and the numbers stay in English and digits in every language, which is what makes them findable. */

export type ReadTarget = Target;

const TARGET_RX: Record<Target, RegExp> = {
  ema9: /EMA\s?9(?!\d)|(?<!\d)9[\s-]?EMA/gi,
  sma200: /SMA\s?200(?!\d)|(?<!\d)200[\s-]?(?:day\s+)?SMA/gi,
  vwap: /VWAP/gi,
};
const ANY_TARGET = /EMA\s?9(?!\d)|(?<!\d)9[\s-]?EMA|SMA\s?200(?!\d)|(?<!\d)200[\s-]?(?:day\s+)?SMA|VWAP/i;

/** The targets whose declared side (the model's SIDES line) is the wrong one for these inputs. */
export function misreadSides(sides: Partial<Record<Target, 'above' | 'below'>> | undefined, inputs: ReadInputs): Target[] {
  if (!sides) return [];
  return (Object.keys(sides) as Target[]).filter((t) => {
    const side = sides[t];
    return side != null && wrong(side === 'below', t, inputs);
  });
}

/** Sentence split that also knows the CJK and Arabic full stops; the end mark stays with its sentence. */
function sentences(text: string): string[] {
  return text.split(/(?<=[.!?。！？؟])\s*/).filter((s) => s.trim().length > 0);
}

/* A price written straight after an indicator name: "EMA9 ($63,980)", "EMA 9 на уровне 63 980", "VWAP 위 64,100". The gap may not contain
   another indicator name, a digit or a sentence end. A number followed by a letter or % (4h, 2%, 15m) is not a price. Spaces, commas and
   narrow no-break spaces are all thousands separators (ru writes 63 980). */
const PRICE_AFTER = /^[^\d.!?。！？؟\n]{0,24}?\$?\s?(\d{1,3}(?:[ ,  ]\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?)(?![\d%A-Za-z])/u;   // NOT \p{L}: a CJK character right after the number (zh/ko) must still count as the end of the price
/** A number this far from the input is wrong. */
const PRICE_TOLERANCE = 0.005;

/** The targets a sentence states a WRONG price for. A number outside 0.8x to 1.25x of the input is not taken as a price for it (a percentage, a count). */
function wrongPriceTargets(sentence: string, inputs: ReadInputs): Target[] {
  const out: Target[] = [];
  for (const t of ['ema9', 'sma200'] as const) {
    const ref = t === 'ema9' ? inputs.ema9 : inputs.sma200;
    if (ref == null || !(ref > 0)) continue;
    for (const m of sentence.matchAll(TARGET_RX[t])) {
      const after = sentence.slice((m.index ?? 0) + m[0].length);
      const gapEnd = after.search(ANY_TARGET);
      const window = gapEnd >= 0 ? after.slice(0, gapEnd) : after;
      const p = PRICE_AFTER.exec(window);
      if (!p) continue;
      const n = Number(p[1].replace(/[ ,  ]/g, ''));
      if (!Number.isFinite(n) || n / ref < 0.8 || n / ref > 1.25) continue;
      if (Math.abs(n - ref) / ref > PRICE_TOLERANCE) { out.push(t); break; }
    }
  }
  return out;
}

/** Drops every sentence that names a misread target (from SIDES) or states a wrong price for EMA9 / SMA200. Language-independent. */
export function dropStructuredContradictions(text: string, inputs: ReadInputs, misread: readonly Target[]): SanityResult {
  if (!text) return { text, dropped: [] };
  const dropped: string[] = [];
  const kept: string[] = [];
  for (const s of sentences(text)) {
    const named = misread.some((t) => { TARGET_RX[t].lastIndex = 0; return TARGET_RX[t].test(s); });
    if (named || wrongPriceTargets(s, inputs).length > 0) { dropped.push(s.trim()); continue; }
    kept.push(s.trim());
  }
  if (!dropped.length) return { text, dropped };
  // CJK and Arabic sentences are joined without a space, the way they are written; Latin and Cyrillic with one.
  const joiner = /[　-鿿가-힯]/.test(text) ? '' : ' ';
  return { text: kept.join(joiner), dropped };
}

/** A level whose TYPE contradicts the close: support clearly above price, or resistance clearly below it. */
export function levelContradictsClose(level: { price: number; type: 'support' | 'resistance' }, inputs: ReadInputs): boolean {
  const c = inputs.close;
  if (c == null || !(c > 0) || !(level.price > 0)) return false;
  const gap = (level.price - c) / c;
  return level.type === 'support' ? gap > 0.002 : gap < -0.002;
}
