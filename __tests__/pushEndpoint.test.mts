import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { validPushEndpoint, validPushKey, isPushHost, MAX_ENDPOINT_LENGTH, MAX_KEY_LENGTH } from '../lib/pushEndpoint.ts';

/* QA's unit cells for #2318 (stored SSRF on /api/push/subscribe): the alert cron later sends a request to the stored endpoint, so only an https URL on a real push service host may be stored. Expectations are the PR text
 * (https only, no credentials, no custom port, max 2048, allowlisted hosts with a DOT-BOUNDARY suffix match, keys base64url max 256) plus the usual URL-parser tricks. */

const OK = [
  'https://fcm.googleapis.com/fcm/send/abc123:APA91bE-x_y',
  'https://android.googleapis.com/gcm/send/abc',
  'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
  'https://push.services.mozilla.com/x',
  'https://web.push.apple.com/QAbcdef',
  'https://wns2-par02p.notify.windows.com/w/?token=BQYAAAB',
  'https://fcm.googleapis.com:443/fcm/send/abc',      // the default port written out is not a custom port
];
test('E1. real push-service endpoints are accepted and come back as the normalised URL', () => {
  for (const u of OK) assert.equal(validPushEndpoint(u), new URL(u).toString(), u);
  assert.equal(validPushEndpoint('https://FCM.GoogleAPIs.com/fcm/send/abc'), 'https://fcm.googleapis.com/fcm/send/abc', 'host is lower-cased on the way in');
});

test('E2. THE LISTED ATTACKS from the PR are refused: http, metadata IP, suffix look-alike, credentials, custom port, 3000 characters, non-strings', () => {
  const bad: unknown[] = ['http://fcm.googleapis.com/x', 'https://169.254.169.254/x', 'https://fcm.googleapis.com.evil.com/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x',
    'https://fcm.googleapis.com/' + 'a'.repeat(3000), 42, null, undefined, {}, [], true, ''];
  for (const b of bad) assert.equal(validPushEndpoint(b), null, String(b).slice(0, 60));
});

test('E3. internal and loopback targets, IP literals and look-alike hosts are refused', () => {
  const bad = ['https://127.0.0.1/x', 'https://localhost/x', 'https://[::1]/x', 'https://10.0.0.5/x', 'https://192.168.1.1/x', 'https://0.0.0.0/x', 'https://2130706433/x',
    'https://metadata.google.internal/x', 'https://evilfcm.googleapis.com/x', 'https://notfcm.googleapis.com/x', 'https://fcm.googleapis.com.attacker.test/x', 'https://attacker.test/fcm.googleapis.com',
    'https://attacker.test/?u=fcm.googleapis.com', 'https://attacker.test#@fcm.googleapis.com/x', 'https://fcm.googleapis.com@attacker.test/x', 'https://attacker.test\\@fcm.googleapis.com/x',
    'https://fcm.googIeapis.com/x', 'ftp://fcm.googleapis.com/x', 'javascript:alert(1)', 'data:text/plain,hi', '//fcm.googleapis.com/x', 'fcm.googleapis.com/x', 'file:///etc/passwd', 'https://fcm.googleapis.com./x'];
  for (const b of bad) assert.equal(validPushEndpoint(b), null, b);
});

test('E4. the suffix match needs a dot boundary: the bare allowlisted host and its subdomains pass, a host that merely ends with the same letters does not', () => {
  assert.equal(isPushHost('fcm.googleapis.com'), true); assert.equal(isPushHost('wns2-par02p.notify.windows.com'), true); assert.equal(isPushHost('updates.push.services.mozilla.com'), true);
  assert.equal(isPushHost('xfcm.googleapis.com'), false); assert.equal(isPushHost('googleapis.com'), false); assert.equal(isPushHost('com'), false); assert.equal(isPushHost('notify.windows.com.evil.io'), false);
});

test('E5. the length limit is exact: 2048 passes, 2049 does not', () => {
  const pad = (n: number) => 'https://fcm.googleapis.com/' + 'a'.repeat(n - 'https://fcm.googleapis.com/'.length);
  assert.equal(MAX_ENDPOINT_LENGTH, 2048); assert.notEqual(validPushEndpoint(pad(2048)), null); assert.equal(validPushEndpoint(pad(2049)), null);
});

test('E6. keys: base64url strings up to 256 are accepted; empty, markup, spaces, non-strings and 257 characters are not', () => {
  for (const k of ['BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM', 'tBHItJI5svbpez7KI4CCXg==', 'a'.repeat(256), 'A-_=']) assert.equal(validPushKey(k), k);
  assert.equal(MAX_KEY_LENGTH, 256);
  for (const k of ['', '<script>', 'a b', 'a'.repeat(257), 'key;DROP TABLE x', 123, null, undefined, {}, 'é']) assert.equal(validPushKey(k), null, String(k));
});

test('E7. (source guard) the route refuses an invalid subscription with 400 before any write, and stores the NORMALISED values, never the raw body', () => {
  const src = readFileSync(new URL('../app/api/push/subscribe/route.ts', import.meta.url), 'utf8');
  const post = src.slice(src.indexOf('validPushEndpoint(endpoint)'));
  assert.match(post, /if \(!cleanEndpoint \|\| !p256dh \|\| !authKey\) \{\s*return NextResponse\.json\(\{ error: 'Invalid push subscription' \}, \{ status: 400 \}\);/);
  assert.ok(post.indexOf("status: 400") < post.indexOf('.upsert('), 'a write can happen before the validation answer');
  assert.match(post, /endpoint: cleanEndpoint, p256dh, auth: authKey/);
  assert.doesNotMatch(post, /endpoint,\s*p256dh: keys\.p256dh/, 'the raw body values are stored again');
});
