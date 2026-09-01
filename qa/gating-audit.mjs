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

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const JSON_OUT = process.argv.includes('--json');

const PAGE_EVAL = () => {
  const LOCK = /[\u{1F512}\u{1F510}]|\block(ed)?\b/iu;
  const txt = document.body.innerText || '';

  /* Leaf nodes only — an ancestor containing the phrase would count the whole
     subtree and report presence where there is none. */
  const leaves = [...document.querySelectorAll('*')].filter(e => !e.children.length);
  const visible = e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; };

  const conditionNodes = leaves.filter(e => /alert condition/i.test(e.textContent || ''));

  const controls = [...document.querySelectorAll('button,[role="radio"],[role="tab"],[class*="chip"],input,select')]
    .filter(visible)
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
    signedOut: /\b(sign in|log in|sign up|create account)\b/i.test(txt),
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
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', () => {});

const out = [];
for (const route of ['/alerts', '/settings']) {
  try {
    await page.goto(`${BASE}${route}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);
    out.push(await page.evaluate(PAGE_EVAL));
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
    ? 'INCONCLUSIVE — no locked controls found; signed-out may render no gated chips at all'
    : settings.lockedButEnabled.length === 0 ? 'PASS — every locked control is also disabled'
    : 'FAIL — locked controls that are not disabled';
  console.log(`  VERDICT ............... ${verdict}`);
}

console.log('\nNote: signed-out is a PROXY for non-entitled. A signed-in free account is');
console.log('not covered by this run and is not scored by it.');
