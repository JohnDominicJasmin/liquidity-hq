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
import { appPath, appRel } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const ARENA = stripTsComments(read(appPath('app/arena/page.tsx')));
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
/* Kept so every test can prove the stand-in is still installed when it runs - see the assertion in etf() below. */
const standInFetch = globalThis.fetch;

/* THE AWAIT COMES BEFORE THE after() HOOK, AND THAT ORDER IS THE WHOLE FIX (#1683 family, found by the cloud gate 2026-10-23).
 *
 * It used to read: install the stand-in, register after(), THEN `await import`. A top-level await SUSPENDS the module, so E1-E3 had not
 * registered yet - the runner saw only U1-U5, concluded the file was done, and fired after(), which put the REAL fetch back about 10 ms
 * after the stand-in went in. E1 then made a real request to openapi.sosovalue.com (403 from a container, 2,816 ms), the route correctly
 * answered null for an upstream it could not read, and the assertion failed on `null` where fixture data was expected.
 *
 * Three things make that the mechanism rather than a story: E3 - the one test expecting everything null - PASSED, while the two wanting
 * fixture values failed; E1 took 2,816 ms against E2's 270 and E3's 227, the signature of a real network attempt; and the route itself
 * was never at fault. It PASSES on a warm laptop, where the import resolves fast enough to win the race, which is why nine per-branch
 * runs were green and only the integrated run caught it. A green run elsewhere is not evidence this file is sound.
 *
 * With the await first, every test() call registers synchronously after it, so the runner cannot see an empty queue mid-file. */
const { GET } = await import(appRel('app/api/proxy/route.ts'));

/* THE CLOCK IS RESTORED; THE FETCH STAND-IN IS DELIBERATELY NOT. Each test file runs in its own process, so restoring `fetch` at
 * teardown protects nothing - and it actively lets a late write ESCAPE TO THE REAL NETWORK. The route's `reportHealth`
 * (app/api/proxy/route.ts:535) is fire-and-forget, so it settles after the test that triggered it has finished; with the stand-in
 * removed by then, it reached the real internet and printed "[apiHealth] write failed: TypeError: fetch failed" on every run of this
 * file. Leaving the stand-in in place for the life of the process means that write is answered by the stub, as it should be.
 * Measured: with the restore, one escape per run; without it, none. */
after(() => { Date.now = realNow; });
void realFetch; /* kept deliberately unused: see above. Restoring it is what caused the escape. */
let ip = 0;
const etf = async (btc: unknown, eth: unknown) => {
  /* THE STAND-IN MUST STILL BE INSTALLED WHEN THE TEST RUNS. Without this, the after()-fires-early race above presented as
     `null !== 23.2` - a mismatch that reads like a product defect in the ETF parser and took a probe in a container to diagnose.
     With it, the same failure says what actually happened, in one line, wherever it next occurs. */
  assert.equal(globalThis.fetch, standInFetch,
    'the fetch stand-in was removed before this test ran: the after() hook fired early, so this request would reach the real network and the route would correctly answer null (#1683 family)');
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

/* ── 3. NewsProvider: a failed news read leaves alertsLoaded false (#1668 item B) ── */

/* `hydrateNews` lives inside NewsProvider's effect, so it is cut out of the current source (its one TypeScript cast removed) and run with a
 * stand-in Supabase query and spies for ingestRow / setAlertsLoaded. Before the fix it called setAlertsLoaded(true) whatever the read
 * returned, so a timed-out query (data null) reached the Arena prompt as "No recent alerts". */
const PROVIDER = stripTsComments(read('components/NewsProvider.tsx'));
const providerOnce = (re: RegExp, label: string) => {
  const all = [...PROVIDER.matchAll(new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g'))];
  assert.equal(all.length, 1, `${label}: found ${all.length} times, not once - re-read the current components/NewsProvider.tsx`);
  return all[0];
};
const HYDRATE_SRC = providerOnce(/const hydrateNews = (async \(\) => \{[\s\S]*?\n {4}\});\n/, 'hydrateNews')[1].replace(/ as NewsRow\[\] \| null/, '');

async function hydrate(answer: { data: unknown; error: unknown }) {
  const ingested: unknown[] = [], loaded: unknown[] = [];
  const q = { from: () => q, select: () => q, gte: () => q, order: () => q, limit: () => Promise.resolve(answer) };
  const fn = new Function('sb', 'T', 'live', 'ingestRow', 'setAlertsLoaded', `return (${HYDRATE_SRC});`)(
    q, { news: 'lhq_news' }, true, (row: unknown) => ingested.push(row), (v: unknown) => loaded.push(v)) as () => Promise<void>;
  await fn();
  return { ingested, loaded };
}

test('N1. a news read that errors (timeout, PGRST002, refused) leaves alertsLoaded unset and ingests nothing', async () => {
  for (const data of [null, []]) {
    const r = await hydrate({ data, error: { code: '57014', message: 'canceling statement due to statement timeout' } });
    assert.deepEqual(r.loaded, [], `data=${JSON.stringify(data)}: a failed read marked the feed loaded, so the prompt says "No recent alerts"`);
    assert.deepEqual(r.ingested, []);
  }
});

test('N2. a read that succeeds marks the feed loaded, empty or not, with rows ingested oldest first', async () => {
  assert.deepEqual((await hydrate({ data: [], error: null })).loaded, [true], 'an empty feed that really loaded is a real "no news"');
  const r = await hydrate({ data: [{ dedup_key: 'new' }, { dedup_key: 'old' }], error: null });
  assert.deepEqual(r.loaded, [true]);
  assert.deepEqual(r.ingested, [{ dedup_key: 'old' }, { dedup_key: 'new' }]);
});

test('N3. no Supabase client means no news was read: that early return does not mark the feed loaded', () => {
  const noClient = providerOnce(/if \(!sb\) \{([^}]*)\}/, 'the no-client early return')[1];
  assert.doesNotMatch(noClient, /setAlertsLoaded\(\s*true\s*\)/, 'a host with no client tells the AI the news feed is quiet');
});

test('N4. a feed left unloaded is read again: the 5 s fallback re-runs hydrateNews while alertsLoaded is false', () => {
  const fallback = providerOnce(/const hydrateFallback = setTimeout\(\(\) => \{([\s\S]*?)\}, (\d+)\);/, 'the hydrate fallback timer');
  assert.match(fallback[1], /if \(!alertsLoadedRef\.current\) hydrateNews\(\);/, 'a failed first read is never retried');
});
