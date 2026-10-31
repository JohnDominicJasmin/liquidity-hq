/* The app's number text for prices and signed amounts, in one place (#1631 B and C).
 *
 * Two classes of wrong number came out of hand-rolled formatting: prices printed with a fixed toFixed(0) (XRP's $2.31 became "$1" in the
 * Arena prompt, and its ATR buffer "$0.00"), and signed amounts built as `(v >= 0 ? '+' : '') + '$' + Math.abs(v)`, which drops the minus of
 * every negative value (an ETH ETF outflow of -$26.1M printed "$26M"). Both are fixed here, once, so a new surface cannot repeat them. */

/* WHAT AN UNKNOWN NUMBER PRINTS AS, and why it is this rather than a blank or a zero.
 *
 * #1651 layer 1. Before this, every formatter below passed a non-finite value straight through:
 * `priceText(NaN)` printed **"$NaN"**, `priceText(Infinity)` printed **"$\u221e"** (toLocaleString
 * renders it), and `signedUsd(NaN, 'M', 1)` printed **"-$NaNM"** - a minus sign invented out of
 * `NaN >= 0` being false. Those strings reached a trader's screen.
 *
 * NEVER "$0" AND NEVER "". An unknown rendered as zero is worse than "$NaN", because "$NaN"
 * at least announces itself - a zero is a number the reader will act on, and a blank reads as
 * "nothing is happening here" rather than "we do not know". That is the owner's standing rule
 * that every number carries its unknown state, and the test for it (F7 in
 * __tests__/numberFormatProperties.test.mts) asserts BOTH halves: the output must not contain
 * NaN/Infinity, and must not look like a real number either.
 *
 * "n/a" RATHER THAN A LABEL KEY, deliberately, and this is the part to revisit if the owner
 * wants different wording. Five of the eight callers of these functions are prompt builders -
 * lib/chatPrompt.ts, lib/grok.ts, lib/liqClusters.ts, lib/useEMAStrategy.ts - not UI. Threading
 * `t()` through a pure formatter would put a localized string into an English prompt, and
 * `lib/grok.ts` already reads "n/a" back FROM the model as "no value" (:918), so this keeps one
 * vocabulary on both sides of the call. A UI surface that wants different words can map this
 * constant; it must not go back to printing the raw value. */
export const UNKNOWN_NUMBER = 'n/a';

/** The digits of a price with as many decimals as its size needs: 107,250 / 2,345.67 / 2.3456 / 0.5123 / 0.00001234 (no "$"). */
export function priceDigits(v: number): string {
  /* FIRST, so nothing below can format a non-finite value. The old code reached
     `v.toLocaleString()` for Infinity (a >= 1000 is true for it) and `String(v)` for NaN. */
  if (!Number.isFinite(v)) return UNKNOWN_NUMBER;
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (a === 0) return '0';
  /* Below 1: four significant digits written out in full. Number(v.toPrecision(4)).toString() switched to an exponent below 0.000001
     ("1.234e-7", QA's review of #1665); toFixed with enough places never does. Trailing zeros are dropped (0.5000 -> 0.5). */
  const places = Math.min(20, Math.max(4, 3 - Math.floor(Math.log10(a))));
  return v.toFixed(places).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/** A price with as many decimals as its size needs: $107,250 / $2,345.67 / $2.3456 / $0.5123 / $0.00001234. */
export function priceText(v: number): string {
  /* Checked here as well as in priceDigits, because the "$" is added OUTSIDE it - otherwise an
     unknown price reads "$n/a", which is a currency symbol attached to nothing. */
  if (!Number.isFinite(v)) return UNKNOWN_NUMBER;
  return '$' + priceDigits(v);
}

/** "+" or "-" for a value whose magnitude is printed separately (a sign in front of Math.abs must never be "" for a negative).
 *
 * CANNOT REPORT AN UNKNOWN, and that is a real limitation rather than an oversight: the return
 * type is a two-value union every call site switches on, so there is nowhere for a third answer
 * to go. `signOf(NaN)` returns '-', because `NaN >= 0` is false - an invented minus sign on a
 * value we do not have. **So test the value before asking for its sign**, or use `signedUsd`,
 * which refuses the whole string. Widening this union is a separate change across every caller
 * and is not #1651 layer 1. */
export const signOf = (v: number): '+' | '-' => (v >= 0 ? '+' : '-');

/** A signed dollar amount in a unit, e.g. +$527M or -$26.1M. The sign is never dropped. */
export function signedUsd(v: number, unit: '' | 'K' | 'M' | 'B', digits: number): string {
  /* The sign is the reason this cannot fall through. `NaN >= 0` is false, so the old code
     answered '-' and then printed "NaN" after it: "-$NaNM" asserts a direction for a value
     that has none, which is worse than printing nothing. */
  if (!Number.isFinite(v)) return UNKNOWN_NUMBER;
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(digits) + unit;
}
