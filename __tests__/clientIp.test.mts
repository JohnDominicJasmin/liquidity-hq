import test from 'node:test';
import assert from 'node:assert/strict';
import { getClientIp, normalizeIp } from '../lib/rateLimit.ts';

/* #2336 (S8): which address becomes the rate-limit key. QA's cells.
 *
 * WHAT THIS PINS: the Cloudflare headers (cf-connecting-ip, true-client-ip) are trusted only with a matching x-origin-auth secret, or while ORIGIN_AUTH_SECRET is unset (the transition);
 * a wrong, missing or different-length secret falls back to the RIGHTMOST PUBLIC hop of x-forwarded-for (a caller can only prepend); IPv6 is keyed by /64; IPv4-mapped IPv6 becomes IPv4.
 *
 * WHAT IT CANNOT PROVE: that Cloudflare sends the header in production (the Transform Rule), or what the Render proxy puts in x-forwarded-for on the live site (live check after the secret is set). */

const req = (h: Record<string, string>) => new Request('http://localhost/x', { headers: h });
const SECRET = { ORIGIN_AUTH_SECRET: 's3cret-value' };

test('I1. secret UNSET (transition): the Cloudflare header is used, exactly as before', () => {
  assert.equal(getClientIp(req({ 'cf-connecting-ip': '198.51.100.7' }), {}), '198.51.100.7');
  assert.equal(getClientIp(req({ 'true-client-ip': '198.51.100.8' }), {}), '198.51.100.8');
  assert.equal(getClientIp(req({ 'cf-connecting-ip': '198.51.100.7' }), { ORIGIN_AUTH_SECRET: '' }), '198.51.100.7', 'an EMPTY secret counts as unset');
  assert.equal(getClientIp(req({ 'cf-connecting-ip': '198.51.100.7', 'true-client-ip': '198.51.100.8' }), {}), '198.51.100.7', 'cf-connecting-ip wins over true-client-ip');
});

test('I2. secret SET and MATCHING: the Cloudflare header is trusted', () => {
  assert.equal(getClientIp(req({ 'x-origin-auth': 's3cret-value', 'cf-connecting-ip': '198.51.100.7', 'x-forwarded-for': '9.9.9.9, 172.71.1.1' }), SECRET), '198.51.100.7');
  assert.equal(getClientIp(req({ 'x-origin-auth': 's3cret-value', 'true-client-ip': '198.51.100.8' }), SECRET), '198.51.100.8');
});

test('I3. secret SET and WRONG / MISSING / a different length / a prefix of it: the Cloudflare header is IGNORED and the rightmost public x-forwarded-for hop is used', () => {
  const xff = '9.9.9.9, 203.0.113.7, 10.1.1.1';
  for (const bad of [undefined, '', 'wrong', 's3cret-valuE', 'S3CRET-VALUE', 's3cret-valu', 's3cret-value-and-more']) {
    const h: Record<string, string> = { 'cf-connecting-ip': '1.2.3.4', 'x-forwarded-for': xff }; if (bad !== undefined) h['x-origin-auth'] = bad;
    assert.equal(getClientIp(req(h), SECRET), '203.0.113.7', `x-origin-auth=${JSON.stringify(bad)}`);
  }
});

test('I4. a forged cf-connecting-ip cannot choose the key once the secret is set: 50 different forged values all land on the same key', () => {
  const keys = new Set<string>();
  for (let i = 0; i < 50; i++) keys.add(getClientIp(req({ 'cf-connecting-ip': `203.0.113.${i}`, 'x-forwarded-for': '198.51.100.9' }), SECRET));
  assert.deepEqual([...keys], ['198.51.100.9']);
});

test('I5. x-forwarded-for: a caller can only PREPEND, so a forged left side never wins; private trailing hops are skipped; all-private falls back to the last hop', () => {
  assert.equal(getClientIp(req({ 'x-forwarded-for': '6.6.6.6, 7.7.7.7, 203.0.113.7' }), SECRET), '203.0.113.7', 'the rightmost, not the leftmost');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '203.0.113.7, 10.0.0.2, 192.168.1.1, 172.16.0.9, 127.0.0.1' }), SECRET), '203.0.113.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '10.0.0.1, 10.0.0.2' }), SECRET), '10.0.0.2', 'no public hop: the last hop');
  assert.equal(getClientIp(req({ 'x-forwarded-for': ' 203.0.113.7 ,, ' }), SECRET), '203.0.113.7', 'blanks and spaces are dropped');
});

test('I6. fallbacks: x-real-ip when there is no x-forwarded-for, and "unknown" when there is nothing', () => {
  assert.equal(getClientIp(req({ 'x-real-ip': '203.0.113.50' }), SECRET), '203.0.113.50');
  assert.equal(getClientIp(req({}), SECRET), 'unknown'); assert.equal(getClientIp(req({}), {}), 'unknown');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '' }), SECRET), 'unknown');
});

test('I7. IPv6 is keyed by /64: addresses inside one /64 share a key, another /64 does not; written-out and compressed forms agree; case does not matter', () => {
  assert.equal(normalizeIp('2001:db8:1:2:aaaa:bbbb:cccc:dddd'), '2001:db8:1:2::/64');
  assert.equal(normalizeIp('2001:db8:1:2::1'), '2001:db8:1:2::/64');
  assert.equal(normalizeIp('2001:DB8:1:2:ffff:ffff:ffff:ffff'), '2001:db8:1:2::/64');
  assert.equal(normalizeIp('2001:db8::1'), '2001:db8:0:0::/64');
  assert.equal(normalizeIp('2001:0db8:0001:0002:0000:0000:0000:0001'), '2001:db8:1:2::/64', 'leading zeros dropped');
  assert.notEqual(normalizeIp('2001:db8:1:3::1'), normalizeIp('2001:db8:1:2::1'));
  const rot = new Set(Array.from({ length: 200 }, (_, i) => normalizeIp(`2001:db8:1:2:${i.toString(16)}::${(i * 7).toString(16)}`))); assert.equal(rot.size, 1, 'rotating inside a /64 gives a fresh key');
  assert.equal(getClientIp(req({ 'x-origin-auth': 's3cret-value', 'cf-connecting-ip': '2001:db8:1:2:aaaa:bbbb:cccc:dddd' }), SECRET), '2001:db8:1:2::/64', 'through getClientIp too');
});

test('I8. IPv4-mapped IPv6 becomes the IPv4 address, IPv4 passes through lower-cased and trimmed, and getClientIp applies it', () => {
  assert.equal(normalizeIp('::ffff:1.2.3.4'), '1.2.3.4'); assert.equal(normalizeIp('::FFFF:1.2.3.4'), '1.2.3.4'); assert.equal(normalizeIp(' 1.2.3.4 '), '1.2.3.4');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '::ffff:203.0.113.7' }), SECRET), '203.0.113.7');
  assert.equal(getClientIp(req({ 'x-forwarded-for': '::ffff:203.0.113.7' }), SECRET), getClientIp(req({ 'x-forwarded-for': '203.0.113.7' }), SECRET), 'mapped and plain are ONE bucket');
});
