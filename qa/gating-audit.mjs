#!/usr/bin/env node
/* Scores the paid-surface gating criteria against a DEPLOYED build.
 *
 * WHY A SCRIPT AND NOT A SOURCE READ
 * ----------------------------------
 * Both #554 criteria are about what a non-entitled visitor's browser actually
 * renders. A source read establishes that the JSX is guarded; it does not
 * establish that the deployed bundle is the guarded one, that entitlement
 * resolves false for a signed-out visitor at runtime, or that a control is
 * disabled in the DOM rather than only styled to look it. Those are different
 * claims and this project has been caught by the gap before (a "fix did not
 * work" report measured against a stale deploy).
 *
 * WHAT IT CHECKS
 *   /alerts   — Alert Conditions must be ABSENT (node count 0), not present
 *               and locked. A locked control still advertises the paid surface.
 *   /settings — gated chips must carry BOTH the `disabled` property (or
 *               aria-disabled) AND a lock glyph. Styling alone is not gating:
 *               an enabled-but-grey button is still clickable and focusable.
 *
 * WHAT IT CANNOT CHECK
 * Signed-out is a proxy for non-entitled, not the same thing. A signed-in free
 * account can differ. That case needs a fixture account; this run does not
 * cover it and must not be reported as though it does.
 *
 * Usage:
 *   node qa/gating-audit.mjs [--base <url>] [--json]
 *
 * Run with MSYS_NO_PATHCONV=1 in Git Bash or route paths become Windows paths.
 */

import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const JSON_OUT = process.argv.includes('--json');
/* Signed-out is a PROXY for non-entitled, and on /settings it turned out to be
   a useless one: signed-out renders no gated chips at all, so the criterion was
   never exercised. --free signs in as the seeded free-tier account (B: role
   'free', trial_ends_at NULL) which is the state the criterion is actually
   about. This is ONE password grant plus two page loads — it is not a run of
   the E2E suite and does not carry that cost. */
const FREE = process.argv.includes('--free');

/* Read .env.e2e.local directly rather than importing qa/e2e/_auth.ts, which is
   TypeScript and would need the Playwright test runner to load. */
function envFile(path) {
  const out = {};
  try {
    for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
  } catch { /* absent is fine — --free will report why it cannot run */ }
  return out;
}

async function freeContext(browser) {
  const env = { ...envFile('.env.e2e.local'), ...envFile('.env.local'), ...process.env };
  const url = env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const email = env.E2E_USER_B_EMAIL;
  const password = env.E2E_USER_B_PASSWORD;
  const missing = Object.entries({ NEXT_PUBLIC_SUPABASE_URL: url, NEXT_PUBLIC_SUPABASE_ANON_KEY: anon, E2E_USER_B_EMAIL: email, E2E_USER_B_PASSWORD: password })
    .filter(([, v]) => !v).map(([k]) => k);
  if (missing.length) throw new Error(`--free needs ${missing.join(', ')} in .env.e2e.local`);

  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: 'POST',
    headers: { apikey: anon, 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password }),
  });
  const s = await res.json().catch(() => ({}));
  /* Throw loudly. A silent auth failure would leave this measuring the
     signed-out page again while reporting it as the signed-in result. */
  if (!s.access_token) throw new Error(`sign-in failed for the free fixture: HTTP ${res.status}`);

  const ref = new URL(url).hostname.split('.')[0];
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(([r, sess]) => {
    try {
      localStorage.setItem('theme', 'dark');
      localStorage.setItem('lhq-design-mode', 'terminal');
      localStorage.setItem(`sb-${r}-auth-token`, JSON.stringify({
        access_token: sess.access_token, refresh_token: sess.refresh_token,
        expires_in: sess.expires_in, expires_at: Math.floor(Date.now() / 1000) + sess.expires_in,
        token_type: 'bearer', user: sess.user,
      }));
    } catch {}
  }, [ref, s]);
  return ctx;
}

const PAGE_EVAL = () => {
  const LOCK = /[\u{1F512}\u{1F510}]|\block(ed)?\b/iu;
  const txt = document.body.innerText || '';

  /* Leaf nodes only — an ancestor containing the phrase would count the whole
     subtree and report presence where there is none. */
  const leaves = [...document.querySelectorAll('*')].filter(e => !e.children.length);
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  const conditionNodes = leaves.filter(e => /alert condition/i.test(e.textContent || ''));

  const CONTROL_SEL = 'button,[role="radio"],[role="tab"],[class*="chip"],input,select';
  const controls = [...document.querySelectorAll(CONTROL_SEL)]
    .filter(visible)
    /* Drop CONTAINERS. `[class*="chip"]` also matches `.st-chip-row`, the
       wrapper around the chips — and a wrapper inherits its children's text,
       so the row read as "1m 🔒5m 🔒15m 🔒30m1h2h4h1d": locked (it contains
       lock glyphs) but not disabled (a div cannot be), i.e. a fabricated
       "locked but enabled" leak sitting on top of three correctly gated chips.
       Anything that contains another control is scaffolding, not a control. */
    .filter(e => !e.querySelector(CONTROL_SEL))
    .map(e => ({
      tag: e.tagName.toLowerCase(),
      cls: (e.className || '').toString().trim().split(/\s+/).slice(0, 2).join(' '),
      text: (e.textContent || '').trim().slice(0, 30),
      disabled: !!e.disabled || e.getAttribute('aria-disabled') === 'true',
      /* Do NOT treat any <svg> as a lock. The first version of this check did,
         and reported the theme chips' sun/moon icons and the Ask-AI FAB as four
         "locked but enabled" leaks — a fabricated FAIL on a passing surface.
         A lock has to identify itself: the glyph, a lock-named class, or an
         accessible name that says so. */
      lock: LOCK.test(e.textContent || '') || LOCK.test(e.getAttribute('aria-label') || '') ||
            LOCK.test(e.getAttribute('title') || '') ||
            /lock/i.test((e.className || '').toString()) ||
            [...e.querySelectorAll('[class*="lock" i],[data-locked]')].length > 0 ||
            [...e.querySelectorAll('svg')].some(s => /lock/i.test(
              (s.getAttribute('class') || '') + (s.getAttribute('aria-label') || '') + (s.querySelector('title')?.textContent || ''))),
    }))
    .filter(c => c.text || c.tag === 'input');

  return {
    path: location.pathname,
    /* Detect the AFFIRMATIVE signed-in signal, not the absence of sign-in
       words. The earlier version tested for "sign in|log in|sign up|create
       account" anywhere in the page text, and /settings carries a "Create free
       account" call-to-action in its Account section that is present for a
       signed-IN free user too — so a perfectly good session reported itself as
       "did not take". A sign-out control only exists when a session exists. */
    signedOut: !/\b(sign out|log out)\b/i.test(txt),
    conditionsPresent: conditionNodes.length > 0,
    conditionNodeCount: conditionNodes.length,
    conditionSamples: conditionNodes.slice(0, 3).map(e => (e.textContent || '').trim().slice(0, 40)),
    controlTotal: controls.length,
    lockedControls: controls.filter(c => c.lock),
    disabledControls: controls.filter(c => c.disabled),
    lockedButEnabled: controls.filter(c => c.lock && !c.disabled),
    disabledNoLock: controls.filter(c => c.disabled && !c.lock),
  };
};

const browser = await chromium.launch();
let ctx;
if (FREE) {
  ctx = await freeContext(browser);
} else {
  ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} });
}
const page = await ctx.newPage();
page.on('pageerror', () => {});

const out = [];
for (const route of ['/alerts', '/settings']) {
  try {
    await page.goto(`${BASE}${route}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });

    /* Do NOT use a fixed sleep here. At 6000ms /settings still rendered the
       signed-out shell, so --free reported "session did not take" on a session
       that had taken perfectly well — the same too-short-sleep failure that
       hid /correlation's heatmap from token-surfaces.mjs. Wait for the actual
       condition: auth resolved, and the DOM stopped growing. */
    if (FREE) {
      await page.waitForFunction(
        () => /sign out|log out/i.test(document.body.innerText || ''),
        { timeout: 45000 },
      ).catch(() => {});
    }

    /* Wait for CONTENT, not for stillness. `/settings` renders a "Loading…"
       placeholder inside the full app shell for 4-9s while useSettings()
       resolves, and that placeholder is a perfectly stable DOM — so a
       node-count settle check returns happily and the sweep measures the
       loading state. That produced three separate zero-result readings here:
       "no locked controls", "session did not take", and "no sections at all",
       none of which were true. The gated chips are the thing being scored, so
       wait for the section titles that contain them. */
    if (route === '/settings') {
      await page.waitForFunction(
        () => document.querySelectorAll('.st-section-title').length > 0,
        { timeout: 60000 },
      ).catch(() => {});
    }
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('body *').length;
      const s = (window.__lhqSettle ||= { last: -1, stable: 0 });
      s.stable = n === s.last ? s.stable + 1 : 0;
      s.last = n;
      return n > 0 && s.stable >= 2;
    }, { timeout: 40000, polling: 1200 }).catch(() => {});

    const rec = await page.evaluate(PAGE_EVAL);
    /* OnboardingGate blocks every route for a signed-in user whose profile is
       incomplete, and Render's cold start serves a placeholder. Both look like
       "no gated chips found", which is the same INCONCLUSIVE this flag exists
       to resolve — so assert the app rendered rather than trusting it. */
    if (FREE && rec.signedOut) rec.error = 'still signed out after seeding a session — session did not take';
    if (FREE) rec.authConfirmed = await page.evaluate(() => /sign out|log out/i.test(document.body.innerText || ''));
    if (FREE && rec.controlTotal === 0) rec.error = 'no controls rendered — onboarding gate or cold start, not a real zero';
    out.push(rec);
  } catch (e) {
    out.push({ path: route, error: String(e.message || e).slice(0, 90) });
  }
}
await ctx.close();
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, results: out }, null, 2)); process.exit(0); }

const alerts = out.find(r => r.path === '/alerts') || {};
const settings = out.find(r => r.path === '/settings') || {};

console.log(`base ${BASE}\n`);

console.log('--- /alerts: Alert Conditions must be ABSENT for non-entitled ---');
if (alerts.error) console.log(`  ERROR ${alerts.error}`);
else {
  console.log(`  signed out ............ ${alerts.signedOut}`);
  console.log(`  "alert condition" nodes ${alerts.conditionNodeCount}`);
  console.log(`  VERDICT ............... ${alerts.conditionsPresent ? 'FAIL — present, should be absent' : 'PASS — absent'}`);
  if (alerts.conditionsPresent) alerts.conditionSamples.forEach(s => console.log(`    ${s}`));
}

console.log('\n--- /settings: gated chips need disabled AND lock glyph ---');
if (settings.error) console.log(`  ERROR ${settings.error}`);
else {
  console.log(`  signed out ............ ${settings.signedOut}`);
  console.log(`  visible controls ...... ${settings.controlTotal}`);
  console.log(`  with lock ............. ${settings.lockedControls.length}`);
  console.log(`  disabled .............. ${settings.disabledControls.length}`);
  console.log(`  locked but ENABLED .... ${settings.lockedButEnabled.length}  <- leaks: clickable/focusable`);
  settings.lockedButEnabled.forEach(c => console.log(`    ${c.tag}.${c.cls} "${c.text}"`));
  const verdict = settings.lockedControls.length === 0
    ? (FREE
        ? 'FAIL — signed-in free user sees no locked controls; the gate is not rendering'
        : 'INCONCLUSIVE — no locked controls found; signed-out renders no gated chips at all. Re-run with --free.')
    : settings.lockedButEnabled.length === 0 ? 'PASS — every locked control is also disabled'
    : 'FAIL — locked controls that are not disabled';
  console.log(`  VERDICT ............... ${verdict}`);
}

console.log(FREE
  ? '\nRan as the seeded FREE-tier fixture (E2E_USER_B, role=free, trial_ends_at NULL) —\nthe state the criterion is actually about. Desktop only; other tiers not covered.'
  : '\nNote: signed-out is a PROXY for non-entitled, and on /settings a useless one —\nit renders no gated chips at all, so the criterion is never exercised.\nRe-run with --free to score it.');
