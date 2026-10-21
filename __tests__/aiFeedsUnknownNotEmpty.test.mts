/* #1631 A (#1668, PM's audit): a feed the AI read could not load is said to be unavailable, never read as "nothing happened".
 *
 * Two places, each run the way it can be run without a browser:
 *
 * 1. THE ARENA PROMPT'S FALLBACKS (app/arena/page.tsx). The calendar and news lines are built inside the Arena component, so the two
 *    statements are cut out of the current source and evaluated with the inputs set here: no events, and each combination of
 *    eventsLoaded / econStale / alertsLoaded. Before #1668's fix round an unloaded or stale calendar said "None in next 48h" and an
 *    unloaded news feed said "No recent alerts" - the model was told the week was empty.
 *
 * 2. THE ETF ROUTE (app/api/proxy/route.ts GET ?type=etf), run for real behind a network stand-in (SoSoValue answers per symbol; anything
 *    else 503). `btc` / `eth` are what Briefing and the chat show undated, so while the newest trading day's row is not settled they must
 *    be null - never the day before's flow standing in as today's. The dated days for the AI read come from the same answer.
 *
 * THE ORACLE is PM's audit of #1668 and the tier-free rule it states ("unknown is never empty"), not the code: the expected strings are
 * the ones the rule requires ("unavailable", the dates), and the exact wording is checked only where the prompt must keep it.
 *
 * WHAT IT CANNOT PROVE: what the model does with "unavailable", the browser's NewsProvider timing, or what SoSoValue actually sends for a
 * day that is not settled yet (null and "" are covered; a 0 cannot be told apart from a real zero-flow day by anyone). */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { utcStamp, ageText } from '../lib/promptTime.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ARENA = stripTsComments(read('app/arena/page.tsx'));
const once = (re: RegExp, label: string) => {
  const all = [...ARENA.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  assert.equal(all.length, 1, `${label}: found ${all.length} times, not once - re-read the current app/arena/page.tsx`);
  return all[0];
};

/* ── 1. the Arena prompt's fallbacks ───────────────────────────────────── */

const UPCOMING_SRC = once(/const upcomingList = econEvents[\s\S]*?;\n/, 'the upcoming-events statement')[0];
const NEWS_SRC = once(/\bnews: (latestNews\.length > 0[\s\S]*?),\n\s*rsi14\b/, 'the news field')[1];
const upcomingList = (econEvents: unknown[], eventsLoaded: boolean, econStale: boolean, now = Date.now()) =>
  new Function('econEvents', 'now', 'utcStamp', 'eventsLoaded', 'econStale', `${UPCOMING_SRC}\nreturn upcomingList;`)(econEvents, now, utcStamp, eventsLoaded, econStale) as string;
const newsField = (latestNews: unknown[], alertsLoaded: boolean, now = Date.now()) =>
  new Function('latestNews', 'alertsLoaded', 'now', 'utcStamp', 'ageText', `return (${NEWS_SRC});`)(latestNews, alertsLoaded, now, utcStamp, ageText) as string;

test('U1. no upcoming events from a calendar that did not load, or is stale, is "unavailable" - never "None in next 48h"', () => {
  for (const [eventsLoaded, econStale] of [[false, false], [false, true], [true, true]] as const) {
    const s = upcomingList([], eventsLoaded, econStale);
    assert.doesNotMatch(s, /None in next 48h/i, `loaded=${eventsLoaded} stale=${econStale}: an unknown calendar was told to the model as an empty one`);
    assert.match(s, /unavailable/i, `loaded=${eventsLoaded} stale=${econStale}: the line does not say the calendar is unavailable`);
    assert.match(s, /do not assume/i, `loaded=${eventsLoaded} stale=${econStale}: the model is not told to make no assumption from it`);
  }
  assert.match(upcomingList([], true, false), /None in next 48h/, 'a calendar that loaded fresh and has nothing ahead can say so');
});

test('U2. an event inside 48 h is listed with its UTC time whatever the flags say (the fallback never hides real events)', () => {
  const now = Date.UTC(2026, 9, 22, 1, 0);
  const cpi = { name: 'CPI', impact: 'High', estimate: '3.1%', dateStr: 'Oct 22', dt: new Date(now + 5 * 3_600_000) };
  for (const [eventsLoaded, econStale] of [[true, false], [true, true]] as const) {
    assert.equal(upcomingList([cpi], eventsLoaded, econStale, now), 'UPCOMING: CPI (2026-10-22 06:00 UTC, impact: High) | Est: 3.1%');
  }
});

test('U3. an empty news feed that did not load is "unavailable" - "No recent alerts" only from a feed that loaded', () => {
  const unloaded = newsField([], false);
  assert.doesNotMatch(unloaded, /No recent alerts/i, 'an unloaded news feed was told to the model as a quiet one');
  assert.match(unloaded, /unavailable/i); assert.match(unloaded, /do not assume/i);
  assert.equal(newsField([], true), 'No recent alerts');
});

test('U4. headlines reach the prompt newest first, each with its UTC time, age and source ("news feed" when it has none)', () => {
  const now = Date.UTC(2026, 9, 22, 6, 0);
  const s = (h: number) => Math.floor((now - h * 3_600_000) / 1000);
  const lines = newsField([
    { headline: 'Older', source: 'Reuters', ts: s(5) },
    { headline: 'Newest', source: '', ts: s(1) },
  ], true, now).split('\n');
  assert.deepEqual(lines, ['- [2026-10-22 05:00 UTC, 1h ago | news feed] Newest', '- [2026-10-22 01:00 UTC, 5h ago | Reuters] Older']);
});

test('U5. the read is rebuilt when a feed finishes loading: eventsLoaded, econStale and alertsLoaded are in the same dependency list as latestNews', () => {
  const deps = once(/\}, \[([^\]]*\blatestNews\b[^\]]*)\]\);/, 'the dependency list holding latestNews')[1].split(',').map((d) => d.trim());
  for (const d of ['eventsLoaded', 'econStale', 'alertsLoaded', 'econEvents']) assert.ok(deps.includes(d), `${d} is missing: a read built before the feed loaded keeps saying "unavailable" (or "none") after it loads`);
});

/* ── 2. the ETF route: an unsettled newest day is never stood in for ───── */

/* A clock that runs plus an offset, so each test starts past the route's 1 h cache (lib/apiCache.ts reads Date.now). */
const realNow = Date.now.bind(Date);
let offset = 0;
Date.now = () => realNow() + offset;

process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://supabase.invalid'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service'; process.env.SOSOVALUE_API_KEY = 'placeholder-soso';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const soso: Record<string, unknown> = {};
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.host === 'openapi.sosovalue.com') return json(200, soso[url.searchParams.get('symbol') ?? '']);
  if (url.host === 'supabase.invalid') return req.method === 'GET' ? json(200, []) : new Response(null, { status: 201 });
  return new Response('unavailable in the QA stand-in', { status: 503 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; Date.now = realNow; });

const { GET } = await import('../app/api/proxy/route.ts');
let ip = 0;
const etf = async (btc: unknown, eth: unknown) => {
  offset += 3 * 3_600_000; soso.BTC = btc; soso.ETH = eth;
  const r = await GET(new NextRequest('http://localhost/api/proxy?type=etf', { headers: { 'x-forwarded-for': `10.0.0.${++ip}` } }));
  assert.equal(r.status, 200);
  return await r.json() as { btc: number | null; eth: number | null; btcDays: unknown; ethDays: unknown };
};
const rows = (...r: Array<[string, unknown]>) => ({ code: 0, data: r.map(([date, total_net_inflow]) => ({ date, total_net_inflow })) });

test('E1. the newest day not settled yet: btc / eth are null (not the day before\'s flow), and the dated days start at the last settled day', async () => {
  const b = await etf(rows(['2026-10-21', null], ['2026-10-20', 526_700_000], ['2026-10-19', -55_066_297]),
                      rows(['2026-10-21', ''], ['2026-10-20', 12_000_000]));
  assert.equal(b.btc, null, `Briefing and the chat would show ${b.btc}, the 2026-10-20 flow, undated, as the latest`);
  assert.equal(b.eth, null);
  assert.deepEqual(b.btcDays, [{ date: '2026-10-20', flowM: 526.7 }, { date: '2026-10-19', flowM: -55.066297 }]);
  assert.deepEqual(b.ethDays, [{ date: '2026-10-20', flowM: 12 }]);
});

test('E2. the newest day settled: btc / eth are that day\'s flow in millions, zero kept as zero, and it heads the dated days', async () => {
  const b = await etf(rows(['2026-10-21', 23_200_000], ['2026-10-20', 526_700_000]), rows(['2026-10-21', 0]));
  assert.equal(b.btc, 23.2); assert.equal(b.eth, 0, 'a zero-flow day is a real value, not missing');
  assert.deepEqual(b.btcDays, [{ date: '2026-10-21', flowM: 23.2 }, { date: '2026-10-20', flowM: 526.7 }]);
  assert.deepEqual(b.ethDays, [{ date: '2026-10-21', flowM: 0 }]);
});

test('E3. nothing usable from SoSoValue: every field is null, never a zero or an empty list that looks like a quiet day', async () => {
  const b = await etf(rows(['2026-10-21', null]), { code: 0, data: [] });
  assert.deepEqual(b, { btc: null, eth: null, btcDays: null, ethDays: null });
});
