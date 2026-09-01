#!/usr/bin/env node
/* Names the elements that push a page wider than the viewport.
 *
 * `horizontalOverflow: true` from qa/mobile-audit.mjs says a page breaks at
 * 390px but not what breaks it. This walks the tree and reports every element
 * whose right edge crosses the viewport, keeping only the outermost offender in
 * each branch — a single wide child reports its whole ancestor chain otherwise,
 * which buries the actual cause.
 *
 * Usage: node qa/mobile-overflow.mjs <url> [--theme dark|light] [--width 390]
 */

import { chromium, devices } from '@playwright/test';

const url = process.argv[2];
if (!url) { console.error('usage: node qa/mobile-overflow.mjs <url> [--theme dark|light]'); process.exit(1); }
const theme = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'dark';
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 390);

const browser = await chromium.launch();
const ctx = await browser.newContext({ ...devices['iPhone 13'], viewport: { width, height: 844 } });
const page = await ctx.newPage();
await page.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, theme);
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => {
  const g = [...document.querySelectorAll('.dashboard-grid')];
  if (!g.length) return true;
  return g.filter(x => x.getBoundingClientRect().width > 0).length === 1;
}, { timeout: 180000 }).catch(() => {});
await page.waitForTimeout(6000);

const out = await page.evaluate(vw => {
  const offenders = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (el.closest('.nav-menu, .gchat-panel')) return;   // offscreen shell, not the page
    if (r.right <= vw + 1 && r.left >= -1) return;
    offenders.push({ el, r });
  });
  /* Keep only the outermost offender per branch: if a parent already overflows,
     its children are consequences, not causes. */
  const outermost = offenders.filter(o => !offenders.some(p => p.el !== o.el && p.el.contains(o.el)));
  return {
    viewportWidth: vw,
    scrollWidth: document.documentElement.scrollWidth,
    overflowBy: document.documentElement.scrollWidth - vw,
    offenderCount: offenders.length,
    outermostCount: outermost.length,
    outermost: outermost.slice(0, 12).map(o => ({
      tag: o.el.tagName.toLowerCase(),
      cls: (o.el.className || '').toString().slice(0, 46),
      left: Math.round(o.r.left),
      right: Math.round(o.r.right),
      width: Math.round(o.r.width),
      overhang: Math.round(o.r.right - vw),
      text: (o.el.textContent || '').trim().replace(/\s+/g, ' ').slice(0, 34),
      whiteSpace: getComputedStyle(o.el).whiteSpace,
      overflowX: getComputedStyle(o.el).overflowX,
      minWidth: getComputedStyle(o.el).minWidth,
    })),
  };
}, width);

console.log(JSON.stringify({ url, theme, ...out }, null, 2));
await browser.close();
