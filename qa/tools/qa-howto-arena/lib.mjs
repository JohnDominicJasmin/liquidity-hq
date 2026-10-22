/* Shared harness for the How-to-test runs on qa (2026-10-01). ALLOWLIST fence, no sign-in, no credentials:
 *  - synthetic session in localStorage only (fake token, fake user id)
 *  - app host: GET/HEAD through (unless o.appStub answers it); every app write answered locally
 *  - Supabase: user_onboarding / user_subscriptions / user_settings GETs answered locally; everything else refused
 *  - public market-data GETs through; every other host aborted
 *  o.appStub(req, u) may fulfil a specific app request to drive a state (named in the PR comment as stubbed). */
import { chromium as pwChromium } from 'playwright';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { guarded } from '../regress/memguard.mjs';
/* PM 2026-10-21: one headless Chromium at a time, abort at 1.6 GB free (regress/memguard.mjs). */
export const chromium = guarded(pwChromium);
export const QA = { tag: process.env.QA_TAG || 'qa', base: process.env.QA_BASE || 'https://liquidity-hq-qa.onrender.com', ref: 'wdtjhrilakoitfcezxpx' };
export const PROD = { tag: 'prod', base: 'https://liquidity-hq.com', ref: 'qdpwhnvmhqgzijuwopso' };
export const UID = '00000000-0000-4000-8000-00000000fa4e';
/* Evidence folder. QA_OUT overrides; the default sits NEXT TO the checkout, outside the repo, so a run cannot commit its own screenshots
   and a cloud checkout needs no absolute path. It was an absolute
   path inside a session scratchpad under AppData\Local\Temp until 2026-10-22. */
export const OUT = process.env.QA_OUT || fileURLToPath(new URL('../../../../qa-evidence/qa-howto-arena', import.meta.url));
mkdirSync(OUT, { recursive: true });
const MARKET = /binance|bybit|okx|coinbase|deribit|coingecko|kraken|fonts\.|gstatic/;
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const session = () => JSON.stringify({ access_token: 'qa.synthetic.access-token', refresh_token: 'x', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, token_type: 'bearer', user: { id: UID, aud: 'authenticated', role: 'authenticated', email: 'qa-synthetic@example.invalid', app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() } });
export const PLAN_ROWS = {
  free: { user_id: UID, role: 'free', trial_ends_at: null },
  pro: { user_id: UID, role: 'pro', trial_ends_at: null },
  trial: { user_id: UID, role: 'free', trial_ends_at: new Date(Date.now() + 7 * 86400e3).toISOString() },
};
export function jlog(file) { const rows = []; return { say(o) { rows.push(o); console.log(JSON.stringify(o)); }, save() { writeFileSync(`${OUT}/${file}`, JSON.stringify(rows, null, 1)); } }; }

/* o: { b=QA, w=1280, h=800, signedIn=true, plan='free'|'pro'|'trial'|'fail', usDelay, lang, theme='dark', settings:{}, appStub, rec:[], init:{globals} } */
export async function open(browser, o = {}) {
  const b = o.b ?? QA; const w = o.w ?? 1280; const h = o.h ?? (w < 500 ? 844 : 800);
  const APP = new URL(b.base).host, SB = `${b.ref}.supabase.co`;
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, ...(w < 500 ? { isMobile: true, hasTouch: true } : {}) });
  const ls = { theme: o.theme ?? 'dark', lhq_analytics_consent_v1: 'denied', ...(o.lang ? { lhq_lang_v1: o.lang } : {}), ...(o.signedIn === false ? {} : { [`sb-${b.ref}-auth-token`]: o.realSession ? JSON.stringify(o.realSession) : session() }), ...(o.ls ?? {}) };
  await ctx.addInitScript(([m, g]) => { for (const [k, v] of Object.entries(m)) localStorage.setItem(k, v); for (const [k, v] of Object.entries(g)) window[k] = v; }, [ls, o.init ?? {}]);
  await ctx.routeWebSocket(/.*/, (ws) => ws.close());
  /* o.liveWs: pass the PUBLIC market-data streams the chart subscribes to (Bybit, Binance) through to the real server; every other socket stays closed. Needed for any live-feed test: the default closes all sockets, which kills the live candle stream. */
  if (o.liveWs) await ctx.routeWebSocket(/^wss:\/\/stream\.(bybit|bytick|binance)\.com/, (ws) => { ws.connectToServer(); });
  const rec = o.rec ?? [];
  const row = (r, x) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify((r.request().headers()['accept'] ?? '').includes('vnd.pgrst.object') ? x : [x]) });
  const note = (req, u, br) => rec.push({ t: Date.now(), m: req.method(), p: u.host === APP ? u.pathname + u.search : u.host + u.pathname, br, auth: req.headers()['authorization'] ? 'bearer' : null, body: req.method() === 'GET' ? undefined : (req.postData() ?? '').slice(0, 300) });
  await ctx.route('**/*', async (r) => {
    const req = r.request(); const u = new URL(req.url());
    if (u.protocol === 'data:' || u.protocol === 'blob:') return r.continue();
    if (u.host === APP) {
      if (o.appStub) { const done = await o.appStub(r, req, u); if (done) { note(req, u, 'STUB'); return; } }
      if (req.method() === 'GET' || req.method() === 'HEAD') return r.continue();
      let f = []; try { f = Object.keys(JSON.parse(req.postData() || '{}')).filter((k) => k !== 'knownAsOf'); } catch { /* */ }
      note(req, u, 'app-write-local');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, accepted: f, rejected: [], settings: {} }) });
    }
    if (u.host === SB) {
      if (req.method() === 'GET' && o.signedIn !== false) {
        if (/user_onboarding/.test(u.pathname)) return row(r, { user_id: UID, tour_seen: true, profile_complete: true, checklist_telegram: true, checklist_price_alert: true, checklist_grok: true, checklist_coins: true });
        /* o.realSession: a REAL session minted for a seeded test account on the dev project (see arena-live-gate.mjs). Only the subscription row is read from the real database (a GET, through);
           onboarding and settings stay answered locally and every Supabase write stays refused, so the page learns the account's REAL plan and nothing is written. */
        if (o.realSession && /user_subscriptions/.test(u.pathname)) { note(req, u, 'plan:REAL'); return r.continue(); }
        if (/user_subscriptions/.test(u.pathname)) {
          note(req, u, `plan:${o.plan ?? 'free'}${o.usDelay ? ':held' + o.usDelay : ''}`);
          if (o.usDelay) await sleep(o.usDelay);
          if (o.plan === 'fail') return r.abort('failed').catch(() => {});
          return row(r, o.planRow ?? PLAN_ROWS[o.plan ?? 'free']).catch(() => {});
        }
        if (/user_settings/.test(u.pathname)) return row(r, { user_id: UID, risk_pct: 1, default_coin: 'btc', default_tf: '1h', watchlist: [], field_updated_at: {}, ...(o.lang ? { language: o.lang } : {}), ...(o.settings ?? {}) });
      }
      note(req, u, 'sb-refused');
      return r.abort('failed');
    }
    if (req.method() === 'GET' && req.resourceType() !== 'document' && MARKET.test(u.host)) return r.continue();
    /* o.allowHosts: a regexp of extra hosts this ONE run may reach (used to LOOK at the embedded Whop checkout; nothing is ever submitted to them). Everything else stays aborted. */
    if (o.allowHosts && o.allowHosts.test(u.host)) return r.continue();
    return r.abort('failed');
  });
  return ctx;
}
export async function settle(page) {
  await page.waitForFunction(() => !document.querySelector('.obw-root.obw-loading'), null, { timeout: 30_000 }).catch(() => {});
  for (let i = 0; i < 2; i++) { const d = page.getByRole('button', { name: 'Decline' }); await page.waitForTimeout(600); if (await d.isVisible().catch(() => false)) await d.click().catch(() => {}); }
}
export async function version(b = QA) { const v = await (await fetch(b.base + '/api/version')).json(); return v.commit; }
