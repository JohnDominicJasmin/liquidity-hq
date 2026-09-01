#!/usr/bin/env node
/* Measures one route at a mobile viewport and prints a conformance read.
 *
 * Exists because `resize_window` in the browser-automation path reports success
 * and does not resize — three attempts, `window.innerWidth` unchanged each time
 * — so mobile could not be audited at all. This is deliberately NOT the E2E
 * suite: it is a single page load per route/theme, enough to answer
 * "does this screen work at 390px" without running 48 specs.
 *
 * Usage:
 *   node qa/mobile-audit.mjs <url> [--theme dark|light] [--width 390]
 *
 * Reads, per route:
 *   - horizontal overflow (the classic mobile break)
 *   - off-palette colours, scoped to the page's own roots not shell chrome
 *   - non-zero border-radius, same scoping
 *   - contrast failures with proper alpha compositing
 *   - controls below the 24x24 target minimum
 *   - empty/placeholder data fields
 */

import { chromium, devices } from '@playwright/test';

const url = process.argv[2];
if (!url) { console.error('usage: node qa/mobile-audit.mjs <url> [--theme dark|light]'); process.exit(1); }
const theme = (process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'dark');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 390);

/* The 16 governed terminal tokens (15 documented + --amber, confirmed on #542). */
const TOKENS = [
  '#08090a', '#141517', '#111416', '#1f2225', '#131618', '#16191b',
  '#e8e9ea', '#8b8f94', '#7c828a', '#3a3f45',
  '#d9a626', '#3fb950', '#f0524d', '#22262a', '#5e646b', '#fbbf24',
];

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 844 } });
const page = await ctx.newPage();

await page.addInitScript(t => {
  try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {}
}, theme);

await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

/* The Dashboard mounts two .dashboard-grid trees during the design-mode
   transition — the real one plus a 0x0 phantom with placeholder rows. Measuring
   mid-transition double-counts everything, so wait for a single visible root
   rather than a fixed delay. */
await page.waitForFunction(() => {
  const g = [...document.querySelectorAll('.dashboard-grid')];
  if (!g.length) return true;                       // not the dashboard
  return g.filter(x => x.getBoundingClientRect().width > 0).length === 1;
}, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(6000);

const result = await page.evaluate(TOKENS => {
  const TOK = Object.fromEntries(TOKENS.map(t => [t, 1]));
  const hex = c => {
    const m = (c.match(/[\d.]+/g) || []).map(Number);
    if (m.length < 3) return null;
    if (m.length > 3 && m[3] === 0) return null;
    return '#' + m.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  };
  const parse = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); return m.length ? { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } : null; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  /* Composite every translucent layer down to an opaque base — reading the first
     non-transparent ancestor as opaque produced 20 false contrast failures once. */
  const bgOf = el => {
    const L = []; let p = el;
    while (p) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { L.push(c); if (c.a === 1) break; } p = p.parentElement; }
    let base = L.length && L[L.length - 1].a === 1 ? L.pop() : { r: 0, g: 0, b: 0, a: 1 };
    for (let i = L.length - 1; i >= 0; i--) base = over(L[i], base);
    return base;
  };

  /* Scope to the page's own content. The nav drawer and chat panel sit
     permanently in the DOM at full size offscreen; counting them attributes
     shell-wide colours to whichever screen is being audited. */
  const roots = [...document.querySelectorAll('.dash-main, .dash-right, main, [class*="-term-wrap"]')]
    .filter(r => r.getBoundingClientRect().width > 0);
  const scope = roots.length ? roots : [document.body];

  const off = {}, radius = {}, contrast = [], small = [], empty = [];
  const BAD = /^(—|-|–|N\/A|--|NaN|null|undefined|CANNOT MEASURE)$/;
  const seen = new Set();

  scope.forEach(root => root.querySelectorAll('*').forEach(el => {
    if (seen.has(el)) return; seen.add(el);
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    const s = getComputedStyle(el);
    if (el.closest('.nav-menu, .gchat-panel, .app-bar')) return;

    ['color', 'backgroundColor', 'borderTopColor'].forEach(p => {
      const h = hex(s[p]); if (h && !TOK[h]) off[h] = (off[h] || 0) + 1;
    });
    if (s.borderRadius && s.borderRadius !== '0px') {
      const k = (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase();
      radius[k] = (radius[k] || 0) + 1;
    }
    if (!el.children.length) {
      const t = (el.textContent || '').trim();
      if (t && t.length < 60) {
        const px = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700;
        const need = (px >= 24 || (px >= 18.66 && bold)) ? 3 : 4.5;
        const fg = parse(s.color);
        if (fg) { const bg = bgOf(el); const ratio = cr(over(fg, bg), bg); if (ratio < need) contrast.push({ t: t.slice(0, 24), px: s.fontSize, ratio: +ratio.toFixed(2), need }); }
        if (BAD.test(t)) empty.push(t);
      }
    }
    if (/^(BUTTON|A|INPUT|SELECT)$/.test(el.tagName) && (r.width < 24 || r.height < 24)) {
      small.push({ t: (el.textContent || '').trim().slice(0, 16), w: Math.round(r.width), h: Math.round(r.height) });
    }
  }));

  return {
    viewport: innerWidth + 'x' + innerHeight,
    theme: document.documentElement.getAttribute('data-theme'),
    design: document.documentElement.getAttribute('data-design'),
    horizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    offPalette: Object.entries(off).sort((a, b) => b[1] - a[1]).slice(0, 10),
    offPaletteDistinct: Object.keys(off).length,
    radiusTotal: Object.values(radius).reduce((a, c) => a + c, 0),
    radiusTop: Object.entries(radius).sort((a, b) => b[1] - a[1]).slice(0, 6),
    contrastFailures: contrast.slice(0, 10),
    contrastFailureCount: contrast.length,
    subMinTargets: small.slice(0, 8),
    subMinCount: small.length,
    emptyFields: [...new Set(empty)].slice(0, 8),
  };
}, TOKENS);

console.log(JSON.stringify({ url, requestedTheme: theme, ...result }, null, 2));
await browser.close();
