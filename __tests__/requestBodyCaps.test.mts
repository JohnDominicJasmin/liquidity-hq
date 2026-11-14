import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { readCappedText, readJsonCapped, BODY_CAPS } from '../lib/requestBody.ts';

/* #2344 (G7): QA's cells for the request-body cap helpers and the cap table.
 * WHAT THIS PINS: readCappedText / readJsonCapped on an empty body, invalid JSON, a body exactly at the cap, one byte over, a declared content-length over the cap (refused without reading), a streamed body with no
 * or a LYING content-length, and multi-byte characters (bytes, not characters); the cap table equals the numbers the PR states; every capped route reads through the capped reader with ITS key and none keeps an uncapped read.
 * WHAT IT CANNOT PROVE: the routes' answers (qa/harness/bodyCaps.test.mts and aiRoutes.test.mts run them). */

const req = (body: BodyInit | null, headers: Record<string, string> = {}) => new Request('http://localhost/x', { method: 'POST', body, headers, ...(body && typeof body !== 'string' ? { duplex: 'half' } : {}) } as RequestInit);
const stream = (text: string, size: number) => { const enc = new TextEncoder().encode(text); let i = 0; return new ReadableStream({ pull(c) { if (i >= enc.length) return c.close(); c.enqueue(enc.slice(i, i + size)); i += size; } }); };
const json = (bytes: number) => { const head = '{"p":"', tail = '"}'; return head + 'a'.repeat(bytes - head.length - tail.length) + tail; };

test('C1. readJsonCapped: empty body and invalid JSON are not "too large" and give value null; valid JSON is parsed', async () => {
  assert.deepEqual(await readJsonCapped(req(null), 100), { tooLarge: false, value: null });
  assert.deepEqual(await readJsonCapped(req(''), 100), { tooLarge: false, value: null });
  assert.deepEqual(await readJsonCapped(req('not json {'), 100), { tooLarge: false, value: null });
  assert.deepEqual(await readJsonCapped(req('{"a":1}'), 100), { tooLarge: false, value: { a: 1 } });
  assert.deepEqual(await readJsonCapped(req('null'), 100), { tooLarge: false, value: null });
});

test('C2. exactly the cap is accepted, one byte over is too large (string body and chunked body)', async () => {
  assert.equal((await readJsonCapped(req(json(1000)), 1000)).tooLarge, false);
  assert.equal((await readJsonCapped(req(json(1001)), 1000)).tooLarge, true);
  assert.equal((await readJsonCapped(req(stream(json(1000), 64)), 1000)).tooLarge, false);
  assert.equal((await readJsonCapped(req(stream(json(1001), 64)), 1000)).tooLarge, true);
  assert.equal((await readJsonCapped(req(json(1000), { 'content-length': '1000' }), 1000)).tooLarge, false, 'a DECLARED size equal to the cap is accepted');
  assert.equal((await readJsonCapped(req(json(1001), { 'content-length': '1001' }), 1000)).tooLarge, true);
  assert.equal(await readCappedText(req(json(1001)), 1000), null); assert.equal((await readCappedText(req(json(1000)), 1000))!.length, 1000);
});

test('C3. a declared content-length over the cap is refused WITHOUT reading the body; a lying small content-length does not let a big streamed body through', async () => {
  let pulled = 0; const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(10)); if (pulled > 50) c.close(); } }, { highWaterMark: 0 });
  assert.equal(await readCappedText(req(body, { 'content-length': '5000' }), 1000), null); assert.equal(pulled, 0, 'the body was read although the declared size was already over');
  const lying = await readJsonCapped(req(stream(json(5000), 256), { 'content-length': '10' }), 1000); assert.equal(lying.tooLarge, true, 'a body that lies about its size got through');
});

test('C4. the cap counts BYTES: 2-byte and 4-byte characters at the cap in characters are over it in bytes', async () => {
  const two = '{"p":"' + 'é'.repeat(500) + '"}'; assert.ok(two.length < 1000 && new TextEncoder().encode(two).length > 1000);
  assert.equal((await readJsonCapped(req(two), 1000)).tooLarge, true);
  assert.equal((await readJsonCapped(req('{"p":"' + '😀'.repeat(300) + '"}'), 1000)).tooLarge, true, '4-byte characters');
  assert.equal((await readJsonCapped(req('{"p":"' + 'é'.repeat(400) + '"}'), 1000)).tooLarge, false);
});

test('C5. a multi-byte character split across chunk boundaries still decodes (a chunked body is not corrupted)', async () => {
  const text = '{"p":"' + 'é€😀'.repeat(20) + '"}';
  for (const size of [1, 2, 3, 5, 7]) assert.deepEqual(await readJsonCapped(req(stream(text, size)), 1000), { tooLarge: false, value: { p: 'é€😀'.repeat(20) } }, `chunk size ${size}`);
});

test('C6. the cap table is the one the PR states', () => {
  assert.deepEqual({ ...BODY_CAPS }, { settings: 65_536, priceAlerts: 4_096, hypothesis: 65_536, evidence: 32_768, alertPrefs: 4_096, pushSubscribe: 8_192, aiShort: 32_768, aiThesis: 65_536, aiPine: 131_072 });
});

test('C7. source guard: each capped route reads its body through readJsonCapped with ITS cap key, once per handler, and none keeps an uncapped req.json()', () => {
  const want: Array<[string, string, number]> = [
    ['app/api/settings/route.ts', 'settings', 1], ['app/api/price-alerts/route.ts', 'priceAlerts', 2], ['app/api/hypotheses/route.ts', 'hypothesis', 1], ['app/api/hypotheses/[id]/route.ts', 'hypothesis', 1],
    ['app/api/hypotheses/[id]/evidence/route.ts', 'evidence', 1], ['app/api/alert-prefs/route.ts', 'alertPrefs', 1], ['app/api/push/subscribe/route.ts', 'pushSubscribe', 2],
    ['app/api/strategy-research/route.ts', 'aiShort', 1], ['app/api/thesis-check/route.ts', 'aiThesis', 1], ['app/api/pine-script/route.ts', 'aiPine', 1],
  ];
  for (const [file, key, n] of want) {
    const s = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8');
    assert.equal((s.match(new RegExp(`readJsonCapped\\(req, BODY_CAPS\\.${key}\\)`, 'g')) || []).length, n, `${file}: expected ${n} capped read(s) with ${key}`);
    assert.equal((s.match(/req\.json\(\)/g) || []).length, 0, `${file}: an uncapped req.json() is left`);
    assert.ok((s.match(/status: 413/g) || []).length >= n, `${file}: the over-cap answer is not a 413`);
  }
});
