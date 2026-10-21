/* The app's number text for prices and signed amounts, in one place (#1631 B and C).
 *
 * Two classes of wrong number came out of hand-rolled formatting: prices printed with a fixed toFixed(0) (XRP's $2.31 became "$1" in the
 * Arena prompt, and its ATR buffer "$0.00"), and signed amounts built as `(v >= 0 ? '+' : '') + '$' + Math.abs(v)`, which drops the minus of
 * every negative value (an ETH ETF outflow of -$26.1M printed "$26M"). Both are fixed here, once, so a new surface cannot repeat them. */

/** A price with as many decimals as its size needs: $107,250 / $2,345.67 / $2.3456 / $0.5123 / $0.00001234. */
export function priceText(v: number): string {
  const a = Math.abs(v);
  const body = a >= 1000 ? v.toLocaleString('en-US', { maximumFractionDigits: 2 })
    : a >= 1 ? v.toLocaleString('en-US', { maximumFractionDigits: 4 })
    : a === 0 ? '0' : Number(v.toPrecision(4)).toString();
  return '$' + body;
}

/** A signed dollar amount in a unit, e.g. +$527M or -$26.1M. The sign is never dropped. */
export function signedUsd(v: number, unit: 'K' | 'M' | 'B', digits: number): string {
  return (v >= 0 ? '+' : '-') + '$' + Math.abs(v).toFixed(digits) + unit;
}
