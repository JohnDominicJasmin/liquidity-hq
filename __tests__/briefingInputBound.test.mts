/* #1833: `/api/briefing` REFUSES A CONTEXT OVER 64,000 CHARACTERS, and nothing tested that.
 *
 * WHY THIS FILE EXISTS. #1833 added `if (context.length > 64_000) return 400` at
 * `app/api/briefing/route.ts:82` and shipped it with **no test anywhere** - PM searched
 * `__tests__` and `qa/` for the literal and found nothing, against a control proving the search
 * can match it in app code. So a new rejection path reached a release having never been executed.
 *
 * It was going to be covered by the deployed-route check in `qa/tools/regress/release-regression.mjs`,
 * and that check was blocked by a dev Supabase auth outage on the night of the release. **The outage
 * was not hiding a covered path; it was the only instrument that had ever been pointed at it.**
 *
 * WHAT THIS PROVES AND WHAT IT DOES NOT, because the distinction decided a release.
 *   PROVES:   the branch, the boundary, and that the 400 comes from the SIZE gate rather than the
 *             empty-context gate above it - reached THROUGH the real auth check, not around it.
 *   DOES NOT: that the deployed route behaves this way. A handler test runs the module; it does not
 *             exercise Next's request pipeline, the real Supabase, or the network. The deployed path
 *             stayed unexercised on release night and the release was held for it.
 *
 * IT GOES THROUGH THE REAL AUTH GATE rather than stubbing past it, which is the part worth the
 * effort. Auth sits at `:54/:58`, the bound at `:82`, so stepping over auth would prove the branch
 * while leaving "can a caller actually reach it" unanswered. Instead this mints a genuine ES256
 * token: `lib/authUser.ts` fetches a JWKS from `${SUPABASE_URL}/auth/v1/.well-known/jwks.json` and
 * verifies locally with WebCrypto, so a keypair generated here, published through the fetch
 * stand-in and used to sign the token passes the same code a real token passes.
 *
 * No network, no dev Supabase, no credentials. `globalThis.fetch` is replaced for the whole file.
 */
import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';

const SUPABASE_URL = 'http://stand-in.invalid';
const KID = 'qa-test-key-1';

process.env.NEXT_PUBLIC_SUPABASE_URL = SUPABASE_URL;
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon_stand_in';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'service_stand_in';
process.env.NEXT_PUBLIC_APP_ENV = 'dev';
/* `GROK_API_KEY`, not `XAI_API_KEY` - the route reads the former at `route.ts:15` and answers
 * **503 at `:44`** without it, which is ABOVE auth. Setting the wrong name sent every case to that
 * 503, and the test is how I learned the real gate order: key, then the `grok` feature flag at
 * `:47`, THEN auth at `:53/:58`, then the empty-context check, then the bound at `:82`. I had
 * recorded the order from reading the file and had missed the two gates above auth. */
process.env.GROK_API_KEY = 'grok_stand_in';

const b64url = (b: Uint8Array | ArrayBuffer): string =>
  Buffer.from(b instanceof ArrayBuffer ? new Uint8Array(b) : b)
    .toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

let keyPair: CryptoKeyPair;
let publicJwk: JsonWebKey;
const realFetch = globalThis.fetch;
/** Every request the route and its helpers made, so a claim about what was NOT called is checkable. */
const seen: string[] = [];

before(async () => {
  keyPair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify'],
  ) as CryptoKeyPair;
  publicJwk = await crypto.subtle.exportKey('jwk', keyPair.publicKey);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    seen.push(url);

    /* The JWKS the verifier will import. `alg`, `kty` and `crv` all have to match or `loadKeys`
       skips the key and the token is treated as unverifiable rather than invalid. */
    if (url.includes('/auth/v1/.well-known/jwks.json')) {
      return new Response(JSON.stringify({
        keys: [{ ...publicJwk, kid: KID, alg: 'ES256', use: 'sig' }],
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    }

    /* `isAccountBanned` reads lhq_user_status through supabase-js. Its own try/catch answers
       `false` on any error, which is the behaviour we want and which the real route relies on -
       a database hiccup must not switch off every paid feature. Answering 500 here exercises
       that path rather than pretending the read succeeded. */
    if (url.includes('/rest/v1/')) {
      return new Response('{"message":"stand-in: no database"}', { status: 500 });
    }

    /* Anything reaching xAI is a FAILURE OF THE TEST, not a thing to stub: the bound returns
       before the reservation and before the call. A loud throw is better than a quiet stub that
       would let a regression here pass. */
    if (url.includes('api.x.ai')) {
      throw new Error(`the route reached xAI - the size bound did not return first: ${url}`);
    }

    return new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } });
  }) as typeof fetch;
});

after(() => { globalThis.fetch = realFetch; });

/** A genuine ES256 token for the stand-in issuer, signed with the key published above. */
async function mintToken(over: Record<string, unknown> = {}): Promise<string> {
  const header = { alg: 'ES256', kid: KID, typ: 'JWT' };
  const payload = {
    sub: '00000000-0000-4000-8000-000000000001',
    email: 'qa-bound@liquidityhq.test',
    aud: 'authenticated',
    role: 'authenticated',
    iss: `${SUPABASE_URL}/auth/v1`,
    exp: Math.floor(Date.now() / 1000) + 600,
    ...over,
  };
  const signingInput = `${b64url(Buffer.from(JSON.stringify(header)))}.${b64url(Buffer.from(JSON.stringify(payload)))}`;
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, keyPair.privateKey, new TextEncoder().encode(signingInput),
  );
  return `${signingInput}.${b64url(sig)}`;
}

let n = 0;
async function postBriefing(body: unknown, token: string | null) {
  /* Cache-busted so each case gets a fresh module: the route and authUser both keep process-level
     state, and a token cached from an earlier case would make a later one pass for the wrong
     reason. */
  const mod = await import(`../app/(main)/../api/briefing/route.ts?x=${Date.now()}-${n++}`);
  const req = new Request('http://localhost/api/briefing', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify(body),
  });
  const res = await mod.POST(req);
  let json: Record<string, unknown> = {};
  try { json = await res.json(); } catch { /* not JSON */ }
  return { status: res.status, body: json };
}

test('B1. CONTROL: the minted token passes the REAL auth gate', async () => {
  /* Without this, every assertion below could be a 401 wearing a different number - and the whole
     point of minting a token rather than stubbing the helper is that the bound is reached THROUGH
     `:54/:58`. An empty context is the cheapest way past auth and into the route's own validation. */
  const token = await mintToken();
  const r = await postBriefing({ context: '' }, token);
  assert.equal(r.status, 400, `expected the empty-context 400, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.error, 'context required',
    'the empty-context gate at :67 must be what answered - if this is "Sign in required" the token ' +
    'did not verify and nothing below tests the size bound');
  assert.ok(seen.some((u) => u.includes('jwks.json')),
    'the JWKS was never fetched, so the token was not verified locally - auth was stepped over, not through');
});

test('B2. CONTROL: no token is refused at :54/:58, before any size check', async () => {
  const r = await postBriefing({ context: 'x'.repeat(64_001) }, null);
  assert.equal(r.status, 401, `an unauthenticated caller must be refused, got ${r.status}`);
  assert.equal(r.body.code, 'AUTH_REQUIRED');
  /* The oversized body was sent and the answer is still 401 - which is what fixes the ORDER of the
     two gates as a fact rather than a reading of the file. */
});

test('B3. a context over 64,000 characters is refused with 400 "Invalid request."', async () => {
  const token = await mintToken();
  const r = await postBriefing({ context: 'x'.repeat(64_001) }, token);
  assert.equal(r.status, 400, `expected 400, got ${r.status} ${JSON.stringify(r.body)}`);
  assert.equal(r.body.error, 'Invalid request.',
    'THE ERROR STRING IS THE DISCRIMINATOR. Both rejections are 400, so a status code alone cannot ' +
    'tell the size gate at :82 from the empty-context gate at :67 - and a test that only checked ' +
    'for 400 would pass on an empty body, testing nothing.');
});

test('B4. the boundary: exactly 64,000 is NOT refused by the size gate', async () => {
  /* `> 64_000`, so 64,000 must pass. It then continues into the reservation and would reach xAI,
     which the fetch stand-in throws on - so the assertion is narrow on purpose: whatever happens
     next, it must not be the size gate's 400. An off-by-one the other way (`>=`) would reject a
     legitimate request, and nothing else in the suite would notice. */
  const token = await mintToken();
  let r: { status: number; body: Record<string, unknown> } | null = null;
  try {
    r = await postBriefing({ context: 'x'.repeat(64_000) }, token);
  } catch (e) {
    /* Reaching xAI means it got well past :82, which is the thing being asserted. */
    assert.match(String(e), /reached xAI|stand-in/, `unexpected failure past the bound: ${String(e)}`);
    return;
  }
  /* THIS ASSERTION WAS A FALSE PASS AND IT PASSED FOR THE WRONG REASON FIRST TIME ROUND. It read
     `!(status === 400 && error === 'Invalid request.')`, which is satisfied by ANY other status -
     including the 503 that every case was returning while `GROK_API_KEY` was misnamed. So the one
     cell that went green was the one that could not fail. It now requires the request to have got
     PAST the gates above the bound as well, so a 503 or a 401 fails it. */
  assert.notEqual(r.status, 503,
    `503 means a gate ABOVE the bound answered (missing key at :44 or the grok flag at :47), so this ` +
    `cell never reached the size check: ${JSON.stringify(r.body)}`);
  assert.notEqual(r.status, 401, 'a 401 means auth answered, so the size check was never reached');
  assert.ok(
    !(r.status === 400 && r.body.error === 'Invalid request.'),
    `64,000 characters was refused by the size gate, so the comparison is >= rather than > : ` +
    `${r.status} ${JSON.stringify(r.body)}`,
  );
});

test('B5. the bound returns BEFORE anything is reserved or billed', async () => {
  /* The property that makes the oversized case free to test against a live deployment, and the one
     that matters commercially: the bound is at :82, the usage reservation at :86-:96 and the xAI
     call at :109. If the order ever inverts, an oversized request consumes quota - the opposite of
     what #1833 claims. The fetch stand-in throws on any xAI URL, so a reordering fails loudly. */
  seen.length = 0;
  const token = await mintToken();
  const r = await postBriefing({ context: 'x'.repeat(64_001) }, token);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'Invalid request.');
  assert.deepEqual(
    seen.filter((u) => u.includes('api.x.ai')), [],
    'an oversized request reached xAI, so the size bound no longer precedes the billed call',
  );
  assert.equal(
    'usage' in r.body, false,
    'the rejection carried a usage figure, which means the reservation ran before the bound - ' +
    'an oversized call would then consume the caller\'s daily allowance',
  );
});
