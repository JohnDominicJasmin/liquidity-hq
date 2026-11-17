/* A READ'S PROSE MUST NOT CONTRADICT THE NUMBERS IT WAS GIVEN (PM audit 2026-11-17: a BTC Quick read said "price below EMA9 / below VWAP" while price was above both).
 *
 * The prompt already carries the inputs as text ("Last Close: $64,120", "EMA 9: $63,980", "price ABOVE VWAP"), so they are read back out of the PROMPT here, the same place the other
 * result checks in lib/grok.ts read from. A clause that states the opposite of one of them is DROPPED (never shown, and not replaced by "unavailable" for one clause); what was dropped is
 * returned so the caller records it. Pure, no I/O. */

export interface ReadInputs {
  /** The chart's last close, or null when the prompt has none. */
  close: number | null;
  ema9: number | null;
  /** 'above' | 'below' as the prompt states the price against its VWAP, or null. */
  vwapSide: 'above' | 'below' | null;
}

function money(s: string | undefined): number | null {
  if (!s) return null;
  const n = Number(s.replace(/,/g, ''));
  return Number.isFinite(n) ? n : null;
}

/** The three inputs the prose is checked against, read from the finished prompt text. */
export function extractReadInputs(prompt: string): ReadInputs {
  const close = money(/Last Close:\s*\$([\d,]+(?:\.\d+)?)/.exec(prompt)?.[1]);
  const ema9 = money(/EMA 9:\s*\$([\d,]+(?:\.\d+)?)/.exec(prompt)?.[1]);
  const v = /price\s+(ABOVE|BELOW)\s+VWAP/i.exec(prompt)?.[1]?.toLowerCase();
  return { close, ema9, vwapSide: v === 'above' || v === 'below' ? v : null };
}

/** A price within this fraction of EMA9 is too close to call: no claim about which side it is on is treated as wrong. */
const EMA9_TOLERANCE = 0.0005;

const CLAIM = /\b(?:price\s+(?:is\s+|has\s+)?)?(below|under|above|over)\s+(?:the\s+)?(EMA\s?9|9[\s-]?EMA|VWAP)\b/gi;

function contradicts(clause: string, inputs: ReadInputs): boolean {
  CLAIM.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CLAIM.exec(clause)) !== null) {
    const claimedBelow = /^(below|under)$/i.test(m[1]);
    const target = m[2].toUpperCase().replace(/[\s-]/g, '');
    if (target === 'VWAP') {
      if (inputs.vwapSide && ((inputs.vwapSide === 'above') === claimedBelow)) return true;
    } else if (inputs.close != null && inputs.ema9 != null && inputs.ema9 > 0) {
      const gap = (inputs.close - inputs.ema9) / inputs.ema9;
      if (Math.abs(gap) > EMA9_TOLERANCE && ((gap > 0) === claimedBelow)) return true;
    }
  }
  return false;
}

/** The text with every clause that states the wrong side of EMA9 or VWAP removed, plus the clauses removed. Clauses are split on , ; / " - " and " and ". */
export function dropContradictingClauses(text: string, inputs: ReadInputs): { text: string; dropped: string[] } {
  if (!text || (inputs.vwapSide == null && (inputs.close == null || inputs.ema9 == null))) return { text, dropped: [] };
  const dropped: string[] = [];
  const sentences = text.split(/(?<=[.!?])\s+/);
  const out: string[] = [];
  for (const sentence of sentences) {
    const parts = sentence.split(/(\s*[,;/]\s*|\s+-\s+|\s+and\s+)/);
    // parts alternates clause, separator, clause, ...
    const kept: string[] = [];
    let pendingSep = '';
    let removedAny = false;
    for (let i = 0; i < parts.length; i += 2) {
      const clause = parts[i];
      const sepAfter = parts[i + 1] ?? '';
      if (clause && contradicts(clause, inputs)) {
        dropped.push(clause.trim());
        removedAny = true;
        continue;
      }
      if (kept.length > 0) kept.push(pendingSep);
      kept.push(clause);
      pendingSep = sepAfter;
    }
    if (!removedAny) { out.push(sentence); continue; }
    let rebuilt = kept.join('').trim();
    rebuilt = rebuilt.charAt(0).toUpperCase() + rebuilt.slice(1);
    if (rebuilt) out.push(/[.!?]$/.test(rebuilt) ? rebuilt : rebuilt + '.');
  }
  return { text: out.join(' '), dropped };
}
