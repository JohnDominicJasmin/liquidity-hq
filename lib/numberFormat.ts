/* The app's number text for prices and signed amounts, in one place (#1631 B and C).
 *
 * Two classes of wrong number came out of hand-rolled formatting: prices printed with a fixed toFixed(0) (XRP's $2.31 became "$1" in the
 * Arena prompt, and its ATR buffer "$0.00"), and signed amounts built as `(v >= 0 ? '+' : '') + '$' + Math.abs(v)`, which drops the minus of
 * every negative value (an ETH ETF outflow of -$26.1M printed "$26M"). Both are fixed here, once, so a new surface cannot repeat them. */

/** The digits of a price with as many decimals as its size needs: 107,250 / 2,345.67 / 2.3456 / 0.5123 / 0.00001234 (no "$"). */
export function priceDigits(v: number): string {
  const a = Math.abs(v);
  if (a >= 1000) return v.toLocaleString('en-US', { maximumFractionDigits: 2 });
  if (a >= 1) return v.toLocaleString('en-US', { maximumFractionDigits: 4 });
  if (a === 0 || !Number.isFinite(a)) return a === 0 ? '0' : String(v);
  /* Below 1: four significant digits written out in full. Number(v.toPrecision(4)).toString() switched to an exponent below 0.000001
     ("1.234e-7", QA's review of #1665); toFixed with enough places never does. Trailing zeros are dropped (0.5000 -> 0.5). */
  const places = Math.min(20, Math.max(4, 3 - Math.floor(Math.log10(a))));
  return v.toFixed(places).replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '');
}

/** A price with as many decimals as its size needs: $107,250 / $2,345.67 / $2.3456 / $0.5123 / $0.00001234. */
export function priceText(v: number): string {
  return '$' + priceDigits(v);
}

/** "+" or "-" for a value whose magnitude is printed separately (a sign in front of Math.abs must never be "" for a negative). */
export const signOf = (v: number): '+' | '-' => (v >= 0 ? '+' : '-');

/** A signed dollar amount in a unit, e.g. +$527M or -$26.1M. The sign is never dropped. */
export function signedUsd(v: number, unit: '' | 'K' | 'M' | 'B', digits: number): string {
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(digits) + unit;
}
