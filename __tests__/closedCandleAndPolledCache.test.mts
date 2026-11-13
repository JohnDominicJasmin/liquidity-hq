/* #1626 part 2, A (#1645) and B (#1646): a closed-candle klines answer is keyed by the candle it was fetched in, and a polled answer is never
 * reused by the browser.
 *
 * WHAT THIS PINS: closedCandleKey is the open time of the current UTC candle as of CLOSE_SKEW_MS ago (so the key keeps the old candle for the first
 * 3 s after a close and flips after), for 1h, 4h and 1d at both sides of a close; a non-positive or NaN interval keys as 0; weekly and monthly
 * intervals have no fixed length (intervalToMs null), so the route keys them as before. The klines route builds its closed tag from the key and
 * keeps an entry for at least a whole candle. polledCacheControl says max-age=0, must-revalidate and no stale-while-revalidate, and all 13 polled
 * routes use it.
 *
 * WHAT IT CANNOT PROVE: what an exchange returns in the first seconds after a close, or what a real browser does with the header (Dev measured
 * transferSize in Chrome; my live check after promotion repeats it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { closedCandleKey, intervalToMs, CLOSE_SKEW_MS } from '../lib/candles.ts';
import { polledCacheControl } from '../lib/cacheHeaders.ts';
import { appPath, appFiles } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');

/* ── PATHS ARE RESOLVED, AND A MISSING ONE IS A FINDING RATHER THAN AN ENOENT ──────────────────
 *
 * This file held 14 hardcoded `app/api/.../route.ts` literals and used none of `_appPath.mts`,
 * which made it the highest unmitigated move hazard in the suite (#1413's triage, 2026-10-31).
 * It survived #1884 - which moved the rsi and snapshot DATA LAYERS into `lib/` - by luck rather
 * than design: `polledCacheControl` happened to stay in the handler. `rsiWilderOracle` S1 did not
 * survive the same change, and that was the same week.
 *
 * TWO THINGS WERE WRONG, and the second is the one nobody had looked at.
 *
 * ONE: a moved route made `read()` throw ENOENT. A filesystem error is not a finding - it says
 * nothing about whether polled routes send the header, which is what the cell is for. Resolving
 * through `appPath` handles a route-group move, and a genuinely missing route now fails with a
 * message that says what to do about it.
 *
 * TWO: THE LIST WAS CHECKED IN ONE DIRECTION ONLY. B2 walked its own 13 names and asserted each
 * sends the header. **A fourteenth polled route that forgot the header was invisible** - it is not
 * in the list, so nothing looked at it - and so was one that uses the header but was never added,
 * which makes the "13" in this file's own header stale without anything failing. B3 closes that
 * direction: every route importing `polledCacheControl` must be listed. */
const resolveRoute = (rel: string): string => {
  try { return appPath(rel); } catch {
    assert.fail(
      `${rel} does not exist. A polled route has MOVED or been deleted, so this list is out of date - ` +
      're-derive POLLED_ROUTES from the routes that import polledCacheControl (see B3) rather than ' +
      'deleting the entry, because a route that moved still has to send the header.',
    );
  }
};
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const T = (iso: string) => Date.parse(iso);
const H = 3_600_000;

test('A1. the skew is 3 s and the key keeps the CLOSED candle for exactly that long after a close (1h)', () => {
  assert.equal(CLOSE_SKEW_MS, 3000);
  const close = T('2026-10-21T05:00:00Z');
  assert.equal(closedCandleKey(H, close - 1), T('2026-10-21T04:00:00Z'), 'just before the close');
  assert.equal(closedCandleKey(H, close + CLOSE_SKEW_MS - 1), T('2026-10-21T04:00:00Z'), 'inside the skew after the close');
  assert.equal(closedCandleKey(H, close + CLOSE_SKEW_MS), T('2026-10-21T05:00:00Z'), 'the skew has passed: a new key');
  assert.equal(closedCandleKey(H, close + 30 * 60_000), T('2026-10-21T05:00:00Z'));
});

test('A2. 4h and 1d keys follow the exchanges\' UTC candles (4h at 00/04/08/..., 1d at midnight UTC)', () => {
  const h4 = intervalToMs('4h')!; const d1 = intervalToMs('1d')!;
  assert.equal(h4, 4 * H); assert.equal(d1, 24 * H);
  assert.equal(closedCandleKey(h4, T('2026-10-21T07:59:59Z')), T('2026-10-21T04:00:00Z'));
  assert.equal(closedCandleKey(h4, T('2026-10-21T08:00:02Z')), T('2026-10-21T04:00:00Z'), 'inside the skew');
  assert.equal(closedCandleKey(h4, T('2026-10-21T08:00:03Z')), T('2026-10-21T08:00:00Z'));
  assert.equal(closedCandleKey(d1, T('2026-10-21T23:59:59Z')), T('2026-10-21T00:00:00Z'));
  assert.equal(closedCandleKey(d1, T('2026-10-22T00:00:03Z')), T('2026-10-22T00:00:00Z'), 'the next morning is a different key (the 16-hour-old daily of #1626)');
});

test('A3. a non-positive or NaN interval keys as 0; weekly and monthly have no fixed length and get no candle key', () => {
  for (const iv of [0, -60_000, Number.NaN]) assert.equal(closedCandleKey(iv, Date.now()), 0);
  for (const iv of ['1w', '1W', '1M']) assert.equal(intervalToMs(iv), null, `${iv} must not be keyed by epoch arithmetic`);
});

/* ── A4 PINNED THE VULNERABLE LINE, AND SO IT MANDATED THE BUG AND REJECTED THE FIX ──────────────
 *
 * This cell used to require, verbatim:
 *
 *     const closedTag = ivMs != null ? `:closed:${closedCandleKey(ivMs, Date.now())}` : '';
 *
 * That `: ''` IS the defect. An interval with no computable boundary produced an EMPTY tag, so a
 * `closed=1` request and a live one landed on the SAME cache key - and once the forming bar started
 * depending on `closed`, the two bodies differed, so whichever request populated the key first
 * served its answer to the other kind of caller. A closed-candle reader getting a bar whose close
 * keeps moving is the un-firing signal that `closed=1` exists to prevent, and `closed` is a query
 * parameter any client sets.
 *
 * So the guard was satisfied by the TEXT rather than the property, and ended up protecting the
 * defect: Dev Team's fix could not land while this assertion stood. Found by the automated security
 * review of their commit, not by this cell, which had every opportunity.
 *
 * LOOSENED HERE RATHER THAN RETIGHTENED, DELIBERATELY, and pushed before the fix: `CONTRIBUTING.md`
 * step 0 says a QA pin blocking Dev is loosened to a form green on BOTH trees and pushed FIRST.
 * Every property below is true on `dev` and on the fix. The one property that is NOT true on `dev` -
 * that the non-boundary fallback is non-empty - cannot be asserted from here without turning `dev`
 * red, so it arrives in A5 with the fix. A5 is the cell that matters; this one is the floor.
 *
 * WHAT WENT: the verbatim pin of the whole expression, and a pin requiring `closedOnly` and `ivMs`
 * to be ADJACENT lines. The adjacency was incidental - Dev moved `closedOnly` above a closure that
 * now reads it, which is correct, because `const` is not hoisted and a closure depending on where it
 * happens to be invoked is one refactor from a TDZ crash on a billed route. */
test('A4. the klines route keys a closed request by the candle and keeps it at least a whole candle; a live request stays a different key', () => {
  const src = stripTsComments(read(resolveRoute('app/api/market/klines/route.ts')));
  /* THE PROPERTY, NOT THE EXPRESSION: the tag is derived from the candle key. How the surrounding
     ternary is spelled is the route's business - that is what pinning it cost. */
  assert.ok(/closedTag\s*=/.test(src), 'the closed tag is gone entirely');
  assert.ok(/closedCandleKey\(\s*ivMs/.test(src), 'the closed tag is no longer derived from the candle key');
  assert.ok(/const ttl = ivMs != null \? Math\.max\(ivMs \+ CLOSE_SKEW_MS, ttlFor\(interval\)\) : ttlFor\(interval\);/.test(src), 'the closed-candle TTL is not at least a whole candle');
  /* OPT-IN, WITHOUT REQUIRING ADJACENCY. Two separate properties, each checked on its own:
     `closedOnly` comes from the query parameter, and `ivMs` is gated on `closedOnly`. Where those
     two lines sit relative to each other is not a property of anything. */
  assert.ok(/const closedOnly = q\.get\('closed'\) === '1';/.test(src),
    'closed keying is no longer opt-in from the `closed` query parameter');
  /* GATED ON `closedOnly`, AND THE LIVE BRANCH YIELDS null - matched across line breaks, because
     the ternary's LAYOUT is not a property and pinning it cost a red `dev`.
     This read `/const ivMs = closedOnly \?/`, requiring the `?` on the same line. #1985 added
     Hyperliquid's ms lookup, which made the ternary three branches wide and wrapped it:
         const ivMs = closedOnly
           ? (source === 'okx' ? okxBarToMs(interval)
             : source === 'hyperliquid' ? hlIntervalToMs(interval)
             : intervalToMs(interval))
           : null;
     The gate was still there and still correct; only the formatting moved, and every open PR went
     red on a cell whose own comment four lines up says "THE PROPERTY, NOT THE EXPRESSION: how the
     surrounding ternary is spelled is the route's business - that is what pinning it cost." I wrote
     that sentence and then pinned a ternary's spelling directly beneath it.
     Two assertions rather than one, so each failure names what broke: the gate, or the live branch
     no longer being null. A live request must compute NO boundary - that is what keeps `closedTag`
     empty for it, which is what keeps the two kinds of caller off one cache key. */
  assert.ok(/const ivMs = closedOnly\s*\?/.test(src),
    'ivMs is no longer gated on closedOnly, so a live request would compute a boundary it does not use');
  assert.ok(/const ivMs = closedOnly[\s\S]{0,400}?:\s*null;/.test(src),
    'the live branch of ivMs no longer yields null - without that, closedTag stops being empty for a '
    + 'live request and the closed/live key separation this cell exists for is gone');
  assert.ok(!/closedCandleTtl\(/.test(src), 'the old read-timed TTL (the bug) is back');

  /* THE FALLBACK PROPERTY IS NOT HERE, AND THAT IS THE POINT. It is false on `dev`, so asserting it
     from this cell would turn `dev` red. It lives in A5, which arrives with the fix. */
});

test('B1. the polled header: max-age=0, must-revalidate, s-maxage for a shared cache, and no stale-while-revalidate', () => {
  assert.equal(polledCacheControl(300), 'public, max-age=0, must-revalidate, s-maxage=300');
  assert.equal(polledCacheControl(59.9), 'public, max-age=0, must-revalidate, s-maxage=59');
  assert.equal(polledCacheControl(-5), 'public, max-age=0, must-revalidate, s-maxage=0');
  assert.ok(!/stale-while-revalidate/.test(polledCacheControl(60)));
});

/** The polled routes, by logical path. Hand-maintained because "polled" is a property of the CLIENT
 *  - no source read can tell a route the browser polls from one it calls once - so B3 checks the
 *  one direction that IS derivable: nothing uses the header without being listed here. */
const POLLED_ROUTES = [
  'app/api/cmc/route.ts', 'app/api/cycle/route.ts', 'app/api/econ-calendar/route.ts',
  'app/api/forex/jpy/route.ts', 'app/api/funding/route.ts', 'app/api/macro/route.ts',
  'app/api/market/account-ratio/route.ts', 'app/api/market/agg-trades/route.ts',
  'app/api/market/funding-rate/route.ts', 'app/api/market/klines/route.ts',
  'app/api/market/open-interest/route.ts', 'app/api/market/snapshot/route.ts',
  'app/api/proxy/route.ts',
];

test('B2. every polled route sends the polled header and none keeps a stale-while-revalidate header', () => {
  /* A FLOOR, NOT A COUNT. The title and this file's header used to say "the 13 polled routes", so
     adding a fourteenth meant editing a number in two places or leaving one of them wrong. */
  assert.ok(POLLED_ROUTES.length >= 13, `only ${POLLED_ROUTES.length} polled routes listed - there were 13 on 2026-10-31, so the list has lost entries`);
  for (const r of POLLED_ROUTES) {
    const resolved = resolveRoute(r);
    const src = stripTsComments(read(resolved));
    assert.ok(/'Cache-Control':\s*polledCacheControl\(/.test(src), `${resolved} does not send polledCacheControl as its Cache-Control`);
    assert.ok(!/stale-while-revalidate/.test(src), `${resolved} still sends stale-while-revalidate: the browser can hand back the previous poll`);
  }
});

test('B3. nothing uses the polled header without being listed - the direction B2 cannot see', () => {
  /* B2 walks its own list, so a route that uses this header and was never added is invisible to it,
     and so is a route whose entry was dropped. Both leave the list quietly wrong. This is the
     mirror, and it is derivable: a route that imports polledCacheControl is a polled route. */
  const users = appFiles()
    .filter((f) => /\/route\.ts$/.test(f))
    .filter((f) => /\bpolledCacheControl\b/.test(stripTsComments(read(f))))   // CODE ONLY: a route whose COMMENT names the helper (to say it does not use it, #2245) is not a user of it
    .sort();
  assert.ok(users.length >= 13, `only ${users.length} routes import polledCacheControl - the scan is broken, so the comparison below would be a false pass`);

  const listed = new Set(POLLED_ROUTES.map((r) => resolveRoute(r)));
  const unlisted = users.filter((f) => !listed.has(f));
  assert.deepEqual(
    unlisted, [],
    `${unlisted.join(', ')} uses polledCacheControl and is not in POLLED_ROUTES. Add it: B2 only walks ` +
    'its own list, so an unlisted route is one nothing checks for stale-while-revalidate - and the ' +
    'route count quoted in this file\'s header is wrong until it is added.',
  );
});
