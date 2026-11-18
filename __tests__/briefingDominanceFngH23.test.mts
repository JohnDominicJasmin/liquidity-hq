/* #2487: the Briefing says what window its dominance trend covers, the Fear & Greed read refreshes hourly, and times are h23 (no "24:05").
 *   B1  the dominance trend uses CoinMarketCap's own 24 h change when present and labels it "24h"; without it, the short sample window is used and labelled "~50 min" (the source expression is evaluated for both cases and for the 0.1-point dead band)
 *   B2  the provider reads btc_dominance_24h_percentage_change, keeps the previous value when the field is absent or not finite, and the store default is null
 *   B3  Fear & Greed is on an hourly interval, not daily
 *   B4  no `hour12: false` is left in the files this PR touched (it prints "24:05" after midnight in some browsers); the Intl hour cycle is h23 in the alert route's local-time helper, whose digits drive quiet hours
 *   B5  both window labels exist as keys and defaults
 * WHAT IT CANNOT PROVE: that a particular browser printed 24:xx before (this Node prints 00 either way), or CoinMarketCap actually sending the field. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (f: string) => readFileSync(new URL(f, import.meta.url), 'utf8');
const brief = read('../components/BriefingTerminal.tsx');

test('B1. the trend prefers the 24 h change, labels the window, keeps the 0.1-point dead band', () => {
  const domMove = /const domMove = (dom24 != null \? dom24 : btcDomHistory\.length >= 6 \? btcDomHistory\[btcDomHistory\.length - 1\] - btcDomHistory\[0\] : 0);/.exec(brief)?.[1];
  const domWindow = /const domWindow = (dom24 != null \? t\('BRIEFING_DOM_WINDOW_24H'\) : t\('BRIEFING_DOM_WINDOW_SHORT'\));/.exec(brief)?.[1];
  assert.ok(domMove && domWindow, 'the dominance expressions moved');
  const calc = (dom24: number | null, btcDomHistory: number[]) => new Function('dom24', 'btcDomHistory', 't', `return { move: ${domMove}, win: ${domWindow} }`)(dom24, btcDomHistory, (k: string) => k) as { move: number; win: string };
  assert.deepEqual(calc(0.4, [50, 50]), { move: 0.4, win: 'BRIEFING_DOM_WINDOW_24H' }, 'the 24 h change must win over a short history');
  const short = calc(null, [50, 50.3, 50.3, 50.3, 50.3, 50.5]); assert.ok(Math.abs(short.move - 0.5) < 1e-9, 'the short window is last minus first'); assert.equal(short.win, 'BRIEFING_DOM_WINDOW_SHORT');
  assert.equal(calc(null, [50, 50.1]).move, 0, 'fewer than 6 samples is no trend'); assert.equal(calc(0, []).win, 'BRIEFING_DOM_WINDOW_24H', 'a real 24 h change of 0 is still a 24 h read');
  /* #2506 + #2562 (owner sweep 2026-11-18, no data-gap dashes): the line is empty whenever there is no trend, with or without a dominance read (never a dash). The window label is printed only beside a real trend. */
  assert.match(brief, /domTrend \? `\$\{domTrend\.txt\} · \$\{domWindow\}` : ''\}/, 'the window label must be printed beside the trend, and nothing when there is no trend');
  assert.doesNotMatch(brief, /domWindow\}` : \(store\.btcDom != null \? '-'/, 'the old dash fallback under the BTC dominance value is back');
  assert.doesNotMatch(brief, /fngWord\(t, store\.fngLabel\) \|\| \(fng != null \? '-'/, 'the old dash fallback under the Fear & Greed value is back');
  assert.match(brief, /\{\(store\.btcDom != null \|\| !graceOver\) && \(\s*<div className="mb-macro-item">/, 'a BTC dominance read that failed after the grace period must leave its whole cell out, not an empty box');
  assert.match(brief, /const domTrend = domMove >= 0\.1/); assert.match(brief, /domMove <= -0\.1/);
});

test('B2. the provider reads the 24 h field, ignores a missing or non-finite one, and defaults to null', () => {
  const mp = read('../components/MarketProvider.tsx');
  assert.match(mp, /d\?\.data\?\.btc_dominance_24h_percentage_change as number \| undefined/);
  assert.match(mp, /btcDomChg24h: typeof domChg24 === 'number' && Number\.isFinite\(domChg24\) \? domChg24 : s\.btcDomChg24h/);
  assert.match(read('../lib/marketStore.ts'), /btcDomHistory: \[\], btcDomChg24h: null/);
});

test('B3. Fear & Greed is hourly', () => {
  assert.match(read('../components/MarketProvider.tsx'), /\[fetchFNG, 60 \* 60 \* 1000\]/); assert.doesNotMatch(read('../components/MarketProvider.tsx'), /\[fetchFNG, 24/);
});

test('B4. h23 in every touched file, and the alert route\'s local-time helper', () => {
  for (const f of ['../app/(main)/news/page.tsx', '../app/api/telegram/alert/route.ts', '../components/BriefingTerminal.tsx', '../components/WhaleTradesFeed.tsx']) assert.doesNotMatch(read(f), /hour12: false/, `${f} still uses hour12:false`);
  assert.match(read('../app/api/telegram/alert/route.ts'), /timeZone: zone, hour: '2-digit', minute: '2-digit', hourCycle: 'h23'/);
});

test('B5. the two window labels are keys with English defaults', () => {
  const keys = read('../lib/labelKeys.ts'); const defs = JSON.parse(read('../lib/labelDefaults.en.json'));
  for (const k of ['BRIEFING_DOM_WINDOW_24H', 'BRIEFING_DOM_WINDOW_SHORT']) { assert.ok(keys.includes(`'${k}'`), `${k} is not a label key`); assert.equal(typeof defs[k], 'string', `${k} has no default`); }
  assert.equal(defs.BRIEFING_DOM_WINDOW_24H, '24h'); assert.equal(defs.BRIEFING_DOM_WINDOW_SHORT, '~50 min');
});
