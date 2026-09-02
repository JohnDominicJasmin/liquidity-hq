#!/usr/bin/env node
/* Opens the dialogs/overlays reachable from a route and measures contrast
 * INSIDE them, in both themes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every sweep so far measures the page as loaded. A dialog that is closed is
 * either absent from the DOM or zero-sized, so it is skipped — which means the
 * whole modal surface of the product has never been contrast-checked, in either
 * theme. The owner's definition of "done" includes dialogs explicitly, and this
 * was the honest gap in claiming /dashboard finished.
 *
 * TRIGGERS ARE AN ALLOW-LIST, NOT A CRAWL
 * A generic "click every button and see what opens" is how an audit script
 * sends a Telegram alert, deletes a journal row, or starts a checkout. Every
 * trigger here is named and known non-destructive: it opens a panel or an
 * informational overlay and nothing else. Adding one is a deliberate act.
 *
 * The shell chrome exclusion the other sweeps use is deliberately NOT applied
 * here — .gchat-panel and .nav-drawer ARE the surfaces under test.
 *
 * Usage:
 *   node qa/dialog-audit.mjs [--route /dashboard] [--themes dark,light]
 *   node qa/dialog-audit.mjs --json
 *
 * Run with MSYS_NO_PATHCONV=1 in Git Bash or the route becomes a Windows path.
 */

import { chromium } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const ROUTE = arg('--route', '/dashboard');
const THEMES = arg('--themes', 'dark,light').split(',');
const JSON_OUT = process.argv.includes('--json');

/* name: what it is · open: selector to click · surface: what should appear
   Every one of these opens a view. None submits, sends, deletes or purchases. */
const TRIGGERS = [
  { name: 'Ask-AI panel',   open: '.gchat-fab',                    surface: '.gchat-panel' },
  { name: 'Nav drawer',     open: '[aria-label*="menu" i], .nav-toggle, .app-bar-menu', surface: '.nav-drawer' },
  { name: 'Coin selector',  open: '.coin-multi-select-trigger, [class*="multi-select"] button', surface: '[class*="multi-select"] [role="listbox"], .cms-panel' },
];

const PAGE_EVAL = (rootSel) => {
  /* `color(srgb r g b / a)` channels are 0-1; `rgb()`/`rgba()` are 0-255. Scaling by prefix, not by value range - a real rgb(0 1 2) must not be rescaled. Without this every translucent modern-syntax colour composites to near-black: it read the landing ticker's 80%-alpha change values as 1.04:1 when they are 3.96:1. */
  const parse = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return { r: m[0]*k, g: m[1]*k, b: m[2]*k, a: m.length > 3 ? m[3] : 1 }; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
  const bgOf = el => {
    const L = []; let p = el;
    while (p) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { L.push(c); if (c.a === 1) break; } p = p.parentElement; }
    let base = L.length && L[L.length - 1].a === 1 ? L.pop() : { r: 0, g: 0, b: 0, a: 1 };
    for (let i = L.length - 1; i >= 0; i--) base = over(L[i], base);
    return base;
  };

  const root = document.querySelector(rootSel);
  if (!root) return { open: false };
  const rr = root.getBoundingClientRect();
  if (rr.width < 1 || rr.height < 1) return { open: false };

  const fails = [];
  let scanned = 0;
  root.querySelectorAll('*').forEach(el => {
    if (el.children.length) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    const t = (el.textContent || '').trim();
    if (!t || t.length > 60) return;
    scanned++;
    const s = getComputedStyle(el);
    const fg = parse(s.color); if (!fg) return;
    const bg = bgOf(el);
    const px = parseFloat(s.fontSize);
    const need = (px >= 24 || (px >= 18.66 && parseInt(s.fontWeight) >= 700)) ? 3 : 4.5;
    const ratio = cr(over(fg, bg), bg);
    if (ratio < need) fails.push({
      cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
      fg: hex(over(fg, bg)), bg: hex(bg), ratio: +ratio.toFixed(2), need, text: t.slice(0, 22),
    });
  });
  return { open: true, scanned, fails, size: `${Math.round(rr.width)}x${Math.round(rr.height)}` };
};

const browser = await chromium.launch();
const results = [];

for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  /* A dialog that opens a confirm() would freeze the run and every later
     measurement. None of the allow-listed triggers should, but assert it. */
  page.on('dialog', async d => { results.push({ theme, trigger: 'NATIVE DIALOG', error: d.message().slice(0, 80) }); await d.dismiss(); });

  await page.goto(`${BASE}${ROUTE}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForTimeout(5000);
  await page.waitForFunction(() => {
    const n = document.querySelectorAll('body *').length;
    const s = (window.__lhqSettle ||= { last: -1, stable: 0 });
    s.stable = n === s.last ? s.stable + 1 : 0; s.last = n;
    return n > 0 && s.stable >= 3;
  }, { timeout: 40000, polling: 1200 }).catch(() => {});

  for (const t of TRIGGERS) {
    let rec = { theme, trigger: t.name };
    try {
      const btn = await page.$(t.open);
      if (!btn) { rec.error = 'trigger not present on this route'; results.push(rec); continue; }
      await btn.click({ timeout: 5000 });
      await page.waitForTimeout(2500);
      const data = await page.evaluate(PAGE_EVAL, t.surface);
      rec = { ...rec, ...data };
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(800);
    } catch (e) {
      rec.error = String(e.message || e).split('\n')[0].slice(0, 70);
    }
    results.push(rec);
  }
  await ctx.close();
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, route: ROUTE, results }, null, 2)); process.exit(0); }

console.log(`\n## Dialog contrast — ${ROUTE}, terminal, ${THEMES.join(' + ')}\n`);
for (const r of results) {
  const head = `${r.theme.padEnd(5)} ${r.trigger.padEnd(16)}`;
  if (r.error) { console.log(`${head} — ${r.error}`); continue; }
  if (!r.open) { console.log(`${head} — did NOT open (surface absent or zero-size) — UNVERIFIED, not passing`); continue; }
  const n = r.fails.length;
  console.log(`${head} ${r.size.padEnd(10)} ${r.scanned} nodes  ${n === 0 ? 'clean' : `**${n} failing**`}`);
  for (const f of r.fails.slice(0, 6)) console.log(`      ${String(f.ratio).padEnd(5)} need ${f.need}  ${f.fg} on ${f.bg}  .${f.cls}  "${f.text}"`);
}
console.log('\nTriggers are an allow-list of non-destructive openers. A dialog not listed here');
console.log('is UNMEASURED, not passing — including anything behind a destructive control.');
