/* #2217 / #1651: the one structured line written at every 502 a Deep click can answer. Unit cells on the pure helper (L3 and the line's shape);
 * the route-level cells (L1 klines, L2 grok, L4 no line on a 200) are in deep502Routes.test.mts.
 *
 *   THE LINE:  [deep502] {"evt":"deep502","route":..,"kind":..,"upstream":..,"upstreamStatus":..,"coin":..,"ms":..}
 *   fixed field names in that order; every value clamped inside the helper, so no user data can reach it because there is no field for any. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { deep502Line, logDeep502, type Deep502Fields } from '../lib/deep502Log.ts';

const base: Deep502Fields = { route: '/api/market/klines', kind: 'klines-upstream', upstream: 'binance', upstreamStatus: 429, coin: 'BTCUSDT', ms: 412 };
const parse = (line: string) => JSON.parse(line.slice('[deep502] '.length)) as Record<string, unknown>;

test('D1. the line is exactly "[deep502] " + one JSON object, with the fixed fields in the fixed order', () => {
  const line = deep502Line(base);
  assert.ok(line.startsWith('[deep502] '), 'the prefix changed');
  assert.ok(!line.includes('\n'), 'the line spans more than one line');
  assert.equal(line, '[deep502] {"evt":"deep502","route":"/api/market/klines","kind":"klines-upstream","upstream":"binance","upstreamStatus":429,"coin":"BTCUSDT","ms":412}');
  assert.deepEqual(Object.keys(parse(line)), ['evt', 'route', 'kind', 'upstream', 'upstreamStatus', 'coin', 'ms']);
});

test('D2. all four kinds and both routes are representable', () => {
  for (const [route, kind] of [['/api/market/klines', 'klines-upstream'], ['/api/grok', 'grok-empty'], ['/api/grok', 'grok-unreadable'], ['/api/grok', 'grok-strict-refused']] as const) {
    const o = parse(deep502Line({ ...base, route, kind, upstream: route === '/api/grok' ? 'xai' : 'bybit', upstreamStatus: null }));
    assert.equal(o.route, route); assert.equal(o.kind, kind); assert.equal(o.upstreamStatus, null);
  }
});

test('D3. a hostile coin or upstream (spaces, quotes, newline, a token-like string, 200 characters) comes out clamped to a safe set and length', () => {
  const hostile = 'a b"c\n{"x":1} Bearer eyJhbGciOiJIUzI1NiJ9.payload.sig ' + 'Z'.repeat(200);
  const o = parse(deep502Line({ ...base, coin: hostile, upstream: hostile }));
  assert.match(String(o.coin), /^[A-Za-z0-9_.:-]{1,24}$/, `coin is not clamped: ${JSON.stringify(o.coin)}`);
  assert.match(String(o.upstream), /^[A-Za-z0-9_.:-]{1,16}$/, `upstream is not clamped: ${JSON.stringify(o.upstream)}`);
  assert.ok(!deep502Line({ ...base, coin: hostile }).includes('\n'), 'a newline in a field broke the one-line shape');
});

test('D4. a non-finite or fractional status and a negative, NaN or infinite ms come out as null / a non-negative integer', () => {
  assert.equal(parse(deep502Line({ ...base, upstreamStatus: Number.NaN })).upstreamStatus, null);
  assert.equal(parse(deep502Line({ ...base, upstreamStatus: Number.POSITIVE_INFINITY })).upstreamStatus, null);
  assert.equal(parse(deep502Line({ ...base, upstreamStatus: 503.9 })).upstreamStatus, 503);
  assert.equal(parse(deep502Line({ ...base, ms: -5 })).ms, 0);
  assert.equal(parse(deep502Line({ ...base, ms: Number.NaN })).ms, 0);
  assert.equal(parse(deep502Line({ ...base, ms: Number.POSITIVE_INFINITY })).ms, 0);
  assert.equal(parse(deep502Line({ ...base, ms: 12.7 })).ms, 12);
});

test('D5. an empty or missing coin and upstream become "unknown", not an empty string', () => {
  const o = parse(deep502Line({ ...base, coin: '', upstream: undefined as unknown as string }));
  assert.equal(o.coin, 'unknown'); assert.equal(o.upstream, 'unknown');
});

/* ── L3: NO USER DATA. The scan looks for what must never appear. Its POSITIVE CONTROL is a deliberately leaky line, so a scan that cannot
      fail is caught. ── */
const FIXTURE = {
  userId: '9489f7cf-3d9f-4f1e-8648-c5611562d466',
  email: 'qa.fixture@example.com',
  token: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJxYSJ9.c2lnbmF0dXJl',
  prompt: 'You are a trading analyst. Context: BTC 4h bullish, funding negative, answer in JSON',
};
const leaks = (line: string) => Object.entries(FIXTURE).filter(([, v]) => line.includes(v) || line.includes(v.slice(0, 12))).map(([k]) => k);

test('L3a. CONTROL: the scan finds each planted fixture value in a deliberately leaky line, so it can fail', () => {
  for (const [k, v] of Object.entries(FIXTURE)) assert.deepEqual(leaks(`[deep502] {"coin":"${v}"}`), [k], `the scan missed a planted ${k}`);
});

test('L3b. an email, a bearer token with its spaces and a prompt, put in EVERY field, never reach the line (the clamp drops spaces, @ and quotes)', () => {
  const stuffed = `${FIXTURE.email} Bearer ${FIXTURE.token} ${FIXTURE.prompt}`;
  for (const route of ['/api/market/klines', '/api/grok'] as const) {
    for (const kind of ['klines-upstream', 'grok-empty', 'grok-unreadable', 'grok-strict-refused'] as const) {
      const line = deep502Line({ route, kind, upstream: stuffed, upstreamStatus: 502, coin: stuffed, ms: 1 });
      const found = leaks(line).filter(k => k !== 'userId' && k !== 'token');
      assert.deepEqual(found, [], `the line leaked ${found}: ${line}`);
    }
  }
});

/* L3e WAS A TODO (the clamp was a character set a UUID satisfies); #2217 b3a6efee now writes 'unknown' for any coin that is not 1-20 alphanumerics
   (one optional hyphen segment) and any upstream that is not lowercase letters (one optional hyphen). Hard assertions now. */
test('L3e. a user id, a JWT-like token or a dotted string in coin or upstream comes out as "unknown", never as a prefix of itself', () => {
  for (const hostile of [FIXTURE.userId, FIXTURE.token, 'a.b.c', FIXTURE.email, 'x'.repeat(40)]) {
    const o = parse(deep502Line({ ...base, coin: hostile, upstream: hostile }));
    assert.equal(o.coin, 'unknown', `coin kept ${JSON.stringify(o.coin)} for ${hostile.slice(0, 20)}`);
    assert.equal(o.upstream, 'unknown', `upstream kept ${JSON.stringify(o.upstream)} for ${hostile.slice(0, 20)}`);
  }
});

test('L3f. CONTROL: real values still pass - BTCUSDT, BTC-USDT, binance, binance-futures - so L3e is not an always-unknown helper', () => {
  for (const [coin, upstream] of [['BTCUSDT', 'binance'], ['BTC-USDT', 'binance-futures'], ['1000PEPE', 'bybit'], ['sol', 'xai']] as const) {
    const o = parse(deep502Line({ ...base, coin, upstream }));
    assert.equal(o.coin, coin); assert.equal(o.upstream, upstream);
  }
});

test('L3c. logDeep502 writes exactly the built line, once, with console.error', () => {
  const calls: unknown[][] = [];
  const orig = console.error;
  console.error = (...a: unknown[]) => { calls.push(a); };
  try { logDeep502(base); } finally { console.error = orig; }
  assert.equal(calls.length, 1, `expected one console.error call, got ${calls.length}`);
  assert.deepEqual(calls[0], [deep502Line(base)]);
});

test('L3d. there is no field that could carry free text: the helper accepts only the seven keys', () => {
  const o = parse(deep502Line({ ...base, userId: FIXTURE.userId, prompt: FIXTURE.prompt } as unknown as Deep502Fields));
  assert.deepEqual(Object.keys(o), ['evt', 'route', 'kind', 'upstream', 'upstreamStatus', 'coin', 'ms'], 'an extra key reached the line');
  assert.deepEqual(leaks(JSON.stringify(o)), []);
});
