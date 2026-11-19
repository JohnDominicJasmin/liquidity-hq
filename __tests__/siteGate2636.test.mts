import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { NextRequest } from 'next/server';
import { siteGateDecision, basicPassword, safeEqual, SITE_GATE_EXEMPT_PATHS, SITE_GATE_ROBOTS_TXT, SITE_GATE_ROBOTS_TAG, SITE_GATE_REALM } from '../lib/siteGate.ts';
import { proxy } from '../proxy.ts';

/* #2636 THE TEAM-ONLY GATE (dev, qa and staging behind a password; production never sets it). Rules from the PR text, as literals:
 *   - SITE_GATE_PASSWORD unset or empty = NO gate: no 401, no WWW-Authenticate, no X-Robots-Tag, /robots.txt is left to the app, /backtest and /live-tracking still redirect 307 to /dashboard, everything else passes untouched
 *   - set: every page and API needs HTTP Basic (any user name, the password may contain colons) else 401 with WWW-Authenticate: Basic realm="Team only", X-Robots-Tag: noindex, nofollow and no-store; with the password it passes AND carries noindex
 *   - /robots.txt is answered by the gate: 200, "User-agent: *" / "Disallow: /" (even without a password: a crawler must read the refusal, not a login wall)
 *   - exempt without a password: /api/version, /api/lemonsqueezy/webhook, /api/boomfi/webhook, /api/whop/webhook, /api/telegram/webhook; and a request whose x-cron-secret EQUALS CRON_SECRET; a WRONG secret, or any secret while CRON_SECRET is empty, is NOT exempt
 *   - the password is compared without a timing difference; nothing of it is written in the repo
 *   G1 the decision table   G2 the gate OFF   G3 the gate ON   G4 the compare, the matcher and the secrets */
const PW = 'correct horse: battery:staple', CRON = 'cron-secret-xyz';
const basic = (pw: string, user = 'team') => 'Basic ' + Buffer.from(`${user}:${pw}`, 'utf8').toString('base64');
const req = (path: string, headers: Record<string, string> = {}) => new NextRequest(`https://site.test${path}`, { headers });
const saved = { gate: process.env.SITE_GATE_PASSWORD, cron: process.env.CRON_SECRET };
const setEnv = (gate: string | undefined, cron: string | undefined) => { if (gate === undefined) delete process.env.SITE_GATE_PASSWORD; else process.env.SITE_GATE_PASSWORD = gate; if (cron === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = cron; };
afterEach(() => setEnv(saved.gate, saved.cron));
const passes = (r: Response) => r.headers.get('x-middleware-next') === '1' && r.status === 200;

test('G1. siteGateDecision: robots, the five exempt paths, the password, the cron secret, and every way to be denied', () => {
  const env = { password: PW, cronSecret: CRON }; const d = (path: string, o: { authorization?: string | null; cronSecretHeader?: string | null } = {}, e: { password: string; cronSecret?: string | null } = env) => siteGateDecision({ pathname: path, ...o }, e);
  assert.equal(d('/robots.txt'), 'robots'); assert.equal(d('/robots.txt', { authorization: basic(PW) }), 'robots', 'robots is answered the same with the password');
  assert.deepEqual([...SITE_GATE_EXEMPT_PATHS], ['/api/version', '/api/lemonsqueezy/webhook', '/api/boomfi/webhook', '/api/whop/webhook', '/api/telegram/webhook']);
  for (const p of SITE_GATE_EXEMPT_PATHS) assert.equal(d(p), 'allow', `${p} must pass without a password`);
  for (const p of ['/api/version/', '/api/version/x', '/API/VERSION', '/api/telegram/alert', '/api/telegram/webhook/x', '/api/lemonsqueezy', '/arena', '/', '/api/market/ingest']) assert.equal(d(p), 'deny', `${p} must not be exempt`);
  assert.equal(d('/arena', { authorization: basic(PW) }), 'allow'); assert.equal(d('/arena', { authorization: basic(PW, '') }), 'allow', 'an empty user name'); assert.equal(d('/arena', { authorization: basic(PW, 'anyone') }), 'allow', 'any user name');
  assert.equal(d('/arena', { authorization: basic('a:b:c') }, { password: 'a:b:c' }), 'allow', 'a password with colons');
  for (const bad of [null, undefined, '', 'Basic', 'Basic ', 'Basic !!!', 'Bearer abc', 'basic', basic('wrong'), basic(PW + 'x'), basic(PW.slice(0, -1)), basic(''), 'Basic ' + Buffer.from('nocolon').toString('base64'), 'Digest ' + Buffer.from(`u:${PW}`).toString('base64')]) assert.equal(d('/arena', { authorization: bad }), 'deny', `Authorization ${JSON.stringify(bad)} must be denied`);
  assert.equal(d('/api/market/ingest', { cronSecretHeader: CRON }), 'allow', 'the right cron secret passes'); assert.equal(d('/api/market/ingest', { cronSecretHeader: 'wrong' }), 'deny', 'a WRONG secret must not be exempt'); assert.equal(d('/api/market/ingest', { cronSecretHeader: CRON + 'x' }), 'deny'); assert.equal(d('/api/market/ingest', { cronSecretHeader: '' }), 'deny');
  assert.equal(d('/api/market/ingest', { cronSecretHeader: 'anything' }, { password: PW, cronSecret: '' }), 'deny', 'with CRON_SECRET empty no secret is accepted'); assert.equal(d('/api/market/ingest', { cronSecretHeader: '' }, { password: PW, cronSecret: '' }), 'deny'); assert.equal(d('/api/market/ingest', { cronSecretHeader: 'x' }, { password: PW, cronSecret: null }), 'deny');
  assert.equal(basicPassword(basic('p:q')), 'p:q'); assert.equal(basicPassword('Basic ' + Buffer.from(':').toString('base64')), '', 'an empty password parses to the empty string (and never equals a non-empty one)');
  assert.equal(safeEqual('a', 'a'), true); assert.equal(safeEqual('a', 'b'), false); assert.equal(safeEqual('a', 'aa'), false, 'different lengths must not throw');
});
test('G2. gate OFF (variable unset or empty): no 401, no gate headers, /robots.txt left to the app, /backtest and /live-tracking still redirect 307 to /dashboard', () => {
  for (const gate of [undefined, '']) {
    setEnv(gate, CRON);
    for (const p of ['/arena', '/', '/api/market/snapshot', '/api/version', '/dashboard']) { const r = proxy(req(p)); assert.equal(passes(r), true, `${JSON.stringify(gate)}: ${p} must pass untouched`); assert.equal(r.headers.get('x-robots-tag'), null, `${JSON.stringify(gate)}: ${p} carries X-Robots-Tag with the gate off`); assert.equal(r.headers.get('www-authenticate'), null); }
    const robots = proxy(req('/robots.txt')); assert.equal(passes(robots), true, 'with the gate off /robots.txt is the app\'s own, not the gate\'s'); assert.equal(robots.headers.get('content-type'), null);
    for (const p of ['/backtest', '/live-tracking']) { const r = proxy(req(p)); assert.equal(r.status, 307); assert.equal(new URL(r.headers.get('location')!).pathname, '/dashboard'); assert.equal(r.headers.get('x-robots-tag'), null); }
    assert.equal(passes(proxy(req('/backtest/results'))), true, 'only the two exact paths are blocked');
  }
});
test('G3. gate ON: 401 + challenge + noindex without the password; 200 + noindex with it; robots.txt disallows all; the exempt paths and the right cron secret pass; a wrong secret is refused', () => {
  setEnv(PW, CRON);
  for (const p of ['/arena', '/', '/api/market/snapshot', '/dashboard', '/api/telegram/alert']) {
    const r = proxy(req(p)); assert.equal(r.status, 401, `${p} without credentials`); assert.equal(r.headers.get('www-authenticate'), `Basic realm="${SITE_GATE_REALM}", charset="UTF-8"`); assert.equal(r.headers.get('x-robots-tag'), SITE_GATE_ROBOTS_TAG); assert.equal(r.headers.get('cache-control'), 'no-store'); assert.notEqual(r.headers.get('x-middleware-next'), '1', `${p}: a denied request was let through`);
  }
  assert.equal(SITE_GATE_ROBOTS_TAG, 'noindex, nofollow'); assert.equal(SITE_GATE_REALM, 'Team only');
  for (const p of ['/arena', '/api/market/snapshot']) { const r = proxy(req(p, { authorization: basic(PW) })); assert.equal(passes(r), true, `${p} with the password`); assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', `${p} with the password must still carry noindex`); }
  assert.equal(proxy(req('/arena', { authorization: basic('wrong') })).status, 401); assert.equal(proxy(req('/arena', { authorization: 'Bearer ' + PW })).status, 401);
  const robots = proxy(req('/robots.txt')); assert.equal(robots.status, 200); assert.equal(robots.headers.get('content-type'), 'text/plain; charset=utf-8'); assert.equal(robots.headers.get('x-robots-tag'), 'noindex, nofollow'); assert.equal(SITE_GATE_ROBOTS_TXT, 'User-agent: *\nDisallow: /\n');
  assert.equal(passes(proxy(req('/robots.txt', { authorization: basic(PW) }))), false, 'robots.txt is the gate\'s even with credentials (it is answered, not passed on)');
  for (const p of SITE_GATE_EXEMPT_PATHS) { const r = proxy(req(p)); assert.equal(passes(r), true, `${p} must pass without a password`); assert.equal(r.headers.get('x-robots-tag'), 'noindex, nofollow', `${p}: the robots tag is on every response`); }
  assert.equal(passes(proxy(req('/api/market/ingest', { 'x-cron-secret': CRON }))), true, 'the right cron secret'); assert.equal(proxy(req('/api/market/ingest', { 'x-cron-secret': 'wrong' })).status, 401, 'a wrong cron secret is refused'); assert.equal(proxy(req('/api/market/ingest', { 'x-cron-secret': '' })).status, 401);
  setEnv(PW, undefined); assert.equal(proxy(req('/api/market/ingest', { 'x-cron-secret': 'anything' })).status, 401, 'with CRON_SECRET unset nothing passes by secret'); setEnv(PW, '');
  assert.equal(proxy(req('/api/market/ingest', { 'x-cron-secret': '' })).status, 401, 'an empty header against an empty CRON_SECRET must not pass');
  setEnv(PW, CRON); assert.equal(proxy(req('/backtest')).status, 401, 'the gate comes before the hidden-page redirect'); const bt = proxy(req('/backtest', { authorization: basic(PW) })); assert.equal(bt.status, 307); assert.equal(bt.headers.get('x-robots-tag'), 'noindex, nofollow');
});
test('G4. the compare is constant-time and used for both secrets; the matcher skips only Next\'s static assets; the proxy never rewrites a request header or reads headers(); the password is not written anywhere in the repo', () => {
  const lib = readFileSync(new URL('../lib/siteGate.ts', import.meta.url), 'utf8'), px = readFileSync(new URL('../proxy.ts', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
  assert.ok(/timingSafeEqual\(digest\(a\), digest\(b\)\)/.test(lib), 'the compare is not constant-time'); assert.ok(/safeEqual\(req\.cronSecretHeader, env\.cronSecret\)/.test(lib) && /safeEqual\(given, env\.password\)/.test(lib), 'a secret is compared with === or not through safeEqual');
  const m = px.match(/matcher:\s*\[([^\]]*)\]/); assert.ok(m); assert.deepEqual([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]), ['/((?!_next/static|_next/image|favicon.ico).*)'], 'the matcher changed');
  assert.deepEqual([...(px.match(/new Set\(\[([^\]]*)\]\)/)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]), ['/backtest', '/live-tracking'], 'the blocked pages changed');
  assert.equal(/next\/headers|\bheaders\(\)|request:\s*\{\s*headers|new Headers\(|x-lhq-pathname/.test(px), false, 'the proxy reads headers() or rewrites request headers again (#1434)');
  const walk = (dir: string, out: string[] = []): string[] => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f === '.next' || f === '.git') continue; const p = `${dir}/${f}`; const s = statSync(p); if (s.isDirectory()) walk(p, out); else if (/\.(ts|tsx|mts|mjs|js|json|yml|yaml|md)$/.test(f)) out.push(p); } return out; };
  const root = new URL('..', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1'); const lits = walk(root).filter((f) => !/siteGate2636\.test\.mts$/.test(f)).filter((f) => /SITE_GATE_PASSWORD['"]?\s*[:=]\s*['"][^'"\s]{3,}['"]/.test(readFileSync(f, 'utf8')));
  assert.deepEqual(lits, [], `a file assigns SITE_GATE_PASSWORD a literal value: ${lits.join(', ')}`);
});
