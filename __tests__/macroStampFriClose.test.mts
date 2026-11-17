/* #2485: a macro quote carries its OWN time, and an old one is stamped "<day> close" instead of looking live.
 *   M1  macroStampDate: null for a fresh quote (<= 4 h, boundary included), a Date for an older one; null for missing, zero, negative, NaN, a non-number, and a quote from the FUTURE (clock skew must never stamp)
 *   M2  both routes turn Yahoo's regularMarketTime (SECONDS) into milliseconds, and send null when Yahoo sent none or a non-positive time (the expression is evaluated from the route source)
 *   M3  the weekend case end to end: a Friday 21:00Z quote seen Sunday is stamped Fri; seen Friday 22:00Z it is not
 *   M4  the stamp label has a {day} slot and a default row, and the cards only print it when there is a value to stamp
 * WHAT IT CANNOT PROVE: Yahoo sending regularMarketTime for every symbol, or the viewer-local weekday reading (a Manila viewer sees Friday's US close as Saturday). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { macroStampDate, MACRO_STALE_AFTER_MS } from '../lib/macroStamp.ts';

const H = 3600_000; const NOW = Date.UTC(2026, 10, 15, 12);   // Sun 15 Nov 2026 12:00Z

test('M1. fresh = no stamp (4 h included); older = the quote\'s own date; unknown or impossible = no stamp', () => {
  assert.equal(MACRO_STALE_AFTER_MS, 4 * H);
  assert.equal(macroStampDate(NOW - 4 * H, NOW), null, 'exactly 4 h old is still fresh');
  assert.equal(macroStampDate(NOW - 4 * H - 1, NOW)?.getTime(), NOW - 4 * H - 1);
  for (const bad of [null, undefined, 0, -5, Number.NaN, Infinity, '1700000000000' as unknown as number]) assert.equal(macroStampDate(bad, NOW), null, `${String(bad)} must not stamp`);
  assert.equal(macroStampDate(NOW + 10 * H, NOW), null, 'a quote from the future must not stamp');
});

test('M2. both routes convert seconds to ms and send null for none / non-positive', () => {
  for (const f of ['../app/api/macro/route.ts', '../app/api/macro-context/route.ts']) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    const expr = /const asOf = (typeof (?:meta|result)\.regularMarketTime === 'number' && (?:meta|result)\.regularMarketTime > 0 \? (?:meta|result)\.regularMarketTime \* 1000 : null);/.exec(src)?.[1];
    assert.ok(expr, `${f}: the asOf expression moved or changed`);
    const run = (t: unknown) => new Function('meta', 'result', `return ${expr}`)({ regularMarketTime: t }, { regularMarketTime: t }) as number | null;
    assert.equal(run(1_700_000_000), 1_700_000_000_000, `${f}: seconds must become ms`);
    assert.equal(run(undefined), null); assert.equal(run(0), null); assert.equal(run(-3), null); assert.equal(run('1700000000'), null);
  }
});

test('M3. a Friday close seen on Sunday is stamped Fri; seen late Friday it is not', () => {
  const fri = Date.UTC(2026, 10, 13, 21);   // Fri 13 Nov 21:00Z
  assert.equal(macroStampDate(fri, NOW)?.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'UTC' }), 'Fri');
  assert.equal(macroStampDate(fri, Date.UTC(2026, 10, 13, 22)), null);
});

test('M4. the label carries {day} and the cards print it only for a stamped value', () => {
  assert.match(JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')).MACRO_STRIP_CLOSE_STAMP, /\{day\}/);
  const b = readFileSync(new URL('../components/BriefingTerminal.tsx', import.meta.url), 'utf8');
  assert.match(b, /dxyStampDate && store\.dxy != null &&/, 'the briefing card must not stamp an absent value');
});
