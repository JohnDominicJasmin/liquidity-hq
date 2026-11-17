/* #2483: the landing hero clock (LIVE READ panel) is the visitor's clock, it TICKS, and it never stamps a dead feed.
 *   T1  its own state, set by a 30 s interval and when the tab becomes visible again; the interval and the listener are removed on unmount
 *   T2  the printed time is the stored tick (not a fresh `new Date()` in the markup), 24-hour with h23 (no "24:05" after midnight), blank before mount and while the price read has failed
 *   T3  the printed expression is behaviourally right: evaluated for 00:05 and 17:55 in a 24-hour locale
 * WHAT IT CANNOT PROVE: that a real throttled tab re-renders (a browser cell on a deployed URL does that). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const src = readFileSync(new URL('../components/LandingTerminal.tsx', import.meta.url), 'utf8');
const at = src.indexOf('const [clockMs, setClockMs] = useState<number | null>(null);');

test('T1. a 30 s interval plus a visibility refresh, both cleaned up', () => {
  assert.ok(at > 0, 'the clock state moved');
  const block = src.slice(at, at + 700);
  assert.match(block, /setInterval\(tick, 30_000\)/); assert.match(block, /visibilitychange', onVisible/);
  assert.match(block, /if \(!document\.hidden\) tick\(\)/, 'a hidden tab must not tick on the visibility event');
  assert.match(block, /return \(\) => \{ clearInterval\(iv\); document\.removeEventListener\('visibilitychange', onVisible\); \}/, 'the timer or listener leaks on unmount');
  assert.doesNotMatch(src, /const \[mounted, setMounted\]/, 'the old mount flag (a clock only read on re-render) is back');
});

test('T2. the markup prints the stored tick, in h23, and is blank before mount or on a failed price read', () => {
  const m = /\{clockMs !== null && !store\.pricesFailed \? new Date\(clockMs\)\.toLocaleTimeString\(undefined, \{ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' \}\) : ''\}/.exec(src);
  assert.ok(m, 'the clock expression changed: it must print clockMs, h23, and be blank before mount / when pricesFailed');
  assert.doesNotMatch(src.slice(at + 700), /new Date\(\)\.toLocaleTimeString/, 'a fresh new Date() in the markup (the server clock on first render) is back');
});

test('T3. h23 prints 00:05 at five past midnight and 17:55 in the evening (never 24:05)', () => {
  const fmt = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: 'UTC' });
  assert.equal(fmt(new Date('2026-11-18T00:05:00Z')), '00:05'); assert.equal(fmt(new Date('2026-11-17T17:55:00Z')), '17:55');
});
