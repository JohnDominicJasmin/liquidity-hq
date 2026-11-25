/* QA: PR #2836 (owner item 52), the outbound-address check answers operators only. The real route runs; the echo service is a stand-in.
 *   E1 no header, a wrong secret, the secret in the query string, and no secret configured: 401, no-store, no address, no outbound call (also when an answer is already cached)
 *   E2 the right header answers as before, and nothing may cache it */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';

const SECRET = 'qa-cron-secret-0123456789', IP = '203.0.113.9';
let out = 0;
const realFetch = globalThis.fetch;
globalThis.fetch = (async () => { out++; return new Response(JSON.stringify({ ip: IP }), { status: 200, headers: { 'content-type': 'application/json' } }); }) as typeof fetch;
after(() => { globalThis.fetch = realFetch; delete process.env.CRON_SECRET; });

const { GET } = await import('../app/api/egress-ip/route') as unknown as { GET: (r: Request) => Promise<Response> };
const call = async (headers: Record<string, string> = {}, query = '') => { const r = await GET(new Request(`http://localhost/api/egress-ip${query}`, { headers })); return { status: r.status, cc: r.headers.get('cache-control') ?? '', text: await r.text() }; };
const refused = async () => {
  for (const [name, headers, query] of [['no header', {}, ''], ['wrong', { 'x-cron-secret': 'x'.repeat(SECRET.length) }, ''], ['empty', { 'x-cron-secret': '' }, ''], ['query', {}, `?secret=${SECRET}`]] as Array<[string, Record<string, string>, string]>) {
    const before = out; const r = await call(headers, query);
    assert.deepEqual([r.status, out - before], [401, 0], name); assert.match(r.cc, /no-store/, name); assert.equal(r.text.includes(IP), false, name);
  }
};

test('E1 E2. operators only, and never cached by anyone', async () => {
  delete process.env.CRON_SECRET;
  await refused();
  assert.equal((await call({ 'x-cron-secret': SECRET })).status, 401, 'no secret configured: nobody');
  process.env.CRON_SECRET = SECRET;
  await refused();
  for (const cached of [false, true]) {
    const r = await call({ 'x-cron-secret': SECRET });
    assert.equal(r.status, 200); assert.equal(JSON.parse(r.text).ip, IP); assert.equal(JSON.parse(r.text).cached, cached);
    assert.equal(r.cc, 'private, no-store');
  }
  await refused();
});
