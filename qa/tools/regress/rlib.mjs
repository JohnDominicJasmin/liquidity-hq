/* Real-account harness for the full regression (#1640, 2026-10-21), qa only.
 *
 * SESSIONS: real sessions for the SEEDED dev-project test accounts (A pro, B free, T trial), minted by password grant from the gitignored env files,
 * the same way the committed e2e fixtures do it. Credentials are never printed or written anywhere. Refuses to mint against any project but dev.
 * FENCE: the app host and the dev Supabase project pass. Public market-data GETs, their sockets, and fonts pass. Every other host is aborted with
 * 'blockedbyclient' (net::ERR_BLOCKED_BY_CLIENT), so a fence block can never be mistaken for a page failure.
 * WRITES are off by default: app writes are answered locally, Supabase writes are refused with 'accessdenied'. o.writes = true lets them through,
 * EXCEPT the deny list (AI, Telegram send/test, payments, Whop, push, cancel, account deletion, ops/admin), which stays answered locally;
 * o.allowAI (RegExp on the path) lets one named AI request through for the billed-call steps.
 * /auth/v1/logout is ALWAYS answered locally: the app's signOut() uses supabase-js's default 'global' scope and would revoke every session of the account.
 * ONBOARDING: o.onboarding = 'done' (default) answers the user_onboarding read locally as completed, so the wizard does not cover the page under test;
 * 'real' reads the real row. Onboarding writes always stay local. */
import { chromium as pwChromium } from 'playwright';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { guarded } from './memguard.mjs';
/* The repo root, derived from this file's own location (qa/tools/regress/rlib.mjs) so it is right in any checkout, on this laptop or in a
   cloud session. QA_REPO overrides it. It was an absolute C:/Users path until 2026-10-22. */
const REPO = process.env.QA_REPO || fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
/* PM 2026-10-21: one headless Chromium at a time, abort at 1.6 GB free (memguard.mjs). Every script launches through this. */
export const chromium = guarded(pwChromium);
/* QA_BASE / QA_ROOT point a run at another environment on the DEV project (staging uses the dev Supabase too) and keep its evidence apart.
   Never production: REF below is the dev project, and session() refuses any other. */
export const BASE = process.env.QA_BASE || 'https://liquidity-hq-qa.onrender.com';
if (/liquidity-hq\.com/.test(BASE)) throw new Error('rlib: production is not a target for this harness');
export const REF = 'wdtjhrilakoitfcezxpx';
/* Where a run writes its evidence. QA_ROOT overrides; the default is `qa-evidence/` NEXT TO the checkout (outside the repo, so a run can
   never commit its own screenshots), which works on this laptop and in a cloud session alike. The old default was the absolute
   C:/Users/Dominic/Documents/LiquidityHQ-QA-regression-2026-10-21. */
export const ROOT = process.env.QA_ROOT || `${REPO}/../qa-evidence`;
mkdirSync(ROOT, { recursive: true });
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const env = {};
for (const f of ['.env.e2e.local', '.env.local']) { const p = `${REPO}/${f}`; if (!existsSync(p)) continue; for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^\uFEFF/, '')); if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, ''); } }
export const ACCT_NAME = { anon: 'signed out', B: 'Free (B)', T: 'trial (T)', A: 'Pro (A)' };
export const userId = (a) => (a === 'anon' ? null : env[`E2E_USER_${a}_ID`]);

const minted = {};
/** A real session for seeded account A, B or T; re-minted when under 15 minutes are left. */
export async function session(a) {
  if (a === 'anon') return null;
  const have = minted[a];
  if (have && have.expires_at * 1000 - Date.now() > 15 * 60_000) return have;
  const url = env.NEXT_PUBLIC_SUPABASE_URL; const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || new URL(url).hostname.split('.')[0] !== REF) throw new Error('refusing: env Supabase URL is not the dev project');
  const email = env[`E2E_USER_${a}_EMAIL`]; const password = env[`E2E_USER_${a}_PASSWORD`];
  if (!email || !password) throw new Error(`no fixture credentials for ${a}`);
  /* Three tries, 5 s and 15 s apart: the dev project's auth gateway answered 504 three times during the first sweep (05:0x UTC). */
  let r = null;
  for (const wait of [0, 5000, 15000]) { if (wait) await sleep(wait); r = await fetch(`${url}/auth/v1/token?grant_type=password`, { method: 'POST', headers: { apikey: anon, 'content-type': 'application/json' }, body: JSON.stringify({ email, password }) }).catch(() => null); if (r && r.ok) break; }
  if (!r || !r.ok) throw new Error(`sign-in for ${a} failed: HTTP ${r ? r.status : 'network error'}`);
  const s = await r.json();
  minted[a] = { access_token: s.access_token, refresh_token: s.refresh_token, expires_in: s.expires_in, expires_at: Math.floor(Date.now() / 1000) + s.expires_in, token_type: 'bearer', user: s.user };
  return minted[a];
}
export const accountEmail = (a) => (a === 'anon' ? null : env[`E2E_USER_${a}_EMAIL`]);
export const anonKey = () => env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const MARKET = /(^|\.)(binance\.com|binance\.vision|bybit\.com|bytick\.com|okx\.com|coinbase\.com|deribit\.com|coingecko\.com|kraken\.com)$/;
const FONTS = /(^|\.)(fonts\.googleapis\.com|fonts\.gstatic\.com|gstatic\.com)$/;
/* Never let these through, whatever o.writes says: AI (billed), email (every signed-in load POSTs /api/auth/welcome-email), Telegram send/test, push,
   payments and claims, account deletion, staff routes. */
const DENY = /^\/api\/(grok|grok-chat|briefing|behavioral-bias|hypotheses|pine-script|shadow-account|smc-snapshot|strategy-research|thesis-check|token-unlock|auth\/welcome-email|telegram\/(send|test)|push\/|lemonsqueezy|whop|checkout|boomfi|crypto-checkout|account|ops|admin)/;
/* The local answer mirrors the shape /api/settings returns ({ ok, accepted, rejected, settings }), so a page that reads it does not log a fence artifact. */
const localAnswer = (req) => { let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* not JSON */ } return JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {}, qaLocal: true }); };

/* o: { acct='anon'|'A'|'B'|'T', w=1280, h, theme='dark', lang, consent='denied'|null, ls:{}, writes=false, allowAI:RegExp, onboarding='done'|'real',
        allowHosts:RegExp, appStub(r,req,u)->bool, sbStub(r,req,u)->bool, rec:[] } */
export async function open(browser, o = {}) {
  const acct = o.acct ?? 'anon'; const w = o.w ?? 1280; const h = o.h ?? (w < 500 ? 844 : 800);
  const APP = new URL(BASE).host, SB = `${REF}.supabase.co`;
  const s = await session(acct);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}), locale: 'en-US', timezoneId: 'UTC' });
  const ls = { theme: o.theme ?? 'dark', ...(o.consent === null ? {} : { lhq_analytics_consent_v1: o.consent ?? 'denied' }), ...(o.lang ? { lhq_lang_v1: o.lang } : {}), ...(s ? { [`sb-${REF}-auth-token`]: JSON.stringify(s) } : {}), ...(o.ls ?? {}) };
  /* Seeds once per tab and only on the app's own origin (never inside a third-party frame); a reload keeps whatever the page itself stored since. */
  await ctx.addInitScript(([m, host]) => { try { if (location.host !== host || sessionStorage.getItem('__qa_seeded')) return; sessionStorage.setItem('__qa_seeded', '1'); for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v); } catch { /* storage blocked */ } }, [ls, APP]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  await ctx.routeWebSocket(/^wss:\/\/stream\.(bybit|bytick|binance)\.com/, (ws) => { ws.connectToServer(); });
  const rec = o.rec ?? [];
  const note = (kind, req, u) => rec.push({ t: Date.now(), kind, m: req.method(), url: u.host === APP ? u.pathname + u.search : u.host + u.pathname });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url()); const m = req.method();
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (o.appStub && await o.appStub(r, req, u)) { note('app-stub', req, u); return; }
      /* Three paid xAI routes answer a GET (they spend on every load of the panel that shows them). Until 2026-10-21 these went through like any
         read: the Pro dashboard loads in the language scan spent 11 macro-context calls and, with the morning's billed calls, reached qa's global
         daily xAI cap at 11:10 UTC (AI blocked for every user on the dev project until 00:00). Answered locally now unless o.allowAI names them. */
      if ((m === 'GET' || m === 'HEAD') && /^\/api\/(macro-context|dry-powder|onchain)(\/|$)/.test(u.pathname) && !(o.allowAI && o.allowAI.test(u.pathname))) {
        note('ai-get-local', req, u); return r.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: 'qa-fence: paid AI GET not called', qaLocal: true }) });
      }
      if (m === 'GET' || m === 'HEAD') return r.continue();
      if (o.allowAI && o.allowAI.test(u.pathname)) { note('ai-through', req, u); return r.continue(); }
      if (o.writes && !DENY.test(u.pathname)) { note('app-write-through', req, u); return r.continue(); }
      note('app-write-local', req, u);
      return r.fulfill({ status: 200, contentType: 'application/json', body: localAnswer(req) });
    }
    if (u.host === SB) {
      if (o.sbStub && await o.sbStub(r, req, u)) { note('sb-stub', req, u); return; }
      if (/^\/auth\/v1\/logout/.test(u.pathname)) { note('logout-local', req, u); return r.fulfill({ status: 204, body: '' }); }
      /* Signed out: the public reads a real visitor's browser makes with the anon key (e.g. the liquidation backfill) pass; any write stays refused. */
      if (acct === 'anon') { if ((m === 'GET' || m === 'HEAD') && /^\/rest\/v1\//.test(u.pathname)) return r.continue(); note('sb-refused', req, u); return r.abort('accessdenied'); }
      if (/user_onboarding/.test(u.pathname) && (o.onboarding ?? 'done') === 'done' && m === 'GET') {
        note('onboarding-local', req, u);
        const row = { user_id: userId(acct), tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true };
        return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((req.headers()['accept'] ?? '').includes('vnd.pgrst.object') ? row : [row]) });
      }
      if (/user_onboarding/.test(u.pathname) && m !== 'GET') { note('onboarding-write-local', req, u); return r.fulfill({ status: 201, contentType: 'application/json', body: '[]' }); }
      if (m === 'GET' || m === 'HEAD' || /^\/auth\/v1\/(token|user)/.test(u.pathname)) return r.continue();
      if (o.writes) { note('sb-write-through', req, u); return r.continue(); }
      note('sb-refused', req, u); return r.abort('accessdenied');
    }
    if ((m === 'GET' || m === 'HEAD') && req.resourceType() !== 'document' && (MARKET.test(u.host) || FONTS.test(u.host))) return r.continue();
    if (o.allowHosts && o.allowHosts.test(u.host)) return r.continue();
    note('fence', req, u); return r.abort('blockedbyclient');
  });
  return ctx;
}

/** Wait until no app/Supabase/market request has been in flight for quietMs (requests older than 15 s are ignored: streams, long polls), capped at maxMs. */
export async function quiet(page, inflight, quietMs = 2000, maxMs = 25_000) {
  const t0 = Date.now(); let calmSince = Date.now();
  while (Date.now() - t0 < maxMs) {
    const now = Date.now(); let busy = 0;
    for (const t of inflight.values()) if (now - t < 15_000) busy++;
    if (busy > 0) calmSince = now; else if (now - calmSince >= quietMs) return Date.now() - t0;
    await sleep(250);
  }
  return Date.now() - t0;
}

/** The cookie banner's Decline, if it is up (a context opened with consent=null shows it). */
export async function declineCookies(page) {
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(500); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}

/** The app's own theme switch (lib/theme.ts applyTheme): attribute, storage, and the 'theme-change' event the canvas charts re-style on. */
export async function flipTheme(page, next) {
  await page.evaluate((t) => { document.documentElement.setAttribute('data-theme', t); try { localStorage.setItem('theme', t); } catch { /* */ } window.dispatchEvent(new Event('theme-change')); }, next);
}

export const slug = (p) => (p === '/' ? 'landing' : p.replace(/^\//, '').replace(/\?signup=1$/, '-signup').replace(/[^a-z0-9-]+/gi, '-'));
export function dirFor(p) { const d = `${ROOT}/${slug(p)}`; mkdirSync(d, { recursive: true }); return d; }
