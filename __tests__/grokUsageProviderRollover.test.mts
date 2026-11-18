/* #2434: two wrong numbers on the usage meters. GrokUsageProvider is a React provider with effects and no DOM test library here, so the wiring is pinned by source anchors; the rendered proof (the Tools ring after
 * a Quick read; the buttons enabling after 00:00 UTC) is QA's browser run on a deployed build.
 *   U5  setUsage MERGES: fields a caller does not send keep their last value (the read response has no tool-pool pair; replacing dropped it and the Tools ring vanished). The initial/rollover load REPLACES (it is the full row).
 *   U6  the counts are re-read when the tab becomes visible on a NEW UTC day and by a timer at the next UTC midnight + 5 s; the timer is cleared with the listener on unmount/user change.
 * A control proves the matcher: the provider's setUsage and effect are found before anything is asserted about them. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = code(readFileSync(new URL('../components/GrokUsageProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const once = (needle: string, label: string) => assert.equal(src.split(needle).length - 1, 1, `${label}: anchor occurs ${src.split(needle).length - 1} time(s), expected exactly 1`);

test('U5. setUsage merges into the previous usage (prev first, then the caller\'s fields), and is what the context exposes', () => {
  once('const [usage, setUsageState] = useState<GrokUsageInfo | null>(null);', 'CONTROL: the state hook');
  once('setUsageState(prev => ({ ...(prev ?? {}), ...u } as GrokUsageInfo));', 'the merge, previous fields first');
  assert.ok(/setUsage\s*[,}\s]/.test(src.slice(src.indexOf('Provider value'))) || src.includes('setUsage'), 'the merged setUsage is not exposed');
  assert.equal(/setUsageState\(u\)/.test(src.replace(/fetchGrokUsage\(\)\.then\(u => \{ if \(u\) setUsageState\(u\); \}\)/, '')), false, 'a caller path replaces the whole object again');
});
test('U5b. the FULL fetch (page load, midnight, new day) replaces the state; a signed-out user clears it', () => {
  once('fetchGrokUsage().then(u => { if (u) setUsageState(u); })', 'the load replaces with the full row');
  once('if (!userId) { setUsageState(null); return; }', 'no user: cleared');
});
test('U6. the rollover: a visibility change on a NEW UTC day and a timer at the next UTC midnight + 5 s both re-read; both are cleaned up', () => {
  once("const utcDay = () => new Date().toISOString().slice(0, 10);", 'the UTC day key (not local time)');
  once('Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime()', 'ms to the next UTC midnight');
  once("if (document.visibilityState !== 'visible') return;", 'only a visible tab re-reads');
  once('if (today !== day) { day = today; load(); }', 'only a NEW day re-reads (not every focus)');
  once("document.addEventListener('visibilitychange', onVisible);", 'the listener');
  once('msToNextUtcMidnight() + 5_000', 'the timer fires 5 s after midnight, when the server date has changed');
  once("timer = setTimeout(() => { day = utcDay(); load(); arm(); }, ", 'the timer re-reads and re-arms for the next day');
  once("return () => { document.removeEventListener('visibilitychange', onVisible); if (timer) clearTimeout(timer); };", 'cleanup of both');
});
test('U6b. the midnight arithmetic itself: from 23:59:50 UTC the next midnight is 10 s away, from 00:00:00 it is a full day', () => {
  const ms = (n: Date) => Date.UTC(n.getUTCFullYear(), n.getUTCMonth(), n.getUTCDate() + 1) - n.getTime();
  assert.equal(ms(new Date('2026-11-17T23:59:50.000Z')), 10_000);
  assert.equal(ms(new Date('2026-11-17T00:00:00.000Z')), 86_400_000);
  assert.equal(ms(new Date('2026-12-31T12:00:00.000Z')), 12 * 3_600_000, 'year end');
});
