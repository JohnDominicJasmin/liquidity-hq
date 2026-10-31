/* #1631 A and D (#1668): Quick and Deep reads cite dated catalysts, and the server holds the answer to the one tier table.
 *
 * PURE PARTS RUN DIRECTLY: lib/xaiAnswer.ts, lib/etfFlows.ts etfFlowDays, lib/promptTime.ts, and lib/grok.ts's parser, normalizer,
 * applyResultChecks and prompt builders. Expected values are literals written here, not output of the code under test.
 *
 * THE REAL ROUTE RUNS TOO: app/api/grok/route.ts's POST, with the same network stand-in as grokChatServerPrompt.test.mts (Supabase:
 * key set, ban flag, flags, subscription, spend ledger, usage RPC, call log; xAI: records each body). A Pro account, so the coin and
 * timeframe gates pass.
 *
 * WHAT IT CANNOT PROVE: what the model writes (no billed call), or that the Arena card renders "claim - source, when" (a component). */
import test, { after, afterEach, beforeEach } from 'node:test';
import { register } from 'node:module';
import assert from 'node:assert/strict';
import { NextRequest } from 'next/server';

const sentryStub = 'export const captureException = (...a) => { (globalThis.__qaSentry ??= []).push(a); }; export default { captureException };';
register('data:text/javascript,' + encodeURIComponent(
  `export async function resolve(specifier, context, next) {
     if (specifier === '@sentry/nextjs') return { url: 'data:text/javascript,' + encodeURIComponent(${JSON.stringify(sentryStub)}), shortCircuit: true };
     return next(specifier, context);
   }`));

const SUPABASE = 'http://supabase.invalid';
process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'placeholder-anon'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'placeholder-service';
process.env.GROK_API_KEY = 'placeholder-xai';
const UID = '77777777-7777-4777-8777-777777777777';
const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const { answerText, searchCitations } = await import('../lib/xaiAnswer.ts');
const { etfFlowDays } = await import('../lib/etfFlows.ts');
const { utcStamp, ageText } = await import('../lib/promptTime.ts');
/* parseCombinedRead, not parseCombinedResponse — step 2 of 3 on #1727/#1631. The old entry point answers FLAT at 0% for an answer
   that states no verdict, which is the coercion #1651 item 3 removed from the product; the new one refuses and returns null. Dev
   could not change that signature first: `tsconfig`'s `include` covers `.mts`, so dev's own pre-push `tsc` would go red on THIS
   file and the change would be unpushable. So the order is dev adds the strict read, QA moves these call sites, dev deletes the
   default. Every `!` below is load-bearing in exactly one way — it says "this fixture states a verdict, so a null here is a bug in
   the parser, not in the test" — and where a test reads naturally with a real assertion it gets one instead (see P1). */
const { parseCombinedRead, normalizeCombinedResult, applyResultChecks, buildCombinedPrompt, buildQuickPrompt } = await import('../lib/grok.ts');
type GrokContext = import('../lib/grok.ts').GrokContext;
type CombinedResult = import('../lib/grok.ts').CombinedResult;

/* ── reading xAI's answer ──────────────────────────────────────────────── */

test('X1. the answer text is read from both xAI shapes', () => {
  assert.equal(answerText({ choices: [{ message: { content: 'chat text' } }] }, false), 'chat text');
  assert.equal(answerText({ output: [{ type: 'web_search_call' }, { type: 'message', content: [{ text: 'deep text' }] }] }, true), 'deep text');
  assert.equal(answerText({ choices: [{ message: { content: 42 } }] }, false), '');
  assert.equal(answerText(null, true), '');
});

test('X2. citations: the inline annotations first, then the listed sources, deduplicated, http(s) only, at most 10', () => {
  const d = {
    output: [{ type: 'message', content: [{ annotations: [{ url: 'https://inline.example/a' }, { url: 'javascript:alert(1)' }, { url: 'https://inline.example/b' }] }] }],
    citations: ['https://inline.example/a', 'ftp://x.example', ...Array.from({ length: 12 }, (_, i) => `https://listed.example/${i}`)],
  };
  const c = searchCitations(d);
  assert.deepEqual(c.slice(0, 3), ['https://inline.example/a', 'https://inline.example/b', 'https://listed.example/0']);
  assert.equal(c.length, 10);
  assert.ok(c.every((u) => /^https?:\/\//.test(u)));
  assert.equal(new Set(c).size, c.length);
});

/* ── dated ETF flows ───────────────────────────────────────────────────── */

test('F1. ETF days: an unsettled row is skipped, zero is kept, a bad date is skipped, newest first, at most n, in millions', () => {
  const body = { data: [
    { date: '2026-10-21', total_net_inflow: null },
    { date: '2026-10-20', total_net_inflow: '23200000' },
    { date: '2026-10-19', total_net_inflow: 0 },
    { date: '10/18/2026', total_net_inflow: 5e6 },
    { date: '2026-10-17', total_net_inflow: -55066297 },
    { date: '2026-10-16', total_net_inflow: 1e6 },
  ] };
  assert.deepEqual(etfFlowDays(body, 3), [{ date: '2026-10-20', flowM: 23.2 }, { date: '2026-10-19', flowM: 0 }, { date: '2026-10-17', flowM: -55.066297 }]);
  assert.deepEqual(etfFlowDays([{ date: '2026-10-20', total_net_inflow: 1e6 }], 3), [{ date: '2026-10-20', flowM: 1 }], 'a bare array is accepted');
  assert.throws(() => etfFlowDays({ data: [{ date: '2026-10-21', total_net_inflow: '' }] }, 3), 'nothing usable must throw, not look like a quiet day');
});

test('T1. prompt times: a UTC stamp and an age', () => {
  assert.equal(utcStamp(Date.UTC(2026, 9, 21, 5, 12)), '2026-10-21 05:12 UTC');
  assert.equal(ageText(30_000), 'just now'); assert.equal(ageText(45 * 60_000), '45m ago');
  assert.equal(ageText(3 * 3_600_000), '3h ago'); assert.equal(ageText(47 * 3_600_000), '47h ago'); assert.equal(ageText(52 * 3_600_000), '2d ago');
  assert.equal(ageText(-1), 'upcoming');
});

/* ── parsing the answer ────────────────────────────────────────────────── */

const ANSWER = [
  'SIGNAL: BULLISH', 'CONFIDENCE: 82',
  'COUNTED: bullish: 2 (RSI divergence, ETF inflow) | bearish 1 (funding)',
  'CATALYSTS:',
  '- ETF inflow of +$526.7M | SoSoValue | 2026-10-20 00:00 UTC (40h ago)',
  '- Fed speaker hawkish | Reuters | 3h ago',
  '- Something big happening',
  '- A claim | with a source but no date',
  '- Rumoured exchange hack | X post | sometime today',
  '- None found | web search | 2026-10-21 05:00 UTC',
  '- None in input',
  'CHART_ANALYSIS: higher lows', 'REASONING: momentum turning.',
].join('\n');

/* THE CLOCK IS PINNED, and that is not a convenience. Since #1651 the age on a catalyst line is DERIVED from the timestamp on that
   line, so "2d old" today is "3d old" tomorrow, and a test that hard-codes the words would go red overnight for no reason - which
   teaches the next reader to ignore it. `parseCombinedRead` takes `nowMs` for exactly this. The instant is the moment of the read
   that found the defect (QA on #1651: the model wrote "age ~18h" for an article 7.1 hours old). */
const NOW = Date.parse('2026-10-22T10:55:38Z');

test('P1. a catalyst is kept only with a source and a date or age, shown as "claim - source, when"; "None ..." is not a catalyst', () => {
  const r = parseCombinedRead(ANSWER, '1h', 'NY', NOW);
  assert.ok(r, 'the strict read refused an answer that states SIGNAL and CONFIDENCE - the fixture is readable, so this is the parser');
  /* The age is OURS, derived from the stamp: 2026-10-20 00:00 UTC to the pinned now is just under 59 hours, so "2d old". "3h ago"
     carries no parsable stamp, so it is left exactly as the model wrote it - an age we cannot derive is one we cannot stand behind. */
  assert.deepEqual(r.catalysts, ['ETF inflow of +$526.7M - SoSoValue, 2026-10-20 00:00 UTC (2d old)', 'Fed speaker hawkish - Reuters, 3h ago']);
});

test("P1a. the model's OWN age is discarded, not shown beside ours - the defect was a line disagreeing with itself (#1651)", () => {
  const [etf] = parseCombinedRead(ANSWER, '1h', 'NY', NOW)!.catalysts;
  assert.equal(etf.includes('40h'), false, 'the model\'s "(40h ago)" survived: the line carries two ages, which is the defect wearing a hat');
  assert.equal((etf.match(/\(/g) ?? []).length, 1, 'more than one parenthetical on the line');
  assert.match(etf, /\(2d old\)$/, 'the derived age is not at the end of the line');
});

test('P1c. no age is INVENTED where none can be derived: an unparsable "when", and a stamp in the future', () => {
  /* The half most likely to be "improved" later by adding a fallback. Both must come back bare. */
  assert.deepEqual(catalystsOf('- Fed speaker hawkish | Reuters | 3h ago'), ['Fed speaker hawkish - Reuters, 3h ago'], 'an unparsable when gained an age');
  const future = new Date(NOW + 6 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  assert.deepEqual(catalystsOf('- Scheduled CPI | Reuters | ' + future), ['Scheduled CPI - Reuters, ' + future], 'a stamp in the future gained an age');
});

test('P1d. KNOWN GAP, PINNED: an age in the MIDDLE of the "when" is not stripped (Dev, #1651)', () => {
  /* The strip is anchored to the end of the string on purpose - an unanchored one would eat a legitimate parenthetical such as
     "(revised)". So a line that puts its invented age mid-string keeps it. Recorded rather than discovered: if this ever goes green the
     anchoring changed, and someone should decide whether a legitimate parenthetical is now at risk. */
  const [only] = catalystsOf('- Squeeze reversal | CoinDesk | 2026-10-22 03:51 UTC (age ~18h) via newswire');
  assert.ok(only && only.includes('age ~18h'), 'the mid-string age is now stripped - that is a decision, not a tidy-up: ' + only);
});

/* The fixture always states SIGNAL and CONFIDENCE, so a null here means the parser stopped reading a verdict it must read - which is
   a louder failure than any catalyst assertion below, hence the throw rather than a bang. */
const catalystsOf = (...lines: string[]) => {
  const r = parseCombinedRead(['SIGNAL: FLAT', 'CONFIDENCE: 70', 'CATALYSTS:', ...lines, 'REASONING: r.'].join('\n'), '1h', 'NY', NOW);
  if (!r) throw new Error('the strict read refused a fixture that states SIGNAL: FLAT and CONFIDENCE: 70');
  return r.catalysts;
};

test('P1b. an ISO time is a date; a date in the SOURCE slot is not a source, and neither is "memory" (PM audit of #1668, item 7)', () => {
  /* An ISO stamp now GAINS a derived age where it had none: 2026-10-19 14:00Z to the pinned now is just under 69 hours, so "3d old". */
  assert.deepEqual(catalystsOf('- Fed hold | Reuters | 2026-10-19T14:00Z'), ['Fed hold - Reuters, 2026-10-19T14:00Z (3d old)'], 'an ISO-time catalyst was dropped or lost its derived age');
  assert.deepEqual(catalystsOf('- Fed hold | 2026-10-19 | 3h ago'), [], 'a date in the source slot was accepted as a source');
  assert.deepEqual(catalystsOf('- BTC halving cycle | memory | 2d ago'), [], '"memory" was accepted as a source - the prompt forbids it');
});

/* THE POINT OF THE NEW ENTRY POINT, pinned here so step 3 cannot quietly undo itself. `parseCombinedResponse` answers FLAT at 0%
   for an answer that states no verdict - the coercion #1651 item 3 removed from the product, which showed users a "Wait" the model
   never said. `parseCombinedRead` refuses instead. If someone later "simplifies" it back to the defaulting version, the first two
   assertions here go red with that sentence attached, and the fourth stops the fix overshooting into refusing readable answers. */
test('R0. the strict read refuses an answer that states no verdict, and still accepts one that does (#1727 step 2)', () => {
  assert.equal(parseCombinedRead('REASONING: the market looks constructive above 80,900.', '1h', 'NY'), null,
    'prose with no SIGNAL line was read as a verdict - that is the FLAT-at-0 coercion back');
  assert.equal(parseCombinedRead('SIGNAL: BULLISH\nREASONING: no confidence line here.', '1h', 'NY'), null,
    'a SIGNAL with no CONFIDENCE was accepted: half a verdict is not a verdict');
  assert.equal(parseCombinedRead('UNREADABLE', '1h', 'NY'), null,
    'the model saying it cannot read its own answer was accepted as one');
  const ok = parseCombinedRead('SIGNAL: FLAT\nCONFIDENCE: 70\nREASONING: r.', '1h', 'NY');
  assert.ok(ok, 'a readable verdict was refused - the refusal has overshot');
  assert.equal(ok.signal, 'FLAT');
  assert.equal(ok.confidence, 70);
});

test('P2. COUNTED is read, also as "bullish: 2"; with no COUNTED line it is null', () => {
  assert.deepEqual(parseCombinedRead(ANSWER, '1h', 'NY')!.counted, { bullish: 2, bearish: 1 });
  assert.equal(parseCombinedRead('SIGNAL: FLAT\nCONFIDENCE: 70', '1h', 'NY')!.counted, null);
});

test('P2b. a bold, reversed or comma-separated COUNTED line is still read (PM audit of #1668, item 2: an unread one let a full tier through)', () => {
  for (const line of ['**COUNTED:** bullish 3 (a, b, c) | bearish 1 (d)', 'COUNTED: bearish 1 (d) | bullish 3 (a, b, c)', 'COUNTED: bullish 3, bearish 1']) {
    assert.deepEqual(parseCombinedRead(`SIGNAL: BULLISH\nCONFIDENCE: 80\n${line}`, '1h', 'NY')!.counted, { bullish: 3, bearish: 1 }, `not read: ${line}`);
  }
});

test('P2c. a side named INSIDE the other side\'s list is not read as its count (PM re-audit of #1668, item A: it flipped the tier)', () => {
  const line = 'COUNTED: bullish 3 (reclaimed bearish 4h breaker, CVD divergence, RSI 28) | bearish 1 (OI rising)';
  assert.deepEqual(parseCombinedRead(`SIGNAL: BULLISH\nCONFIDENCE: 80\n${line}`, '1h', 'NY')!.counted, { bullish: 3, bearish: 1 });
  const mirrored = 'COUNTED: bullish 1 (bullish 4h engulfing) | bearish 3 (lower high, CVD down, OI rising)';
  assert.deepEqual(parseCombinedRead(`SIGNAL: BEARISH\nCONFIDENCE: 80\n${mirrored}`, '1h', 'NY')!.counted, { bullish: 1, bearish: 3 });
});

/* P2c's line is read right by either half of #1668's fix alone (dropping the parenthesised lists, or reading a side only where it starts a
   segment), so a regression in one half stays green there. Each line here needs its own half: a signal list written without brackets, and
   a bracketed list whose comma split leaves a signal named "bearish ..." at the start of a piece. */
test('P2d. a side named in a list without brackets, or after a comma inside brackets, is not read as its count either', () => {
  for (const line of [
    'COUNTED: bullish 3: reclaimed bearish 4h breaker | bearish 1',
    'COUNTED: bullish 3 (CVD divergence, bearish 4h breaker reclaimed, RSI 28) | bearish 1 (OI rising)',
  ]) {
    assert.deepEqual(parseCombinedRead(`SIGNAL: BULLISH\nCONFIDENCE: 80\n${line}`, '1h', 'NY')!.counted, { bullish: 3, bearish: 1 }, `misread: ${line}`);
  }
});

/* ── the server's checks ───────────────────────────────────────────────── */

const base = (over: Partial<CombinedResult>): CombinedResult => ({ ...parseCombinedRead('SIGNAL: FLAT\nCONFIDENCE: 70\nREASONING: r.', '1h', 'NY')!, ...over });
const NO_CLUSTERS = '=== REALIZED LIQUIDATION CLUSTERS (XRP/USDT, last 24h) ===\nNot available\n';

/* The tier the SIGNAL DECISION GUIDE gives a count, read from the prompt's table, not from applyResultChecks: a full tier needs 3+ and more
   than the other side (and a trigger the server cannot see, so the server can grant at most LEAN on its own), LEAN needs 2+ and more,
   and a tie or fewer than 2 on the leading side is FLAT. PM's audit of #1668 item 1: the first version always fell back to the SAME side's
   LEAN, so BULLISH on 0 vs 5 came out LEAN BULLISH, and 3 vs 3 LEAN BEARISH. */
const BULLISH_SIDE = ['BULLISH', 'LEAN BULLISH'];

test('C1. a full tier its own count does not support is moved to the tier the count gives, never against the count; a supported one is untouched', () => {
  const two = applyResultChecks(base({ signal: 'BULLISH', confidence: 82, counted: { bullish: 2, bearish: 1 } }), '');
  assert.equal(two.signal, 'LEAN BULLISH'); assert.ok(two.confidence <= 75, 'a LEAN tier kept a confidence above its band');
  assert.ok(two.checks!.length >= 1, 'the change is not listed in checks');
  const against = applyResultChecks(base({ signal: 'BULLISH', confidence: 82, counted: { bullish: 0, bearish: 5 } }), '');
  assert.ok(!BULLISH_SIDE.includes(against.signal), `BULLISH on a count of 0 vs 5 came out ${against.signal}: the server leaned against the model's own count`);
  const tied = applyResultChecks(base({ signal: 'BEARISH', confidence: 70, counted: { bullish: 3, bearish: 3 } }), '');
  assert.equal(tied.signal, 'FLAT', 'a tie is FLAT in the tier table, not a LEAN');
  const tiedUp = applyResultChecks(base({ signal: 'BULLISH', confidence: 70, counted: { bullish: 3, bearish: 3 } }), '');
  assert.equal(tiedUp.signal, 'FLAT', 'a 3 vs 3 tie let BULLISH through: a full tier needs more than the other side');
  const three = applyResultChecks(base({ signal: 'BULLISH', confidence: 82, counted: { bullish: 3, bearish: 1 } }), '');
  assert.equal(three.signal, 'BULLISH'); assert.equal(three.confidence, 82); assert.deepEqual(three.checks, []);
});

test('C2. a LEAN tier is held to the count too, a full tier with no readable COUNTED is not shown as checked, and FLAT is never touched', () => {
  const leanAgainst = applyResultChecks(base({ signal: 'LEAN BULLISH', confidence: 65, counted: { bullish: 0, bearish: 4 } }), '');
  assert.ok(!BULLISH_SIDE.includes(leanAgainst.signal), `LEAN BULLISH on 0 vs 4 was left as ${leanAgainst.signal}`);
  const leanOk = applyResultChecks(base({ signal: 'LEAN BEARISH', confidence: 65, counted: { bullish: 1, bearish: 2 } }), '');
  assert.equal(leanOk.signal, 'LEAN BEARISH'); assert.deepEqual(leanOk.checks, []);
  const none = applyResultChecks(base({ signal: 'BEARISH', confidence: 80, reasoning: 'r.', counted: null }), '');
  assert.ok(none.checks!.some((c) => /COUNTED/.test(c)), 'the missing count is not logged');
  assert.ok(none.signal !== 'BEARISH' || none.confidence <= 75 || /unverified|not checked/i.test(none.reasoning),
    'a full tier with no count was shown at full confidence and unmarked, as if it had been checked');
  const flat = applyResultChecks(base({ signal: 'FLAT', confidence: 70, counted: { bullish: 0, bearish: 0 } }), '');
  assert.equal(flat.signal, 'FLAT'); assert.deepEqual(flat.checks, []);
});

test('C3. a raid is dropped only when the clusters section says "Not available"; the spot disclosure is added only when it is missing', () => {
  const raid = { raidSetup: 'LONG FLUSH' as const, raidTarget: '$2.10', raidTrigger: 'lose $2.20' };
  const dropped = applyResultChecks(base(raid), NO_CLUSTERS);
  assert.equal(dropped.raidSetup, null); assert.equal(dropped.raidTarget, null); assert.equal(dropped.raidTrigger, null);
  assert.equal(applyResultChecks(base(raid), '=== REALIZED LIQUIDATION CLUSTERS (XRP/USDT) ===\n$2.31 $1.2M longs\n').raidSetup, 'LONG FLUSH');
  const spotPrompt = 'x\nSpot data unavailable for this coin\ny';
  assert.match(applyResultChecks(base({ reasoning: 'No mention.' }), spotPrompt).reasoning, /perps-vs-spot check was unavailable/);
  assert.equal(applyResultChecks(base({ reasoning: 'Spot volume was not available.' }), spotPrompt).reasoning, 'Spot volume was not available.');
  assert.equal(applyResultChecks(base({ reasoning: 'No mention.' }), 'no such sentence').reasoning, 'No mention.');
});

test('N1. a stored result from before #1668 keeps citations, counted and checks ABSENT; a new one carries them, http(s) only', () => {
  const old = { signal: 'FLAT', confidence: 70, levels: [], catalysts: [], chartAnalysis: '', patterns: [], reasoning: '', waitFor: null, bias: null,
    raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: 1, tf: '1h', session: 'NY' };
  const o = normalizeCombinedResult(old, '1h', 'NY')!;
  assert.ok(!('citations' in o) && !('counted' in o) && !('checks' in o), 'empties were invented for an old result');
  const n = normalizeCombinedResult({ ...old, citations: ['https://a.example', 'javascript:x'], counted: { bullish: 3, bearish: 1 }, checks: ['c'] }, '1h', 'NY')!;
  assert.deepEqual(n.citations, ['https://a.example']); assert.deepEqual(n.counted, { bullish: 3, bearish: 1 }); assert.deepEqual(n.checks, ['c']);
});

/* ── the prompt: one tier table ────────────────────────────────────────── */

function ctx(overrides: Partial<GrokContext>): GrokContext {
  return new Proxy({ ...overrides } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : `<${String(k)}>`), has: () => true }) as unknown as GrokContext;
}
const CHART = { tf: '1h', ema9: 107000, sma200: 98000, rsi: 55, recent20: 'flat', hi: 108900, lo: 105100, lastClose: 107250 };

test('S1. the tiers are defined once: one BULLISH line, no second tier table, no old upgrade or "1-2 signals → FLAT" rules, COUNTED asked for', () => {
  for (const [name, p] of [['Deep', buildCombinedPrompt(ctx({ coin: 'BTC/USDT' }), CHART)], ['Quick', buildQuickPrompt(ctx({ coin: 'BTC/USDT' }), CHART)]] as const) {
    assert.equal((p.match(/^BULLISH:/gm) ?? []).length, 1, `${name}: the BULLISH tier is defined ${(p.match(/^BULLISH:/gm) ?? []).length} times`);
    assert.doesNotMatch(p, /SIGNAL TIERS/); assert.doesNotMatch(p, /upgrade LEAN BULLISH → BULLISH/); assert.doesNotMatch(p, /WEIGHT GEX HEAVILY/);
    assert.doesNotMatch(p, /1–2 (EXHAUSTION|CONTINUATION) signals → FLAT/);
    assert.match(p, /^COUNTED: bullish \[n\]/m, `${name}: no COUNTED line asked for`);
    assert.match(p, /^- \[claim\] \| \[source\] \| \[YYYY-MM-DD HH:MM UTC \(age\)\]$/m, `${name}: the catalyst format is missing`);
    assert.match(p, /None in input/);
  }
  const deep = buildCombinedPrompt(ctx({ coin: 'BTC/USDT' }), CHART), quick = buildQuickPrompt(ctx({ coin: 'BTC/USDT' }), CHART);
  const searchRule = 'Every catalyst you take from these searches needs its source and its UTC publication time';
  assert.ok(deep.includes(searchRule), 'Deep lost the search citation rule'); assert.ok(!quick.includes(searchRule), 'Quick, which has no search, carries it');
  assert.match(deep, /^BTC spot ETFs: <etfFlows>$/m);
});

/* ── /api/grok end to end ──────────────────────────────────────────────── */

const b64u = (b: ArrayBuffer | string) => Buffer.from(typeof b === 'string' ? b : new Uint8Array(b)).toString('base64url');
const KEY = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']) as CryptoKeyPair;
const JWK = { ...(await crypto.subtle.exportKey('jwk', KEY.publicKey)), kid: 'kid-1', alg: 'ES256', use: 'sig' };
const now = Math.floor(Date.now() / 1000);
const h = b64u(JSON.stringify({ alg: 'ES256', kid: 'kid-1', typ: 'JWT' }));
const pl = b64u(JSON.stringify({ sub: UID, email: 'qa@example.test', aud: 'authenticated', role: 'authenticated', iss: `${SUPABASE}/auth/v1`, iat: now, exp: now + 600 }));
const TOK = `${h}.${pl}.${b64u(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, KEY.privateKey, new TextEncoder().encode(`${h}.${pl}`)))}`;

const net = { xai: [] as string[], stray: [] as string[] };
const DEEP_BODY = { model: 'grok-4.3', output: [{ type: 'message', content: [{ text: ANSWER, annotations: [{ url: 'https://news.example/etf' }] }] }], citations: ['https://news.example/fed'] };
const QUICK_BODY = { model: 'grok-4.3', choices: [{ message: { content: ANSWER } }] };
const realFetch = globalThis.fetch;
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const req = input instanceof Request ? input : new Request(String(input), init);
  const url = new URL(req.url);
  if (url.origin === 'https://api.x.ai') { net.xai.push(url.pathname); return json(200, url.pathname === '/v1/responses' ? DEEP_BODY : QUICK_BODY); }
  if (url.origin !== SUPABASE) { net.stray.push(url.host); throw new Error(`stray request ${req.url}`); }
  const p = url.pathname;
  const one = (row: unknown) => ((req.headers.get('accept') ?? '').includes('vnd.pgrst.object') ? json(200, row) : json(200, [row]));
  if (p === '/auth/v1/.well-known/jwks.json') return json(200, { keys: [JWK] });
  if (p === '/rest/v1/rpc/increment_ai_usage') return json(200, 1);
  if (p.startsWith('/rest/v1/rpc/lhq_ai_spend_')) return json(200, 0);
  if (p.endsWith('user_status')) return one({ banned: false });
  if (p.endsWith('user_subscriptions')) return one({ role: 'pro', trial_ends_at: null, current_period_end: null });
  if (req.method === 'GET') return json(200, []);
  return new Response(null, { status: 201 });
}) as typeof fetch;
after(() => { globalThis.fetch = realFetch; });

/* #1683: THE STAND-IN MUST STILL BE INSTALLED WHEN A TEST RUNS. The after() above restores the real fetch, and a top-level
   `await import` SUSPENDS this module - so if any test group has not registered by then, the runner thinks the file is done,
   fires after(), and every later test silently talks to the real internet. That happened in aiFeedsUnknownNotEmpty: one test
   took 26 seconds, called sosovalue for real, got a 403 in the container, and the route correctly answered null - which read as
   a product defect. This guard makes the recurrence name itself instead of presenting as a wrong value.
   IN THIS FILE IT COVERS TWO OF THE TWENTY TESTS, and that is correct rather than partial: X1-S1 above are pure functions over
   strings, registered before the stand-in exists and incapable of touching the network. R1/R2 below are the only ones that import
   the route. Measured by mutation - an early restore reddens 2 and leaves 18 green, which is exactly the set that depends on it. */
const standInFetch = globalThis.fetch;
beforeEach(() => {
  assert.equal(globalThis.fetch, standInFetch,
    'the fetch stand-in is not installed: this run would reach the real network, so it measures nothing about the code under test - see #1683');
});

const { grokBody, contextFor, SERVER_BUILDS_PROMPT } = await import('./_grokBody.mts');
const { POST } = await import('../app/api/grok/route.ts');
const { _resetApiHealthQueue } = await import('../lib/apiHealth.ts');
beforeEach(() => { net.xai = []; net.stray = []; });
afterEach(() => _resetApiHealthQueue());
const read = async (type: 'quick' | 'deep') => {
  const r = await POST(new NextRequest('http://localhost/api/grok', {
    method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${TOK}` },
    /* #1631 item 5: the server builds the prompt now, so the cluster text moves from the
       client-built `prompt` into the `clusters` CONTEXT FIELD it was always describing. The old
       shape is still sent on a tree that has not changed - `_grokBody.mts` reads the tree and
       picks. Both carry the same two facts: the coin is XRP and no clusters are available, which
       is what keeps R1 and R2's raid-rule assertions about the ANSWER rather than about the body. */
    body: JSON.stringify(grokBody({
      type, coin: 'xrp', tf: '1h',
      prompt: `analyse XRP\n${NO_CLUSTERS}`,
      ...(SERVER_BUILDS_PROMPT
        /* THE SECTION HEADER STAYS OUT, and the validator is right to insist. `NO_CLUSTERS` is
           `=== REALIZED LIQUIDATION CLUSTERS (XRP/USDT, last 24h) ===\nNot available\n` - the
           `===` is a PROMPT SECTION MARKER, and the new route refuses any context field that
           carries one, because that is how a client would inject a section the server did not
           write. So the field gets the FACT and the server writes the header: posting the old
           string verbatim comes back `400 Invalid request.`, which is how I found this. */
        ? { override: { context: { ...contextFor('XRP/USDT'), clusters: 'Not available' } } }
        : {}),
    })),
  }));
  return { status: r.status, body: await r.json() as { result?: CombinedResult } };
};

test('R1. Deep keeps its search sources and its checks: citations, the downgrade and the raid rule all reach the answer', async () => {
  const r = await read('deep');
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200)); assert.deepEqual(net.xai, ['/v1/responses']);
  const res = r.body.result!;
  assert.deepEqual(res.citations, ['https://news.example/etf', 'https://news.example/fed']);
  assert.equal(res.signal, 'LEAN BULLISH', 'BULLISH on a count of 2 was not held to the table'); assert.equal(res.confidence, 75);
  assert.deepEqual(res.counted, { bullish: 2, bearish: 1 });
  assert.ok(Array.isArray(res.checks) && res.checks.length >= 1);
  /* Through the route the age is derived against the REAL clock, so the words move with the day - assert the shape: the stamp survives,
     the model's own age does not, and a derived age sits at the end. */
  const [etfCat, fedCat] = res.catalysts;
  assert.match(etfCat, /^ETF inflow of \+\$526\.7M - SoSoValue, 2026-10-20 00:00 UTC \((?:\d+m|[\d.]+h|\d+d) old\)$/, 'the ETF catalyst shape changed: ' + etfCat);
  assert.equal(etfCat.includes('40h'), false, "the model's own age survived through the route");
  assert.equal(fedCat, 'Fed speaker hawkish - Reuters, 3h ago', 'an unparsable when was altered');
});

test('R2. Quick has no search: citations is an empty list, and the same checks apply', async () => {
  const r = await read('quick');
  assert.equal(r.status, 200); assert.deepEqual(net.xai, ['/v1/chat/completions']);
  assert.deepEqual(r.body.result!.citations, []); assert.equal(r.body.result!.signal, 'LEAN BULLISH');
  assert.deepEqual(net.stray, []);
});
