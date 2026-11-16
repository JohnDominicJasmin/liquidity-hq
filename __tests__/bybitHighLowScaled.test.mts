/* #2442: Bybit lists PEPE and BONK as 1000PEPEUSDT / 1000BONKUSDT, so every PRICE field read from a Bybit ticker has to be multiplied by bybitPriceFactor(coin).
 * The Bybit-only branch of fetchBybit scaled the price but not the high and low, so a price of 0.0000123 shipped with a high of 0.0125 and a low of 0.0118 and the Arena's Fibonacci levels (built from high/low/price) and the
 * AI context read levels 1000x off.
 * __tests__/scaledPriceFactorApplied.test.mts says in its own header that it only fires when a FILE joins the set without the factor and is silent about the inside of a file that knows it: this is the inside.
 *   H1  every read of a Bybit ticker's high or low in the app is multiplied by a factor in the same expression, and the CONTROL finds at least the six reads in MarketProvider
 *   H2  the price reads of that ticker (lastPrice) in MarketProvider that feed the store are scaled too
 * WHAT IT CANNOT PROVE: the factor's value (bybitPriceFactor is pinned in its own file) or that the store holds the scaled number after a poll (a stand-in cell would need the provider). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const walk = (d: string): string[] => readdirSync(new URL(`../${d}/`, import.meta.url), { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(`${d}/${e.name}`) : /\.(ts|tsx)$/.test(e.name) ? [`${d}/${e.name}`] : []);
const files = ['app', 'components', 'lib'].flatMap(walk);

test('H1. every read of a Bybit ticker\'s highPrice24h / lowPrice24h is scaled in the same expression', () => {
  let seen = 0; const bad: string[] = [];
  for (const f of files) {
    const lines = strip(readFileSync(new URL(`../${f}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n')).split('\n');
    lines.forEach((ln, i) => {
      if (!/parseFloat\([^)]*(highPrice24h|lowPrice24h)/.test(ln)) return;
      if (f === 'components/MarketProvider.tsx') seen++;
      if (!/\*\s*(bybitPriceFactor\(|priceFactor\b|f\b)/.test(ln)) bad.push(`${f}:${i + 1}: ${ln.trim().slice(0, 90)}`);
    });
  }
  assert.ok(seen >= 6, `CONTROL: only ${seen} high/low reads found in MarketProvider (expected 6): the scan lost its target`);
  assert.deepEqual(bad, [], 'a Bybit high/low is read without the 1000x factor: PEPE/BONK levels are 1000x off in the Arena Fibonacci and the AI context');
});
test('H2. the Bybit lastPrice reads that feed the store in MarketProvider are scaled too (item.lastPrice and t.lastPrice)', () => {
  const lines = strip(readFileSync(new URL('../components/MarketProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n')).split('\n');
  const reads = lines.filter((l) => /parseFloat\((item|t)\.lastPrice/.test(l)); assert.ok(reads.length >= 3, 'CONTROL: the lastPrice reads were not found');
  for (const l of reads) assert.match(l, /\*\s*(bybitPriceFactor\(|f\b)/, `an unscaled Bybit lastPrice: ${l.trim()}`);
});
