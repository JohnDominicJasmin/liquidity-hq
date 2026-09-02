#!/usr/bin/env node
/* Measures the CANVAS and the LIVE PAGE with the same instrument, then diffs.
 *
 * WHY
 * `canvas-diff.mjs` compares label text, which finds absent and renamed things
 * but is blind to "present but built differently" — the bulk of the /dashboard
 * gap. And `spec-conformance.mjs` derived its expectations by reading the page,
 * so it could not fail.
 *
 * The canvases are plain inline-styled HTML. So load the canvas in the SAME
 * browser, walk its frame, and record the section sequence and geometry — then
 * do the identical walk on the live route and compare. Neither side's
 * expectations come from the other.
 *
 * WHAT IT COMPARES
 *   - the ordered sequence of horizontal bands in the frame (nav, ticker, …)
 *   - each band's height
 *   - the column split of the body (main width vs rail width)
 * Those are the things "mirror the canvas" most concretely means, and all three
 * are readable without knowing anything about the product.
 *
 * A LIMITATION FOUND BY RUNNING IT
 * The canvases are Handlebars-style TEMPLATES (`{{ cascadeHeadline }}`,
 * `{{ tk.sym }}`). Loaded from file:// without their data they only partially
 * render — on `Dashboard 2a` the nav and ticker lay out and the cascade band
 * and body collapse. So browser-measuring a canvas yields its SHELL, not its
 * full band sequence. Where the canvas does not render, fall back to reading
 * geometry out of the inline styles statically. Do not report a collapsed band
 * as a canvas that lacks the section.
 *
 * WHAT IT STILL CANNOT DO
 * Inner composition of a panel. Two screens can agree on every band height and
 * still show different content — so a clean result here means "the skeleton
 * matches", never "the screen matches". Stacked with canvas-diff.mjs (labels)
 * it covers considerably more than either alone, and still not everything.
 *
 * Usage:
 *   node qa/canvas-measure.mjs --route /dashboard
 */

import { chromium } from '@playwright/test';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const ROUTE = arg('--route', '/dashboard');
const JSON_OUT = process.argv.includes('--json');

const CANVAS = {
  '/dashboard': 'Dashboard 2a', '/arena': 'Arena 1a', '/': 'Landing 7a',
  '/alerts': 'Alerts', '/briefing': 'Briefing', '/calc': 'Calculator',
  '/econ-calendar': 'Economic Calendar', '/faq': 'FAQ', '/funding': 'Funding',
  '/journal': 'Journal', '/learn': 'Learn', '/liq': 'Liquidation Map',
  '/markets': 'Markets', '/news': 'News', '/offline': 'Offline',
  '/about': 'About', '/disclaimer': 'Disclaimer',
  '/research': 'Research', '/settings': 'Settings', '/scanner': 'Setup Scanner',
  '/playbook': 'Playbook', '/hours': 'Trading Hours', '/upgrade': 'Upgrade',
  '/privacy': 'Privacy', '/terms': 'Terms', '/refund': 'Refunds',
  '/login': 'Login - Forgot Password', '/reset-password': 'Reset Password',
};

const file = `design-handoff-dir/design_files/${CANVAS[ROUTE]}.dc.html`;
if (!CANVAS[ROUTE] || !existsSync(file)) { console.error(`no canvas mapped for ${ROUTE}`); process.exit(1); }

/* Walk a frame's direct children as horizontal bands. A band is a child that
   spans (near) the full width of its parent — nav, ticker, banner, body. */
const WALK = (rootSels) => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  /* Try selectors IN ORDER. querySelector with a comma list returns the first
     match in DOCUMENT order, which is always <body> when body is in the list —
     so the live walk kept returning the whole app shell. */
  let root = null;
  for (const sel of rootSels) { root = document.querySelector(sel); if (root) break; }
  if (!root) return { error: `no root matched ${rootSels.join(', ')}` };
  const rw = root.getBoundingClientRect().width;
  const label = el => {
    const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
    return t.slice(0, 34) || '(no text)';
  };
  const bands = [...root.children].filter(vis).map(el => {
    const r = el.getBoundingClientRect();
    return {
      h: Math.round(r.height),
      full: r.width >= rw * 0.92,
      label: label(el),
      cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
    };
  });
  /* the body band is the tall one; report its column split */
  const body = [...root.children].filter(vis).sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  const cols = body ? [...body.children].filter(vis).map(e => Math.round(e.getBoundingClientRect().width)) : [];
  return { rootWidth: Math.round(rw), bands, cols };
};

const browser = await chromium.launch();
/* Match the canvas frame width exactly — comparing a 1440 canvas against a
   1600 viewport makes every width differ for a reason that is not a defect. */
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1200 } });
await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', () => {});

/* ---- canvas ---- */
await page.goto('file:///' + resolve(file).replace(/\\/g, '/'), { waitUntil: 'domcontentloaded', timeout: 60000 });
await page.waitForTimeout(2500);
const canvas = await page.evaluate(() => {
  /* the desktop frame is the widest fixed-width box on the page */
  const boxes = [...document.querySelectorAll('div')].filter(e => {
    const s = e.getAttribute('style') || '';
    return /width:\s*1440px/.test(s) && /height:\s*\d+px/.test(s);
  });
  if (!boxes.length) return { error: 'no 1440px frame found in canvas' };
  /* The 1440 box may wrap a single flex column that actually holds the bands.
     Descend while there is exactly one child filling the box. */
  let f = boxes[0];
  for (let i = 0; i < 3; i++) {
    const kids = [...f.children].filter(e => e.getBoundingClientRect().height > 0);
    if (kids.length === 1 && kids[0].getBoundingClientRect().height > f.getBoundingClientRect().height * 0.9) f = kids[0];
    else break;
  }
  f.setAttribute('data-qa-frame', '1');
  return { ok: true, bandCount: [...f.children].length };
});
const canvasWalk = canvas.error ? canvas : await page.evaluate(WALK, ['[data-qa-frame]']);

/* ---- live ---- */
await page.goto(`${BASE}${ROUTE}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
await page.waitForTimeout(6000);
await page.waitForFunction(() => {
  const n = document.querySelectorAll('body *').length;
  const s = (window.__s ||= { last: -1, stable: 0 });
  s.stable = n === s.last ? s.stable + 1 : 0; s.last = n;
  return n > 0 && s.stable >= 3;
}, { timeout: 40000, polling: 1200 }).catch(() => {});
/* Walk the CONTENT root, not <body>. The shell's drawer, FAB, chat panel and
   consent bar are chrome that the canvas frame does not contain, and including
   them made the live side report 4 bands against the canvas's real sequence. */
const liveWalk = await page.evaluate(WALK, ['.dash-shell', '.dashboard-grid', 'main.app-content', 'main']);
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ route: ROUTE, canvas: canvasWalk, live: liveWalk }, null, 2)); process.exit(0); }

const show = (name, w) => {
  console.log(`\n### ${name}`);
  if (w.error) { console.log(`  ERROR ${w.error}`); return; }
  console.log(`  frame width ${w.rootWidth}`);
  w.bands.forEach((b, i) => console.log(`  ${String(i).padStart(2)}  h=${String(b.h).padStart(5)}  ${b.full ? 'full' : 'part'}  ${b.cls.slice(0, 22).padEnd(22)} ${b.label}`));
  if (w.cols.length) console.log(`  body columns: ${w.cols.join(' | ')}`);
};

console.log(`# ${ROUTE} — canvas vs live, measured with the same walk\n`);
show(`CANVAS  ${CANVAS[ROUTE]}.dc.html`, canvasWalk);
show('LIVE', liveWalk);

if (!canvasWalk.error && !liveWalk.error) {
  const cb = canvasWalk.bands.filter(b => b.full), lb = liveWalk.bands.filter(b => b.full);
  console.log(`\n### Band count — canvas ${cb.length}, live ${lb.length}`);
  const n = Math.max(cb.length, lb.length);
  for (let i = 0; i < n; i++) {
    const c = cb[i], l = lb[i];
    const d = (c && l) ? (c.h === l.h ? 'match' : `Δ${l.h - c.h}`) : 'MISSING';
    console.log(`  ${String(i).padStart(2)}  canvas ${c ? String(c.h).padStart(5) : '  —  '}  live ${l ? String(l.h).padStart(5) : '  —  '}  ${d}   ${c ? c.label.slice(0, 26) : ''}`);
  }
  console.log('\nBand heights matching does NOT mean the screen matches — panel');
  console.log('composition is not compared here. Use with canvas-diff.mjs, not instead of it.');
}
