/* The two gates in front of the payments webhook (#243).
 *
 * `patchForEvent` has had eleven tests since it was extracted. The two checks
 * that decide whether it runs at all had none, because reaching them meant a
 * live endpoint, a real secret and a database — so the most security-sensitive
 * code on the payments path was the least tested code on it.
 *
 * WHAT THIS DOES NOT DO. It does not prove the deployed endpoint works. Dedup
 * and the write still need the database, and the checkout click still needs a
 * card. This is the half that can be proven without either, and the file it
 * tests says so in its own header: the harness proves the route verifies,
 * dedupes and writes; this proves the decisions.
 *
 * The HMAC below is computed independently in each test rather than pasted, so
 * a signature that stops matching fails here rather than being frozen into a
 * fixture that agrees with a bug.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import { verifyWebhookSignature, payerOwnsAccount } from '../lib/lemonsqueezy.ts';

const SECRET = 'test_secret_not_a_real_one';
const sign = (payload: string, secret = SECRET) =>
  crypto.createHmac('sha256', secret).update(payload).digest('hex');

/* Shaped like a LemonSqueezy subscription_created delivery. Not a captured
   payload — the fields the route reads are what matter, and a real one would
   carry a real customer's email. */
const PAYLOAD = JSON.stringify({
  meta: { event_name: 'subscription_created', custom_data: { user_id: 'user-abc' } },
  data: {
    id: 'sub_123',
    attributes: {
      status: 'active', user_email: 'Buyer@Example.com',
      renews_at: '2027-09-05T00:00:00.000000Z', test_mode: true,
    },
  },
});

test('a correctly signed payload verifies', () => {
  assert.equal(verifyWebhookSignature(PAYLOAD, sign(PAYLOAD), SECRET), true);
});

test('one changed byte in the body invalidates the signature', () => {
  /* The point of signing. If this passes, the payload is not actually bound to
     the digest and an attacker can rewrite `user_id` in transit. */
  const good = sign(PAYLOAD);
  const tampered = PAYLOAD.replace('"user-abc"', '"user-victim"');
  assert.notEqual(tampered, PAYLOAD, 'the tamper did not change the payload - this test proves nothing');
  assert.equal(verifyWebhookSignature(tampered, good, SECRET), false);
});

test('a signature from a different secret is rejected', () => {
  assert.equal(verifyWebhookSignature(PAYLOAD, sign(PAYLOAD, 'someone_elses_secret'), SECRET), false);
});

test('no configured secret fails CLOSED, not open', () => {
  /* An unset env var must never become an open endpoint. On a public repo that
     is the difference between a misconfiguration and anyone granting themselves
     Pro — and the empty-string case is exactly what a missing Render variable
     produces. */
  assert.equal(verifyWebhookSignature(PAYLOAD, sign(PAYLOAD), ''), false);
  assert.equal(verifyWebhookSignature(PAYLOAD, '', ''), false);
});

test('a malformed signature is rejected rather than throwing', () => {
  /* `Buffer.from(x, 'hex')` silently DROPS invalid characters instead of
     throwing, so 'zz' becomes an empty buffer and timingSafeEqual throws on the
     length mismatch. Uncaught that is a 500 — which tells an attacker their
     input got further than a 401 would, and makes LemonSqueezy retry it. */
  for (const bad of ['', 'zz', 'not-hex-at-all', 'abc', sign(PAYLOAD).slice(0, -2)]) {
    assert.equal(verifyWebhookSignature(PAYLOAD, bad, SECRET), false, `signature ${JSON.stringify(bad)} was accepted`);
  }
});

test('verification does not depend on the payload being JSON', () => {
  /* The route verifies the RAW body before parsing it, which is the only order
     that works: parse-then-verify would run JSON.parse on unauthenticated
     input, and re-serialising to verify would compare a different byte string
     than the one that was signed. */
  const raw = 'not json at all {{{';
  assert.equal(verifyWebhookSignature(raw, sign(raw), SECRET), true);
});

test('CONTROL: the verifier can say true, so the rejections above mean something', () => {
  /* Every assertion above except the first is `false`. A function that returned
     false unconditionally would satisfy all of them. */
  assert.equal(verifyWebhookSignature('x', sign('x'), SECRET), true);
  assert.equal(verifyWebhookSignature('y', sign('y'), SECRET), true);
});

test('the payer must own the account the checkout named', () => {
  /* The signature proves LemonSqueezy sent the event. It never proves the payer
     owns the account named in custom_data — lib/checkout.ts writes that into a
     CLIENT-SIDE url, so the payer picks it. Edit the id in your own browser,
     buy once, and Pro lands wherever you said. */
  assert.equal(payerOwnsAccount('buyer@example.com', 'buyer@example.com'), true);
  assert.equal(payerOwnsAccount('attacker@example.com', 'victim@example.com'), false);
});

test('the comparison is case- and whitespace-insensitive, because the sources differ', () => {
  /* LemonSqueezy echoes what the payer typed; Supabase stores what they
     registered with. Treating "Buyer@Example.com " as a different person from
     "buyer@example.com" would refuse legitimate purchases, and a refusal on
     this path costs a customer their Pro after they have paid. */
  assert.equal(payerOwnsAccount(' Buyer@Example.COM ', 'buyer@example.com'), true);
});

test('an empty side is a refusal, never a match', () => {
  /* The shape where a failed lookup authorises everything: getUserById returns
     no user, acctEmail is '', and a bare equality check on two empty strings
     says yes. */
  assert.equal(payerOwnsAccount('', ''), false);
  assert.equal(payerOwnsAccount('buyer@example.com', ''), false);
  assert.equal(payerOwnsAccount('', 'buyer@example.com'), false);
  assert.equal(payerOwnsAccount(null, undefined), false);
  assert.equal(payerOwnsAccount('   ', 'buyer@example.com'), false);
});

test('the route still calls both gates', () => {
  /* Extracting a check into a tested function does nothing if the caller stops
     using it. Asserted against the source: the route must reference both, and
     must no longer carry its own inline copy of the HMAC comparison. */
  const route = readFileSync(new URL('../app/api/lemonsqueezy/webhook/route.ts', import.meta.url), 'utf8');
  assert.match(route, /verifyWebhookSignature\(payload, signature, SECRET\)/);
  assert.match(route, /payerOwnsAccount\(payerEmail, acctEmail\)/);
  assert.equal(/timingSafeEqual/.test(route), false,
    'the route has its own signature comparison again - two copies of this check is one too many');
});
