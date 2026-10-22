/* #1640 sign-in / sign-up / forgot / reset / Google redirect / sign-out / onboarding / cookie banner.
 * NO account is created and no password is typed: the sign-in, sign-up and forgot forms are checked for their fields and their submit state (Turnstile
 * is fenced, so submit stays disabled by design; the CAPTCHA is never bypassed). Google: the redirect URL supabase-js builds is captured and answered
 * locally, so Google's page never loads. Sign-out: the logout call is answered locally (rlib: the app's signOut() is global scope).
 * Onboarding: the trial account T has no onboarding row, so its real read shows the wizard; every onboarding write is answered locally, so T keeps
 * its fresh state (#1113). Writes OFF throughout.
 * usage: node regress-auth.mjs [parts=cookie,login,google,forgot,reset,callback,signout,onboarding]                                                */
import { chromium, open, quiet, sleep, BASE, ROOT, REF } from './rlib.mjs';
import { mkdirSync, appendFileSync } from 'node:fs';
const parts = (process.argv[2] || 'cookie,login,google,forgot,reset,callback,signout,onboarding').split(',');
const DIR = { cookie: `${ROOT}/cookie-banner`, login: `${ROOT}/login`, onboarding: `${ROOT}/onboarding` }; for (const d of Object.values(DIR)) mkdirSync(d, { recursive: true });
const LOG = `${ROOT}/_sweep/auth.jsonl`;
const say = (o) => { console.log(JSON.stringify(o)); appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
const browser = await chromium.launch();
async function load(path, o = {}) {
  const rec = []; const ctx = await open(browser, { w: 1280, theme: 'dark', rec, ...o }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  const errs = []; page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 160)));
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(1000);
  return { ctx, page, rec, errs, inflight };
}
const FORM = () => ({
  url: location.pathname + location.search, h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 60),
  inputs: [...document.querySelectorAll('input')].filter((i) => i.getBoundingClientRect().width > 0).map((i) => `${i.type}:${i.getAttribute('aria-label') || i.name || i.placeholder || ''}`),
  buttons: [...document.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => `${(b.innerText || b.getAttribute('aria-label') || '').trim().replace(/\s+/g, ' ').slice(0, 40)}${b.disabled ? ' [disabled]' : ''}`).slice(0, 14),
  turnstileHost: !!document.querySelector('[id^="cf-chl"], .cf-turnstile, iframe[src*="challenges.cloudflare.com"]'),
  messages: [...document.querySelectorAll('[role="alert"], [role="status"], .error, .notice')].map((e) => (e.innerText || '').trim().slice(0, 100)).filter(Boolean).slice(0, 4),
});
try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  if (parts.includes('cookie')) for (const [choice, w] of [['Decline', 1280], ['Accept', 390]]) {
    const L = await load('/', { consent: null, w });
    const before = await L.page.evaluate(() => ({ decline: [...document.querySelectorAll('button')].some((b) => /^Decline$/.test(b.innerText.trim())), accept: [...document.querySelectorAll('button')].some((b) => /^Accept/.test(b.innerText.trim())), text: ([...document.querySelectorAll('[role="dialog"], [role="region"], aside, div')].find((d) => /cookie|analytics/i.test(d.innerText || '') && d.innerText.length < 400)?.innerText || '').trim().slice(0, 200) }));
    await L.page.screenshot({ path: `${DIR.cookie}/banner-${w}.jpg`, type: 'jpeg', quality: 70 });
    await L.page.locator('button').filter({ hasText: new RegExp(`^${choice}`) }).first().click({ timeout: 5000 }).catch(() => {}); await sleep(1200);
    const stored = await L.page.evaluate(() => localStorage.getItem('lhq_analytics_consent_v1'));
    const goneNow = !(await L.page.locator('button').filter({ hasText: /^Decline$/ }).first().isVisible().catch(() => false));
    await L.page.reload({ waitUntil: 'load' }); await sleep(3000);
    const goneAfterReload = !(await L.page.locator('button').filter({ hasText: /^Decline$/ }).first().isVisible().catch(() => false));
    const analyticsHosts = [...new Set(L.rec.filter((n) => n.kind === 'fence' && /posthog|sentry|glitchtip|google-analytics|googletagmanager|clarity|hotjar|segment/i.test(n.url)).map((n) => n.url.split('/')[0]))];
    say({ part: 'cookie', w, choice, bannerShown: before, storedValue: stored, hiddenAfterClick: goneNow, hiddenAfterReload: goneAfterReload, analyticsHostsRequested: analyticsHosts });
    await L.ctx.close();
  }
  if (parts.includes('login')) for (const path of ['/login', '/login?signup=1']) for (const w of [1280, 390]) {
    const L = await load(path, { w }); const f = await L.page.evaluate(FORM); await L.page.screenshot({ path: `${DIR.login}/form-${path.includes('signup') ? 'signup' : 'signin'}-${w}.jpg`, type: 'jpeg', quality: 70 });
    // the password-mode toggle, if the page starts on the email-link form
    const pwToggle = L.page.locator('button').filter({ hasText: /password/i }).first(); let pw = null;
    if (await pwToggle.count()) { await pwToggle.click({ timeout: 4000 }).catch(() => {}); await sleep(900); pw = await L.page.evaluate(FORM); await L.page.screenshot({ path: `${DIR.login}/form-${path.includes('signup') ? 'signup' : 'signin'}-password-${w}.jpg`, type: 'jpeg', quality: 70 }); }
    say({ part: 'login', path, w, form: f, passwordMode: pw, fencedHosts: [...new Set(L.rec.filter((n) => n.kind === 'fence').map((n) => n.url.split('/')[0]))], errors: L.errs });
    await L.ctx.close();
  }
  if (parts.includes('google')) {
    let authorize = null;
    const sbStub = async (r, req, u) => { if (/^\/auth\/v1\/authorize/.test(u.pathname)) { authorize = u.toString(); await r.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>qa stub</title><p>QA stub: the Google redirect was captured here and not followed.</p>' }); return true; } return false; };
    const L = await load('/login', { sbStub });
    const g = L.page.locator('button').filter({ hasText: /Google/i }).first(); const found = await g.count();
    if (found) { await g.click({ timeout: 5000 }).catch(() => {}); for (let i = 0; i < 20 && !authorize; i++) await sleep(500); }
    let parsed = null; if (authorize) { const u = new URL(authorize); parsed = { host: u.host, provider: u.searchParams.get('provider'), redirectTo: u.searchParams.get('redirect_to'), pkce: !!u.searchParams.get('code_challenge') }; }
    say({ part: 'google', buttonFound: !!found, authorizeCaptured: !!authorize, parsed, PASS: !!parsed && parsed.provider === 'google' && parsed.host === `${REF}.supabase.co` && (parsed.redirectTo || '').startsWith(BASE + '/auth/callback') });
    await L.ctx.close();
  }
  if (parts.includes('forgot')) { const L = await load('/forgot-password'); say({ part: 'forgot', form: await L.page.evaluate(FORM) }); await L.page.screenshot({ path: `${DIR.login}/forgot-1280.jpg`, type: 'jpeg', quality: 70 }); await L.ctx.close(); }
  if (parts.includes('reset')) { const L = await load('/reset-password'); await sleep(2500); say({ part: 'reset (no recovery token)', form: await L.page.evaluate(FORM), text: (await L.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 300) }); await L.page.screenshot({ path: `${DIR.login}/reset-no-token-1280.jpg`, type: 'jpeg', quality: 70 }); await L.ctx.close(); }
  if (parts.includes('callback')) { const L = await load('/auth/callback'); await sleep(3000); say({ part: 'auth/callback (no code)', finalUrl: L.page.url().replace(BASE, ''), text: (await L.page.evaluate(() => document.body.innerText)).replace(/\s+/g, ' ').slice(0, 200) }); await L.ctx.close(); }
  if (parts.includes('signout')) for (const [acct, via] of [['B', 'account menu'], ['T', 'settings button']]) {
    const L = await load(via === 'account menu' ? '/dashboard' : '/settings', { acct });
    const tokenBefore = await L.page.evaluate((k) => !!localStorage.getItem(k), `sb-${REF}-auth-token`);
    if (via === 'account menu') { await L.page.locator('button[aria-label="Account menu"]').first().click({ timeout: 5000 }).catch(() => {}); await sleep(900); await L.page.screenshot({ path: `${DIR.login}/account-menu-${acct}.jpg`, type: 'jpeg', quality: 70 }); }
    const so = L.page.locator('button, [role="menuitem"], a').filter({ hasText: /^(Sign out|Sign Out|Log out|Logout)$/ }).first(); const found = await so.count();
    if (found) { await so.click({ timeout: 5000 }).catch(() => {}); await sleep(4000); }
    const after = await L.page.evaluate((k) => ({ url: location.pathname, token: !!localStorage.getItem(k), navSignIn: /Sign in|Log in/i.test((document.querySelector('nav, header')?.innerText) || '') }), `sb-${REF}-auth-token`);
    await L.page.goto(BASE + '/alerts', { waitUntil: 'load' }); await sleep(4000);
    const gated = await L.page.evaluate(() => ({ url: location.pathname + location.search, signInPrompt: /Sign in|Log in/i.test(document.body.innerText.slice(0, 3000)) }));
    say({ part: 'signout', acct, via, buttonFound: !!found, tokenBefore, after, thenAlerts: gated, logoutCall: L.rec.filter((n) => n.kind === 'logout-local').length, PASS: !!found && tokenBefore && !after.token });
    await L.ctx.close();
  }
  if (parts.includes('onboarding')) for (const w of [1280, 390]) {
    const L = await load('/dashboard', { acct: 'T', onboarding: 'real', w }); await sleep(2500);
    const steps = [];
    for (let i = 0; i < 12; i++) {
      const s = await L.page.evaluate(() => { const r = document.querySelector('.obw-root'); if (!r) return null; return { text: (r.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 160), buttons: [...r.querySelectorAll('button')].filter((b) => b.getBoundingClientRect().width > 0).map((b) => `${b.innerText.trim().slice(0, 24)}${b.disabled ? ' [disabled]' : ''}`) }; });
      if (!s) break; steps.push(s);
      await L.page.screenshot({ path: `${DIR.onboarding}/T-${w}-step${i + 1}.jpg`, type: 'jpeg', quality: 70 });
      const next = L.page.locator('.obw-root button').filter({ hasText: /^(Next|Continue|Get started|Start|Done|Finish|Let's go|Skip for now|Skip)/i }).first();
      /* Fill what the step requires (components/OnboardingFlow.tsx canNext): profile = a country AND an account range; experience, style and
         goals = one option row. The first version clicked "the first enabled button", which on the profile step is the country dropdown itself,
         so the wizard never left step 1 (2026-10-21 run). */
      if (!(await next.count()) || await next.isDisabled()) {
        const country = L.page.locator('.obw-root button[aria-labelledby="obw-country-label obw-country-value"]');
        if (await country.count() && /select your country/i.test(await country.innerText().catch(() => ''))) { await country.click({ timeout: 4000 }).catch(() => {}); await sleep(600); await L.page.locator('.obw-root button').filter({ hasText: /Philippines/ }).first().click({ timeout: 4000 }).catch(() => {}); await sleep(600); }
        if (!(await L.page.locator('.obw-root .obw-tile[aria-pressed="true"]').count())) { const tile = L.page.locator('.obw-root .obw-tile').first(); if (await tile.count()) { await tile.click({ timeout: 4000 }).catch(() => {}); await sleep(500); } }
        if (!(await L.page.locator('.obw-root button.obw-row[aria-pressed="true"]').count())) { const row = L.page.locator('.obw-root button.obw-row').first(); if (await row.count()) { await row.click({ timeout: 4000 }).catch(() => {}); await sleep(500); } }
        continue;
      }
      await next.click({ timeout: 4000 }).catch(() => {}); await sleep(1500);
    }
    say({ part: 'onboarding', acct: 'T', w, wizardShown: steps.length > 0, steps: steps.length, stepTexts: steps.map((s) => s.text.slice(0, 90)), lastButtons: steps.at(-1)?.buttons, closedAtEnd: !(await L.page.locator('.obw-root').count()), localWrites: L.rec.filter((n) => /onboarding/.test(n.kind)).length });
    await L.ctx.close();
  }
} finally { await browser.close(); }
