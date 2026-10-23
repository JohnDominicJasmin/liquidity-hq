/* The Fear & Greed index, read from alternative.me's response shape - or null.
 *
 * In lib/ rather than beside its caller so it can be unit-tested directly, the same split as
 * lib/labelOverrides.ts and lib/lemonsqueezy.ts: the interesting decision should not need a
 * route, a fetch stand-in or credentials to exercise. (It also cannot be exported from a
 * route.ts: Next's generated route validator rejects exports that are not handlers.)
 *
 * NEVER A DEFAULT. Three places in app/api/telegram/alert/route.ts read this endpoint and two
 * of them used to write `?? '50'` for an answer they could not read - the exact middle of a
 * 0-100 scale, so an unreadable response arrived as a real neutral reading with nothing able
 * to tell the two apart. The `isNaN` guard under it never fired, because `parseInt('50')` is 50.
 *
 * THE PREDICATE IS A WHOLE-STRING MATCH, NOT A parseInt GUARD, AND THAT IS THE WHOLE POINT
 * (QA's review of #1727). `parseInt(raw, 10)` stops at the first character it cannot read and
 * returns what it has, which turns junk into a confident small number:
 *
 *     "0x1f"  -> 0    radix 10 stops at the x.       0 trips `<= 15`: FIRES extreme fear
 *     "4e1"   -> 4    means 40.                      4 trips `<= 15`: FIRES extreme fear
 *     "1e2"   -> 1    means 100, maximum GREED.      1 trips `<= 15`: fires the OPPOSITE alert
 *     "50abc" -> 50   the original defect, silent.
 *     "50%"   -> 50   same.
 *
 * The first three are a notch worse than the bug this helper was written for: that one
 * fabricated a 50, which trips none of the <=15 / >=75 / <=25 gates and so sent nothing. These
 * fabricate a value that FIRES, and `1e2` fires the alert that means the reverse of the truth.
 * Low likelihood - alternative.me will not send `0x1f` - but a proxy error body or a changed
 * response shape is exactly the case this function exists for, and "unlikely" is how the
 * previous one got written too. */

export interface FNGData { value: string; value_classification: string }

export interface FngReading {
  /** 0-100. */
  value: number;
  /** alternative.me's wording ("Extreme Fear"), or null when it sent none - callers omit the
   *  text rather than rendering an empty "F&G: 42 ()". */
  label: string | null;
}

export function readFng(json: { data?: FNGData[] }): FngReading | null {
  const raw = json.data?.[0]?.value;
  // Digits and nothing else. 1-3 of them, so "1234" is refused before the range check sees it.
  if (typeof raw !== 'string' || !/^\d{1,3}$/.test(raw.trim())) return null;
  const value = parseInt(raw.trim(), 10);
  if (value > 100) return null;
  const cls = json.data?.[0]?.value_classification;
  return { value, label: typeof cls === 'string' && cls.trim().length > 0 ? cls.trim() : null };
}
