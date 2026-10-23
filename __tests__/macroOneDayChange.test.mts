/* #1631 C: the S&P / DXY / gold / oil / yen / 10Y change that /api/macro reports is ONE trading day, never two.
 *
 * The route used `previousClose ?? chartPreviousClose`. On a range query Yahoo leaves previousClose out, and chartPreviousClose is the close
 * BEFORE the window, so the "24h" change was a two-session change (S&P +0.69% on a day that was +0.28%). #1665 compares with the bar before
 * the newest. PM's audit then found a gap in that: a NULL previous-session bar was filtered out, so gold compared with the session before
 * it and printed -0.28% on a day Yahoo called +0.14%.
 *
 * THE REAL ROUTE RUNS HERE (app/api/macro/route.ts GET). Only Yahoo and FRED are stand-ins, one crafted chart per symbol, so one request
 * answers every case below. THE ORACLE IS INDEPENDENT: each expected change is worked out by hand from the closes in its fixture and
 * written as a literal; gold's closes are the real GC=F bars PM read at ~14:53 UTC.
 *
 * WHAT IT CANNOT PROVE: what Yahoo sends on any given day (the fixtures are its documented shapes), or how MarketProvider and the
 * Arena prompt print the number (lib/grok.ts prints it as given). */
import test, { after, before, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

type Meta = { regularMarketPrice: number; previousClose?: number; chartPreviousClose?: number; regularMarketChangePercent?: number };
const chartOf = (meta: Meta, closes: (number | null)[]) => ({ chart: { result: [{ meta, indicators: { quote: [{ close: closes }] } }] } });
/* One case per symbol. The newest bar is the latest session; its close can be null mid-session. */
const YAHOO: Record<string, ReturnType<typeof chartOf>> = {
  // S&P, an ordinary day: 7,480 -> 7,500.944 is +0.28%. chartPreviousClose (7,449, before the window) would give +0.70%.
  '%5EGSPC': chartOf({ regularMarketPrice: 7500.944, chartPreviousClose: 7449 }, [7449.5, 7480, 7500.944]),
  // DXY mid-session: the newest close is still null; the change is against yesterday's 99.24.
  'DX-Y.NYB': chartOf({ regularMarketPrice: 99.5, chartPreviousClose: 98.9 }, [99.0, 99.24, null]),
  // Gold, PM's real bars: the previous session's close is NULL. Comparing with 4,160.1 (two sessions back) gives -0.28%; Yahoo says +0.14%.
  'GC%3DF': chartOf({ regularMarketPrice: 4148.4, regularMarketChangePercent: 0.14, chartPreviousClose: 4190 }, [4181.1, 4160.1, null, 4148.4]),
  // Oil with no usable previous close and no change from Yahoo: the change is UNKNOWN, not 0.
  'CL%3DF': chartOf({ regularMarketPrice: 88.85 }, [null, 88.85]),
  // Yen over a weekend: Friday's 152.1 against Thursday's 151.8.
  'JPY%3DX': chartOf({ regularMarketPrice: 152.1, chartPreviousClose: 150.9 }, [151.2, 151.8, 152.1]),
  // The nominal 10Y (#1631 C): 4.12% -> 4.13%.
  '%5ETNX': chartOf({ regularMarketPrice: 4.13, chartPreviousClose: 4.05 }, [4.1, 4.12, 4.13]),
};
const unexpected: string[] = [];
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  if (url.host === 'query1.finance.yahoo.com') {
    const sym = url.pathname.split('/').pop()!;
    if (YAHOO[sym]) return Response.json(YAHOO[sym]);
    unexpected.push(`yahoo ${sym}`);
    return new Response('unknown symbol', { status: 404 });
  }
  if (url.host === 'fred.stlouisfed.org') return new Response('observation_date,DFII10\n2026-10-19,1.80\n2026-10-20,1.85\n', { status: 200 });
  unexpected.push(url.host);
  return new Response('[]', { status: 200 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

/* #1683: THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS. The after() above restores the real fetch, and a top-level
   `await import` SUSPENDS this module - so if any test group has not registered by then, the runner thinks the file is done,
   fires after(), and every later test silently talks to the real internet. That happened in aiFeedsUnknownNotEmpty: one test
   took 26 seconds, called sosovalue for real, got a 403 in the container, and the route correctly answered null - which read as
   a product defect. This guard makes the recurrence name itself instead of presenting as a wrong value. */
const standInFetch = globalThis.fetch;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch,
    'the fetch stand-in is not installed: this run would reach the real network, so it measures nothing about the code under test - see #1683');
});

const { GET } = await import('../app/api/macro/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
type Series = { price: number; chg: number | null } | null;
let macro: Record<string, Series>;
before(async () => {
  const r = await GET(new NextRequest('https://qa.invalid/api/macro', { headers: { 'cf-connecting-ip': '198.51.100.7' } }));
  assert.equal(r.status, 200);
  macro = await r.json() as Record<string, Series>;
});
after(() => _resetApiHealthQueue());

const near = (got: number | null | undefined, want: number, what: string) =>
  assert.ok(typeof got === 'number' && Math.abs(got - want) < 1e-9, `${what}: got ${got}, want ${want}`);

test('D1. an ordinary day is the change from yesterday\'s close, not from the close before the window: S&P +0.28%, not +0.70%', () => {
  near(macro.spx?.chg, 0.28, 'S&P');
  assert.equal(macro.spx?.price, 7500.944);
});

test('D2. mid-session (the newest close still null), the change is against yesterday\'s close: DXY 99.24 -> 99.5', () => {
  near(macro.dxy?.chg, ((99.5 - 99.24) / 99.24) * 100, 'DXY');
});

test('D3. a NULL previous-session bar is not skipped: gold reads Yahoo\'s +0.14%, never the two-session -0.28% (PM\'s audit, GC=F)', () => {
  near(macro.gold?.chg, 0.14, 'gold');
  assert.equal(macro.gold?.price, 4148.4);
});

test('D4. with no previous close and no change from Yahoo, the change is UNKNOWN: the price is still served, the change is not 0', () => {
  assert.equal(macro.oil?.price, 88.85, 'oil\'s price should still be served');
  const chg = macro.oil?.chg;
  assert.ok(!(typeof chg === 'number' && Number.isFinite(chg)), `an unknown change was served as a number: ${chg}`);
});

test('D5. over a weekend the last two closes still compare one session: yen Thursday 151.8 -> Friday 152.1', () => {
  near(macro.jpy?.chg, (0.3 / 151.8) * 100, 'yen');
});

test('D6. the nominal 10Y (^TNX) is served with its one-day change: 4.12% -> 4.13%', () => {
  assert.equal(macro.tnx?.price, 4.13);
  near(macro.tnx?.chg, (0.01 / 4.12) * 100, '10Y');
});

test('D7. CONTROL: every symbol the route asked for was one this file answers', () => {
  assert.deepEqual(unexpected, []);
});
