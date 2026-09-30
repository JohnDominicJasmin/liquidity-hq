/* #861 Phase 1b, first half: is this request really from BoomFi? (9e49e80c)
 *
 * lib/boomfi.ts verifies a webhook and nothing else - no route calls it yet and
 * what an event MEANS for a subscription is not written. So this file is about
 * one question: can anything that is not BoomFi get `{ ok: true }`?
 *
 * REAL CRYPTOGRAPHY, NOT A STUB. A key pair is generated here and every case is
 * signed or mis-signed for real, through the module's own exported function. A
 * stand-in verifier would pass whatever this file assumed.
 *
 * THE SCHEME, from BoomFi's page as quoted in the module: RSA PKCS#1 v1.5 over
 * SHA-256 of `${timestamp}.${rawBody}`, Base64 signature, a freshness window of
 * 300 s either side. NOT independently confirmed against a real BoomFi delivery:
 * nobody on this project has seen one. If the first real event fails here, check
 * the scheme before the code.
 *
 * WHAT THIS DOES NOT COVER, because it does not exist yet: the route, duplicate
 * deliveries (BoomFi re-signs a retry with a new timestamp, so freshness does not
 * stop a duplicate), and matching a payment to an account. */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  verifyBoomfiWebhook, boomfiOrgMatches, normalizeBoomfiPublicKey, BOOMFI_TIMESTAMP_TOLERANCE_S,
} from '../lib/boomfi.ts';

const rsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const otherRsa = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = crypto.generateKeyPairSync('ec', { namedCurve: 'P-256' });
const PUBLIC_PEM = rsa.publicKey.export({ type: 'spki', format: 'pem' }) as string;
const EC_PUBLIC_PEM = ec.publicKey.export({ type: 'spki', format: 'pem' }) as string;

const NOW_S = 1_790_000_000;
const NOW_MS = NOW_S * 1000;
const BODY = '{"event":"Invoice.Paid","org_id":"org_123","data":{"amount":"35.00"}}';

/** Sign exactly the way the module says BoomFi does. */
function sign(timestamp: string, body: string, key: crypto.KeyObject = rsa.privateKey): string {
  return crypto.sign('RSA-SHA256', Buffer.from(`${timestamp}.${body}`, 'utf8'), { key, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');
}
const TS = String(NOW_S);
const GOOD = { rawBody: BODY, signature: sign(TS, BODY), timestamp: TS, publicKeyPem: PUBLIC_PEM, nowMs: NOW_MS };
const verify = (over: Partial<Parameters<typeof verifyBoomfiWebhook>[0]> = {}) => verifyBoomfiWebhook({ ...GOOD, ...over });
const reason = (over: Partial<Parameters<typeof verifyBoomfiWebhook>[0]>) => {
  const r = verify(over);
  return r.ok ? 'OK' : r.reason;
};

test('B1. CONTROL: a correctly signed, fresh request passes - every rejection below is measured against this', () => {
  assert.deepEqual(verify(), { ok: true });
});

test('B2. the key as it sits in an environment variable - line breaks written as the two characters backslash-n - still verifies', () => {
  const oneLine = PUBLIC_PEM.trim().split('\n').join('\\n');
  assert.equal(oneLine.includes('\n'), false, 'fixture is not single-line');
  assert.deepEqual(verify({ publicKeyPem: oneLine }), { ok: true });
  assert.equal(normalizeBoomfiPublicKey(oneLine), PUBLIC_PEM.trim());
  assert.equal(normalizeBoomfiPublicKey(undefined), '');
});

test('B3. a changed body is rejected - one byte, and a re-serialised copy of the same JSON', () => {
  assert.equal(reason({ rawBody: BODY.replace('35.00', '0.35') }), 'bad_signature');
  assert.equal(reason({ rawBody: BODY + ' ' }), 'bad_signature');
  const reserialised = JSON.stringify(JSON.parse(BODY), null, 1);
  assert.notEqual(reserialised, BODY);
  assert.equal(reason({ rawBody: reserialised }), 'bad_signature', 'the signature must be over the RAW bytes; parsing and re-serialising the body is the classic way this check is accidentally defeated');
});

test('B4. the timestamp is part of what is signed: a fresh timestamp on an old signature is rejected', () => {
  const later = String(NOW_S + 10);
  assert.equal(reason({ timestamp: later }), 'bad_signature', 'a header timestamp that was not the one signed passed - a captured request could be replayed forever by updating the header');
});

test('B5. another RSA key, a garbage signature, an empty-after-decoding signature: all bad_signature', () => {
  assert.equal(reason({ signature: sign(TS, BODY, otherRsa.privateKey) }), 'bad_signature');
  assert.equal(reason({ signature: 'not-base64-!!!' }), 'bad_signature');
  assert.equal(reason({ signature: 'AAAA' }), 'bad_signature');
  assert.equal(reason({ signature: '====' }), 'bad_signature');
  assert.equal(reason({ publicKeyPem: otherRsa.publicKey.export({ type: 'spki', format: 'pem' }) as string }), 'bad_signature');
});

test('B6. the algorithm is fixed by us: an RSA-PSS or SHA-1 signature from the RIGHT key is still rejected', () => {
  const msg = Buffer.from(`${TS}.${BODY}`, 'utf8');
  const pss = crypto.sign('RSA-SHA256', msg, { key: rsa.privateKey, padding: crypto.constants.RSA_PKCS1_PSS_PADDING }).toString('base64');
  const sha1 = crypto.sign('RSA-SHA1', msg, { key: rsa.privateKey, padding: crypto.constants.RSA_PKCS1_PADDING }).toString('base64');
  assert.equal(reason({ signature: pss }), 'bad_signature');
  assert.equal(reason({ signature: sha1 }), 'bad_signature');
});

test('B7. a key that is not RSA, or not a key, is bad_public_key - never verified under another algorithm\'s rules', () => {
  const ecSig = crypto.sign('SHA256', Buffer.from(`${TS}.${BODY}`, 'utf8'), ec.privateKey).toString('base64');
  assert.equal(reason({ publicKeyPem: EC_PUBLIC_PEM, signature: ecSig }), 'bad_public_key', 'a validly EC-signed request passed or was judged on its signature - the key type must be refused first');
  assert.equal(reason({ publicKeyPem: EC_PUBLIC_PEM }), 'bad_public_key');
  assert.equal(reason({ publicKeyPem: '-----BEGIN PUBLIC KEY-----\nnot a key\n-----END PUBLIC KEY-----' }), 'bad_public_key');
  assert.equal(reason({ publicKeyPem: 'hello' }), 'bad_public_key');
});

test('B8. no key configured is a refusal, not a pass - empty, whitespace, null, undefined', () => {
  for (const k of ['', '   ', '\\n', null, undefined]) {
    assert.equal(reason({ publicKeyPem: k }), 'no_public_key', `publicKeyPem ${JSON.stringify(k)}`);
  }
});

test('B9. a missing header is missing_headers - null, undefined, empty, whitespace - for either header', () => {
  for (const v of [null, undefined, '', '   ']) {
    assert.equal(reason({ signature: v }), 'missing_headers', `signature ${JSON.stringify(v)}`);
    assert.equal(reason({ timestamp: v }), 'missing_headers', `timestamp ${JSON.stringify(v)}`);
  }
});

test('B10. the timestamp must be plain digits: everything Number() would have accepted is bad_timestamp', () => {
  for (const t of ['1e9', '0x10', '-5', '+5', '12.5', '1_000', 'abc', `${NOW_S}abc`, '1'.repeat(13), 'NaN', 'Infinity']) {
    assert.equal(reason({ timestamp: t }), 'bad_timestamp', `timestamp ${JSON.stringify(t)}`);
  }
});

test('B11. the freshness window is 300 s either side: exactly 300 passes, 301 is stale - past and future', () => {
  assert.equal(BOOMFI_TIMESTAMP_TOLERANCE_S, 300);
  for (const offset of [-300, 300, 0]) {
    const t = String(NOW_S + offset);
    assert.deepEqual(verify({ timestamp: t, signature: sign(t, BODY) }), { ok: true }, `offset ${offset}s should be inside the window`);
  }
  for (const offset of [-301, 301, -86_400, 86_400]) {
    const t = String(NOW_S + offset);
    assert.equal(reason({ timestamp: t, signature: sign(t, BODY) }), 'stale_timestamp', `offset ${offset}s is outside the window but a VALID signature let it through`);
  }
});

test('B12. replay: the same genuine request is accepted now and refused once the window has passed', () => {
  assert.deepEqual(verify({ nowMs: NOW_MS + 299_000 }), { ok: true });
  assert.equal(reason({ nowMs: NOW_MS + 301_000 }), 'stale_timestamp');
});

test('B13. toleranceS is honoured, and without nowMs the real clock is used', () => {
  const t = String(NOW_S - 50);
  assert.equal(reason({ timestamp: t, signature: sign(t, BODY), toleranceS: 10 }), 'stale_timestamp');
  const nowTs = String(Math.floor(Date.now() / 1000));
  assert.deepEqual(verifyBoomfiWebhook({ rawBody: BODY, signature: sign(nowTs, BODY), timestamp: nowTs, publicKeyPem: PUBLIC_PEM }), { ok: true });
  assert.equal(verifyBoomfiWebhook({ rawBody: BODY, signature: GOOD.signature, timestamp: TS, publicKeyPem: PUBLIC_PEM }).ok, false, 'a timestamp from the fixture clock passed against the real clock');
});

test('B14. it never throws, whatever it is handed - a thrown error becomes a 500, which says more than a 401', () => {
  const hostile: unknown[] = ['', ' ', '\u0000', 'A'.repeat(100_000), '{}', '-----BEGIN', '\\n\\n', '9'.repeat(12), '%%%', '\uD800'];
  for (const a of hostile) for (const b of hostile) {
    assert.doesNotThrow(() => verifyBoomfiWebhook({ rawBody: String(a), signature: b as string, timestamp: TS, publicKeyPem: PUBLIC_PEM, nowMs: NOW_MS }));
    assert.doesNotThrow(() => verifyBoomfiWebhook({ rawBody: BODY, signature: GOOD.signature, timestamp: a as string, publicKeyPem: b as string, nowMs: NOW_MS }));
  }
  for (const a of hostile) assert.notDeepEqual(verify({ signature: a as string }), { ok: true });
});

test('B15. only { ok: true } or a named reason ever comes back', () => {
  const reasons = new Set(['no_public_key', 'bad_public_key', 'missing_headers', 'bad_timestamp', 'stale_timestamp', 'bad_signature']);
  const cases = [{}, { signature: 'x' }, { timestamp: 'x' }, { publicKeyPem: '' }, { publicKeyPem: 'x' }, { timestamp: '1' }, { signature: null }];
  for (const c of cases) {
    const r = verify(c as Partial<Parameters<typeof verifyBoomfiWebhook>[0]>);
    if (r.ok) assert.deepEqual(r, { ok: true });
    else assert.ok(reasons.has(r.reason), `unknown reason ${r.reason}`);
  }
});

/* ══ boomfiOrgMatches ══ */

test('O1. org_id or org.id equal to the expected id matches', () => {
  assert.equal(boomfiOrgMatches({ org_id: 'org_123' }, 'org_123'), true);
  assert.equal(boomfiOrgMatches({ org: { id: 'org_123' } }, 'org_123'), true);
  assert.equal(boomfiOrgMatches(JSON.parse(BODY), 'org_123'), true);
  assert.equal(boomfiOrgMatches({ org_id: 'org_123' }, '  org_123  '), true, 'the expected id is trimmed - a trailing newline in the env value must not lock out every event');
});

test('O2. a different organisation does not match', () => {
  assert.equal(boomfiOrgMatches({ org_id: 'org_999' }, 'org_123'), false);
  assert.equal(boomfiOrgMatches({ org: { id: 'org_999' } }, 'org_123'), false);
  assert.equal(boomfiOrgMatches({ org_id: 'org_1234' }, 'org_123'), false);
  assert.equal(boomfiOrgMatches({ org_id: 'ORG_123' }, 'org_123'), false);
  assert.equal(boomfiOrgMatches({}, 'org_123'), false);
});

test('O3. an UNSET expected id is a refusal - a missing setting must not mean "every organisation is ours"', () => {
  for (const expected of ['', '   ', undefined, null]) {
    assert.equal(boomfiOrgMatches({ org_id: 'org_123' }, expected), false, `expected ${JSON.stringify(expected)}`);
    assert.equal(boomfiOrgMatches({ org_id: '' }, expected), false, 'empty matched empty');
    assert.equal(boomfiOrgMatches({}, expected), false);
  }
});

test('O4. when both fields are present the top-level org_id decides - a wrong org_id is not rescued by a right org.id', () => {
  /* Pinned as written. "Either one matches" would let a body carry our id in one
     field and someone else's in the other. */
  assert.equal(boomfiOrgMatches({ org_id: 'org_999', org: { id: 'org_123' } }, 'org_123'), false);
  assert.equal(boomfiOrgMatches({ org_id: 'org_123', org: { id: 'org_999' } }, 'org_123'), true);
});

test('O5. only strings count, and a body that is not an object never matches or throws', () => {
  assert.equal(boomfiOrgMatches({ org_id: 123 }, '123'), false);
  assert.equal(boomfiOrgMatches({ org: { id: 123 } }, '123'), false);
  assert.equal(boomfiOrgMatches({ org: 'org_123' }, 'org_123'), false);
  assert.equal(boomfiOrgMatches({ org: null }, 'org_123'), false);
  for (const body of [null, undefined, 'org_123', 42, true, ['org_123']]) {
    assert.doesNotThrow(() => boomfiOrgMatches(body, 'org_123'));
    assert.equal(boomfiOrgMatches(body, 'org_123'), false, `body ${JSON.stringify(body)}`);
  }
});
