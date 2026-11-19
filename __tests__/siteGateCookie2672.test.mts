import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { siteGateDecision, siteGateCookieValue, gateCookie, siteGateBasicOk, SITE_GATE_COOKIE, SITE_GATE_COOKIE_MAX_AGE_S, SITE_GATE_EXEMPT_PATHS } from '../lib/siteGate.ts';
import { proxy } from '../proxy.ts';

/* #2672 THE GATE COOKIE (QA found it on gated staging, run 44554556396: the app's own /api calls carry `Authorization: Bearer <token>`, a browser adds cached Basic credentials only to a request with NO Authorization header of its own, so every Bearer fetch behind the gate was a 401 "Authentication required"). PM chose option A. Written rule (PM + Dev):
 * after ONE correct HTTP Basic the response sets cookie lhq_gate = HMAC-SHA256(key = the password, "lhq-gate-v1") as hex, HttpOnly, Secure, SameSite=Lax, Path=/, Max-Age 30 days; a request is also let through when it carries that cookie (whatever else it sends, a Bearer header included); the password is not in the cookie and changing the password invalidates every cookie; the cookie is handed out ONLY after a correct Basic (never on a cookie-only, cron, exempt, robots, denied, or gate-off response); the comparison is constant-time; production (gate off) is untouched; everything #2636 pinned still holds (siteGate2636 is carried by the head).
 *   C1 the cookie value   C2 reading it out of a Cookie header   C3 the decision table with the cookie   C4 proxy(): who gets Set-Cookie and with which flags, and Bearer + cookie passes   C5 changing the password logs everyone out   C6 source: one Set-Cookie site behind siteGateBasicOk, constant-time compare */
const PW = 'correct horse: battery:staple', PW2 = 'another password', CRON = 'cron-secret-xyz';
const basic = (pw: string, user = 'team') => 'Basic ' + Buffer.from(`${user}:${pw}`, 'utf8').toString('base64');
const hmac = (pw: string) => createHmac('sha256', pw).update('lhq-gate-v1', 'utf8').digest('hex');
const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://site.test${path}`, { headers });
const saved = { gate: process.env.SITE_GATE_PASSWORD, cron: process.env.CRON_SECRET };
const setEnv = (gate: string | undefined, cron: string | undefined) => { if (gate === undefined) delete process.env.SITE_GATE_PASSWORD; else process.env.SITE_GATE_PASSWORD = gate; if (cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = cron; };
afterEach(() => setEnv(saved.gate, saved.cron));
const passes = (r: Response) => r.headers.get('x-middleware-next') === '1' && r.status === 200;
const ck = (pw: string) => `${SITE_GATE_COOKIE}=${hmac(pw)}`;
const d = (path: string, o: { authorization?: string | null; cookie?: string | null; cronSecretHeader?: string | null } = {}, password = PW) => siteGateDecision({ pathname: path, ...o }, { password, cronSecret: CRON });

test('C1. the cookie value is HMAC-SHA256(password, "lhq-gate-v1") in hex; it differs per password, is stable, and does not contain the password', () => {
  assert.equal(SITE_GATE_COOKIE, 'lhq_gate'); assert.equal(SITE_GATE_COOKIE_MAX_AGE_S, 2_592_000, '30 days in seconds');
  for (const pw of [PW, PW2, 'a', 'x'.repeat(200), 'pässwörd: ☃']) { const v = siteGateCookieValue(pw); assert.equal(v, hmac(pw), `the value for ${JSON.stringify(pw)} is not the written HMAC`); assert.match(v, /^[0-9a-f]{64}$/); assert.equal(v.includes(pw), false, 'the password is inside the cookie'); assert.equal(siteGateCookieValue(pw), v, 'not stable'); }
  assert.notEqual(siteGateCookieValue(PW), siteGateCookieValue(PW2)); assert.notEqual(siteGateCookieValue(PW), siteGateCookieValue(PW + ' '));
});
test('C2. gateCookie reads only lhq_gate, exactly, out of any Cookie header', () => {
  const v = hmac(PW);
  assert.equal(gateCookie(`${SITE_GATE_COOKIE}=${v}`), v); assert.equal(gateCookie(`a=1; ${SITE_GATE_COOKIE}=${v}; b=2`), v); assert.equal(gateCookie(`a=1;${SITE_GATE_COOKIE}=${v}`), v, 'no space after the semicolon'); assert.equal(gateCookie(`  ${SITE_GATE_COOKIE} = ${v} `), v, 'spaces around name and value');
  for (const bad of [null, undefined, '', 'a=1; b=2', `x${SITE_GATE_COOKIE}=${v}`, `${SITE_GATE_COOKIE}x=${v}`, `LHQ_GATE=${v}`, SITE_GATE_COOKIE, `; ;`]) assert.equal(gateCookie(bad as string | null | undefined), null, `${JSON.stringify(bad)} must not yield a cookie`);
  assert.equal(gateCookie(`${SITE_GATE_COOKIE}=`), '', 'an empty value reads as empty, which never equals a real value');
  assert.equal(siteGateBasicOk(basic(PW), PW), true); assert.equal(siteGateBasicOk(basic(PW2), PW), false); assert.equal(siteGateBasicOk('Bearer x', PW), false); assert.equal(siteGateBasicOk(null, PW), false); assert.equal(siteGateBasicOk(basic(''), PW), false);
});
test('C3. the decision: the valid cookie lets a request through (Bearer or not); a Bearer alone, a wrong, truncated, extended, empty or other-password cookie does not', () => {
  assert.equal(d('/arena', { cookie: ck(PW) }), 'allow', 'cookie alone'); assert.equal(d('/api/dry-powder', { authorization: 'Bearer eyJ.fake.token', cookie: ck(PW) }), 'allow', 'Bearer + cookie: the case the cookie exists for');
  assert.equal(d('/arena', { authorization: 'Bearer eyJ.fake.token' }), 'deny', 'Bearer alone must stay refused'); assert.equal(d('/arena', { authorization: 'Bearer ' + PW }), 'deny', 'the password as a Bearer is not accepted');
  for (const bad of [`${SITE_GATE_COOKIE}=${hmac(PW).slice(0, -1)}`, `${SITE_GATE_COOKIE}=${hmac(PW)}0`, `${SITE_GATE_COOKIE}=`, `${SITE_GATE_COOKIE}=${hmac(PW2)}`, `${SITE_GATE_COOKIE}=${PW}`, `${SITE_GATE_COOKIE}=${hmac(PW).toUpperCase()}`, `other=${hmac(PW)}`, `${SITE_GATE_COOKIE}x=${hmac(PW)}`]) assert.equal(d('/arena', { cookie: bad }), 'deny', `${bad.slice(0, 30)}... must be refused`);
  assert.equal(d('/arena', { authorization: basic(PW) }), 'allow', 'Basic still passes'); assert.equal(d('/arena', { authorization: basic('wrong'), cookie: ck(PW) }), 'allow', 'a wrong Basic does not cancel a valid cookie (the cookie is its own credential)');
  assert.equal(d('/arena'), 'deny', 'nothing'); assert.equal(d('/robots.txt', { cookie: ck(PW) }), 'robots', 'robots is still answered by the gate'); for (const p of SITE_GATE_EXEMPT_PATHS) assert.equal(d(p), 'allow');
  assert.equal(d('/api/market/ingest', { cronSecretHeader: CRON }), 'allow'); assert.equal(d('/api/market/ingest', { cronSecretHeader: 'wrong' }), 'deny', 'a wrong cron secret is still refused without a cookie');
});
test('C4. proxy(): Set-Cookie only after a correct Basic, with the written flags; cookie, Bearer+cookie, cron, exempt, robots, denied and gate-off responses carry none', () => {
  setEnv(PW, CRON); const sc = (r: Response) => r.headers.get('set-cookie');
  const ok = proxy(req('/arena', { authorization: basic(PW) })); assert.equal(passes(ok), true); const c = sc(ok); assert.ok(c, 'a correct Basic must hand out the cookie');
  assert.ok(c!.startsWith(`${SITE_GATE_COOKIE}=${hmac(PW)};`), `the cookie is not the HMAC: ${c}`); for (const flag of [/;\s*Path=\//i, /;\s*Max-Age=2592000/i, /;\s*HttpOnly/i, /;\s*Secure/i, /;\s*SameSite=lax/i]) assert.ok(flag.test(c!), `the cookie lacks ${flag}: ${c}`);
  assert.equal(c!.includes(PW), false, 'the password is in the Set-Cookie'); assert.equal(c!.includes(encodeURIComponent(PW)), false);
  const viaCookie = proxy(req('/api/dry-powder', { authorization: 'Bearer eyJ.fake.token', cookie: ck(PW) })); assert.equal(passes(viaCookie), true, 'Bearer + cookie passes the gate'); assert.equal(sc(viaCookie), null, 'a cookie pass must not hand the cookie out again');
  assert.equal(sc(proxy(req('/arena', { cookie: ck(PW) }))), null); assert.equal(passes(proxy(req('/arena', { cookie: ck(PW) }))), true);
  assert.equal(sc(proxy(req('/api/market/ingest', { 'x-cron-secret': CRON }))), null, 'a cron pass'); for (const p of SITE_GATE_EXEMPT_PATHS) assert.equal(sc(proxy(req(p))), null, `${p}`);
  assert.equal(sc(proxy(req('/robots.txt', { authorization: basic(PW) }))), null, 'robots.txt is answered, no cookie'); const denied = proxy(req('/arena', { authorization: basic('wrong') })); assert.equal(denied.status, 401); assert.equal(sc(denied), null, 'a refused request gets no cookie');
  assert.equal(proxy(req('/arena', { authorization: 'Bearer eyJ.fake.token' })).status, 401, 'Bearer alone is still a 401'); assert.equal(proxy(req('/arena', { cookie: `${SITE_GATE_COOKIE}=${hmac(PW2)}` })).status, 401, 'another password\'s cookie is a 401');
  for (const gate of [undefined, '']) { setEnv(gate, CRON); for (const h of [{}, { authorization: basic(PW) }, { cookie: ck(PW) }] as Array<Record<string, string>>) { const r = proxy(req('/arena', h)); assert.equal(passes(r), true); assert.equal(sc(r), null, `gate off (${JSON.stringify(gate)}) must never set a cookie`); assert.equal(r.headers.get('x-robots-tag'), null); } }
});
test('C5. changing the password invalidates every cookie', () => {
  const old = ck(PW); assert.equal(d('/arena', { cookie: old }, PW), 'allow'); assert.equal(d('/arena', { cookie: old }, PW2), 'deny', 'a cookie of the old password must not pass the new one');
  setEnv(PW2, CRON); assert.equal(proxy(req('/arena', { cookie: old })).status, 401); assert.equal(passes(proxy(req('/arena', { cookie: ck(PW2) }))), true);
});
test('C6. source: one Set-Cookie site in proxy.ts guarded by siteGateBasicOk, the cookie compared in constant time, the password never written', () => {
  const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, ''); const px = strip(readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8')), lib = strip(readFileSync(new URL('../lib/siteGate.ts', import.meta.url), 'utf8'));
  assert.equal((px.match(/cookies\.set\(/g) ?? []).length, 1, 'exactly one place sets a cookie'); assert.match(px, /if \(siteGateBasicOk\(request\.headers\.get\('authorization'\), gatePassword\)\) \{\s*res\.cookies\.set\(SITE_GATE_COOKIE, siteGateCookieValue\(gatePassword\), \{ httpOnly: true, secure: true, sameSite: 'lax', path: '\/', maxAge: SITE_GATE_COOKIE_MAX_AGE_S \}\);/, 'the Set-Cookie is not guarded by a correct Basic or its flags changed');
  assert.match(lib, /safeEqual\(c, siteGateCookieValue\(env\.password\)\)/, 'the cookie is not compared in constant time'); assert.equal(/c === |=== c\b|cookie === |=== siteGateCookieValue|siteGateCookieValue\([^)]*\) ===/.test(lib), false, 'a plain === on the cookie');
  assert.match(lib, /createHmac\('sha256', password\)\.update\('lhq-gate-v1', 'utf8'\)\.digest\('hex'\)/, 'the cookie is not HMAC-SHA256 keyed by the password'); assert.equal(/cookies\.set|Set-Cookie/i.test(lib), false, 'the pure gate module must not set cookies itself');
  const idx = px.indexOf('siteGateBasicOk('); assert.ok(idx > px.indexOf('siteGateDecision('), 'the cookie is decided after the gate decision (never on a denied request)');
});
