/* #2433 (U4): the six remaining metered routes give a use back when no answer reached the user: briefing, token-unlock, onchain, thesis-check, strategy-research, pine-script.
 *
 * SOURCE PINS, and why not route runs: each route needs its own market/stand-in world (cached closures, Yahoo, Coinglass...), and the behaviour of the SAME refund rule is already pinned at route level for
 * /api/grok-chat, shadow-account and behavioral-bias in aiRefundOnNothingDelivered.test.mts. What regresses here is wiring: a route that loses its refund (a customer charged for nothing) or gains one on a
 * delivered answer (free AI). So each route is pinned to: the reservation DATE captured BEFORE the reservation (a Deep call can outlive UTC midnight; recomputing it refunds the wrong day), the refund helper bound to
 * the RIGHT column/tool, and the exact number of refund sites (every failure path covered, no extra one on the success path).
 * A control proves the matcher: it must find the reservation in every route, so a refactor of the call shape turns this red instead of silently matching nothing. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
const src = (rel: string) => code(readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n'));
const count = (s: string, needle: string) => s.split(needle).length - 1;

/* route, how a refund is written there, how many refund sites (non-2xx, throw, and for onchain also an unparseable 2xx) */
const ROUTES: { file: string; reserve: string; refund: string; sites: number; why: string }[] = [
  { file: 'app/api/briefing/route.ts', reserve: 'incrementUsageColumn(', refund: "refundUsageColumn(userId, 'briefing_count', reservedOn)", sites: 3, why: 'non-2xx, an EMPTY 2xx reply (#2509: a blank card is a failed answer), and a throw before the 2xx (a billed flag guards the throw)' },
  { file: 'app/api/token-unlock/route.ts', reserve: "incrementToolUsage(authData.user.id, 'tokenUnlock'", refund: 'giveBack()', sites: 2, why: 'throw and non-2xx, inside the cache miss' },
  { file: 'app/api/onchain/route.ts', reserve: "incrementToolUsage(authData.user.id, 'onchain'", refund: 'giveBack()', sites: 3, why: 'throw, non-2xx and an unparseable / cut-off 2xx (the user got nothing)' },
  { file: 'app/api/thesis-check/route.ts', reserve: "incrementToolUsage(authData.user.id, 'thesisCheck'", refund: "refundToolUsage(authData.user.id, 'thesisCheck', reservedOn)", sites: 2, why: 'throw and non-2xx' },
  { file: 'app/api/strategy-research/route.ts', reserve: "incrementToolUsage(authData.user.id, 'strategyResearch'", refund: "refundToolUsage(authData.user.id, 'strategyResearch', reservedOn)", sites: 2, why: 'throw and non-2xx' },
  { file: 'app/api/pine-script/route.ts', reserve: "incrementToolUsage(authData.user.id, 'pineScript'", refund: "refundToolUsage(authData.user.id, 'pineScript', reservedOn)", sites: 2, why: 'throw and non-2xx' },
];

for (const r of ROUTES) {
  test(`U4. ${r.file}: the reservation date is captured before the reservation, and the use is given back on exactly ${r.sites} paths (${r.why})`, () => {
    const s = src(r.file);
    const reserveAt = s.indexOf(r.reserve);
    assert.ok(reserveAt > 0, `CONTROL: the reservation call was not found (${r.reserve}): the matcher lost its target`);
    const dateAt = s.indexOf('const reservedOn = todayUtc();');
    assert.ok(dateAt > 0 && dateAt < reserveAt, 'the reservation date is not captured before the reservation: a refund after UTC midnight would hit the next day');
    assert.equal(count(s, r.refund), r.sites, `expected ${r.sites} refund site(s) written as ${r.refund}: a missing one charges a customer for nothing, an extra one refunds a delivered answer (free AI)`);
  });
}

test('U4b. onchain and token-unlock refund INSIDE the cache miss, so a cache hit stays free and a miss that fails costs nothing; the helper is bound to the right tool', () => {
  for (const [file, tool] of [['app/api/onchain/route.ts', 'onchain'], ['app/api/token-unlock/route.ts', 'tokenUnlock']] as const) {
    const s = src(file);
    assert.ok(s.includes(`const giveBack = () => refundToolUsage(authData.user.id, '${tool}', reservedOn);`), `${file}: the refund helper is bound to the wrong tool (it would refund another tool's counter)`);
    assert.ok(s.indexOf('const giveBack') > s.indexOf('cached('), `${file}: the refund helper is defined before the cache miss callback`);
  }
});
test('U4c. briefing: a refund after a throw is guarded by billed (set at the 2xx), so a delivered briefing is never refunded', () => {
  const s = src('app/api/briefing/route.ts');
  assert.ok(s.includes('billed = true;') && s.includes('if (!billed) await refundUsageColumn(userId'), 'the throw path no longer checks billed');
  assert.ok(s.indexOf('billed = true;') < s.indexOf('if (!billed) await refundUsageColumn'), 'billed is set after the catch that reads it');
});
