/* QA: PR #2831 (#1185 owner item 93). Calendar alerts count the minutes before an event and say "Happening NOW" only from its start.
 * The real countdown(), pushAlert and announce() are cut out of components/NewsProvider.tsx and run against a stand-in clock, alert list and Notification.
 *   M1 an hour or more away: nothing. Inside the hour: one line and one notification; each minute rewrites the same line with no new notification
 *   M2 at the start the line is replaced by "<event> - Happening NOW" (no "Upcoming"), with one more notification
 *   M3 thirty minutes after the start the line is removed
 *   M4 a dismissed line stays gone for the rest of that phase */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { interpolate } from '../lib/labels.ts';

const strip = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const src = readFileSync(new URL('../components/NewsProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const defaults = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
const cut = (from: string, to: string) => { const a = src.indexOf(from); assert.ok(a >= 0, `CONTROL: ${from}`); const b = src.indexOf(to, a); assert.ok(b > a, `CONTROL: end of ${from}`); return src.slice(a, b + to.length); };

type Alert = { id: number; headline: string; calKey?: string };
function world(startInMinutes: number) {
  const START = Date.parse('2026-11-26T13:30:00Z');
  const w = { now: START - startInMinutes * 60_000, alerts: [] as Alert[], notices: [] as string[] };
  class FakeDate extends Date { static now() { return w.now; } }
  class Note { static permission = 'granted'; constructor(title: string) { w.notices.push(title); } }
  const push = cut('const pushAlert = useCallback(', '\n  }, []);').replace('const pushAlert = useCallback(', 'const pushAlert = ').replace(/\n {2}\}, \[\]\);$/, '\n  };');
  const code = [cut('const EVENT_NOW_HOURS', ';'), cut('function countdown(', '\n}'), push, cut('const announce = () => {', '\n    };')].join('\n');
  const js = strip(code);
  const t = (k: string, v?: Record<string, string | number>) => interpolate(defaults[k] ?? `<<${k}>>`, v ?? {});
  const deps = {
    Date: FakeDate, Notification: Note, window: { Notification: Note }, t, tRef: { current: t }, timeAgo: () => 'now',
    econEvents: [{ name: 'CPI', dt: new Date(START) }], ALERT_LIMIT: 50, SEEN_LIMIT: 500, seenRef: { current: new Set<string>() }, alertIdRef: { current: 1 },
    setAlerts: (f: (p: Alert[]) => Alert[]) => { w.alerts = f(w.alerts); }, setLatestHeadlines: () => {}, setLatestNews: () => {},
  };
  const announce = new Function(...Object.keys(deps), `${js}\nreturn announce;`)(...Object.values(deps)) as () => void;
  return { w, tick: (minutes = 0) => { w.now += minutes * 60_000; announce(); }, lines: () => w.alerts.map((a) => a.headline), dismiss: () => { w.alerts = []; } };
}

test('M1. nothing an hour away; one line, rewritten each minute, one notification', () => {
  const s = world(61);
  s.tick(); s.tick(1);
  assert.deepEqual(s.lines(), [], 'a line at 60 minutes');
  s.tick(20);                                   // 40 minutes to go
  assert.deepEqual(s.lines(), ['Upcoming: CPI - in 40 min']);
  assert.equal(s.w.notices.length, 1);
  for (let m = 39; m >= 1; m--) { s.tick(1); assert.deepEqual(s.lines(), [`Upcoming: CPI - in ${m} min`]); }
  assert.equal(s.w.notices.length, 1, 'a notification every minute');
});

test('M2. at the start the line becomes "Happening NOW", announced once', () => {
  const s = world(10);
  s.tick(); s.tick(10);
  assert.deepEqual(s.lines(), ['CPI - Happening NOW']);
  for (let m = 0; m < 29; m++) s.tick(1);
  assert.deepEqual(s.lines(), ['CPI - Happening NOW']);
  assert.deepEqual(s.w.notices, ['Upcoming: CPI - in 10 min', 'CPI - Happening NOW']);
});

test('M3. thirty minutes after the start the line is gone', () => {
  const s = world(5);
  s.tick(); s.tick(5); s.tick(30);
  assert.deepEqual(s.lines(), []);
  s.tick(1); assert.deepEqual(s.lines(), []); assert.equal(s.w.notices.length, 2);
});

test('M4. a dismissed line stays gone until the next phase', () => {
  const s = world(20);
  s.tick(); s.dismiss(); s.tick(1); s.tick(5);
  assert.deepEqual(s.lines(), []);
  s.tick(14);
  assert.deepEqual(s.lines(), ['CPI - Happening NOW']);
  s.dismiss(); s.tick(1); s.tick(10);
  assert.deepEqual(s.lines(), []); assert.equal(s.w.notices.length, 2);
});
