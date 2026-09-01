#!/usr/bin/env node
/* Names the interactive elements below the WCAG 2.2 minimum target size,
 * GROUPED BY COMPONENT rather than counted by instance.
 *
 * WHY GROUPED
 * -----------
 * `platform-audit.mjs` reports a number: 74 sub-24px targets across the
 * platform. A number cannot be acted on. It also systematically overstates —
 * a single wrong rule on a repeated component counts once per rendered
 * instance, which is how `/scanner`'s "392 empty fields" turned out to be 50
 * placeholder dashes and how a 24-row `/correlation` finding read as 24
 * defects. Same class of element, same size, same route: one fix.
 *
 * WHAT THE THRESHOLD IS
 * WCAG 2.2 SC 2.5.8 Target Size (Minimum), AA: 24x24 CSS px. The exceptions
 * that matter here are applied rather than ignored:
 *   - SPACING: an undersized target passes if a 24px circle centred on it does
 *     not overlap another target's circle. Checked, not assumed — this is the
 *     exception that legitimately covers tight icon rows.
 *   - INLINE: a link inside a sentence is exempt. Detected by testing whether
 *     the element sits in a block of flowing text.
 * Not applied: user-agent default styling, and "essential" — neither is
 * determinable from the outside, so anything relying on them is reported and
 * flagged rather than silently passed.
 *
 * Usage:
 *   node qa/tap-targets.mjs [--base <url>] [--viewport mobile|desktop]
 *   node qa/tap-targets.mjs --routes /liq,/scanner --json
 *
 * Run with MSYS_NO_PATHCONV=1 in Git Bash or route paths become Windows paths.
 */

import { chromium, devices } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const VIEWPORT = arg('--viewport', 'mobile');
const THEME = arg('--theme', 'dark');
const JSON_OUT = process.argv.includes('--json');

const DEFAULT_ROUTES = [
  '/', '/dashboard', '/arena', '/briefing', '/markets', '/scanner', '/journal',
  '/alerts', '/news', '/liq', '/funding', '/correlation', '/calc', '/playbook',
  '/hours', '/research', '/econ-calendar', '/settings', '/upgrade',
  '/about', '/learn', '/privacy', '/terms', '/refund', '/faq', '/disclaimer',
  '/login', '/forgot-password', '/reset-password', '/offline',
];
const ROUTES = arg('--routes', '') ? arg('--routes', '').split(',') : DEFAULT_ROUTES;

const VIEWPORT_CFG = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
};

const MIN = 24;

const PAGE_EVAL = (min) => {
  const SEL = 'a[href],button,input,select,textarea,[role="button"],[role="link"],[role="tab"],[role="checkbox"],[role="radio"],[tabindex]:not([tabindex="-1"])';
  /* Shell chrome is permanently mounted offscreen at full size and would be
     attributed to whichever route is measured. */
  const isChrome = el => !!el.closest('.nav-menu, .gchat-panel, .app-bar, .nav-drawer, .pf-footer, .mobile-tab-bar');

  const all = [...document.querySelectorAll(SEL)].filter(el => {
    if (isChrome(el)) return false;
    if (el.disabled) return false;
    const s = getComputedStyle(el);
    if (s.visibility === 'hidden' || s.display === 'none' || s.pointerEvents === 'none') return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  });

  const boxes = all.map(el => { const r = el.getBoundingClientRect(); return { el, r }; });

  /* SC 2.5.8 spacing exception: undersized is acceptable when a `min`-diameter
     circle centred on the target overlaps no other target's circle. */
  const spacingOK = (b) => {
    const cx = b.r.left + b.r.width / 2, cy = b.r.top + b.r.height / 2;
    return !boxes.some(o => {
      if (o.el === b.el) return false;
      const ox = o.r.left + o.r.width / 2, oy = o.r.top + o.r.height / 2;
      return Math.hypot(cx - ox, cy - oy) < min;
    });
  };

  /* SC 2.5.8 inline exception: a target in a sentence of flowing text. */
  const isInline = el => {
    const p = el.parentElement;
    if (!p) return false;
    if (getComputedStyle(el).display !== 'inline') return false;
    const own = (el.textContent || '').trim().length;
    const parent = (p.textContent || '').trim().length;
    return own > 0 && parent > own + 20;   // meaningfully more text around it
  };

  const out = [];
  for (const b of boxes) {
    const { el, r } = b;
    if (r.width >= min && r.height >= min) continue;
    const inline = isInline(el);
    const spaced = spacingOK(b);
    out.push({
      cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
      tag: el.tagName.toLowerCase(),
      w: Math.round(r.width), h: Math.round(r.height),
      text: (el.textContent || '').trim().slice(0, 24),
      label: el.getAttribute('aria-label') || el.getAttribute('title') || '',
      inline, spaced,
      exempt: inline || spaced,
    });
  }
  return { total: all.length, findings: out };
};

const browser = await chromium.launch();
const ctx = await browser.newContext(VIEWPORT_CFG[VIEWPORT]);
await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, THEME);
const page = await ctx.newPage();
page.on('pageerror', () => {});

/* key: `${cls}|${w}x${h}` — one entry per component shape, not per instance */
const groups = new Map();
const errors = [];
let scanned = 0;

for (const route of ROUTES) {
  try {
    await page.goto(`${BASE}${route}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(5000);
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('body *').length;
      const s = (window.__lhqSettle ||= { last: -1, stable: 0 });
      s.stable = n === s.last ? s.stable + 1 : 0;
      s.last = n;
      return n > 0 && s.stable >= 3;
    }, { timeout: 40000, polling: 1200 }).catch(() => {});

    const { total, findings } = await page.evaluate(PAGE_EVAL, MIN);
    scanned += total;
    for (const f of findings) {
      const key = `${f.cls}|${f.w}x${f.h}`;
      const g = groups.get(key) || { ...f, count: 0, routes: new Set() };
      g.count++; g.routes.add(route);
      /* An instance is exempt only if EVERY instance is. One crowded instance
         means the component needs the fix. */
      g.spaced = g.spaced && f.spaced;
      g.exempt = g.inline || g.spaced;
      groups.set(key, g);
    }
    if (!JSON_OUT) process.stderr.write(`  ${route}\n`);
  } catch (e) {
    errors.push({ route, error: String(e.message || e).slice(0, 70) });
  }
}
await ctx.close();
await browser.close();

const all = [...groups.values()].map(g => ({ ...g, routes: [...g.routes].sort() }))
  .sort((a, b) => (a.w * a.h) - (b.w * b.h));
const real = all.filter(g => !g.exempt);

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, viewport: VIEWPORT, theme: THEME, scanned, errors, groups: all }, null, 2)); process.exit(0); }

const esc = s => String(s).replace(/\|/g, '\\|');
console.log(`\n## Sub-${MIN}px tap targets — ${VIEWPORT}, ${THEME}, ${ROUTES.length} routes\n`);
console.log(`WCAG 2.2 SC 2.5.8 (AA). ${scanned} interactive elements scanned.\n`);
console.log(`**${real.length} component${real.length === 1 ? '' : 's'} need a fix**, across ${real.reduce((a, g) => a + g.count, 0)} rendered instances.`);
console.log(`${all.length - real.length} more are undersized but exempt (inline text, or spacing-exception satisfied).\n`);

if (real.length) {
  console.log('| component | size | instances | routes | example |');
  console.log('|---|---|---|---|---|');
  for (const g of real) {
    const where = g.routes.length > 3 ? `${g.routes.slice(0, 3).join(', ')} +${g.routes.length - 3}` : g.routes.join(', ');
    console.log(`| \`${esc(g.cls)}\` (${g.tag}) | ${g.w}x${g.h} | ${g.count} | ${esc(where)} | ${esc(g.text || g.label || '—')} |`);
  }
}

const exempt = all.filter(g => g.exempt);
if (exempt.length) {
  console.log(`\n<details><summary>${exempt.length} exempt under SC 2.5.8 — listed so the exemption is auditable, not assumed</summary>\n`);
  console.log('| component | size | why exempt | routes |');
  console.log('|---|---|---|---|');
  for (const g of exempt) {
    console.log(`| \`${esc(g.cls)}\` | ${g.w}x${g.h} | ${g.inline ? 'inline in text' : 'spacing exception'} | ${esc(g.routes.slice(0, 3).join(', '))} |`);
  }
  console.log('\n</details>');
}

if (errors.length) {
  console.log(`\n> Routes that did not load (${errors.length}) — absent from the data above, not passing:`);
  for (const e of errors) console.log(`> \`${e.route}\` — ${esc(e.error)}`);
}
