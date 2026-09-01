#!/usr/bin/env node
/* Scores a route against its design-handoff acceptance criteria, on the
 * DEPLOYED build.
 *
 * WHY
 * The token sweeps answer "is it legible and on-palette". They do not answer
 * "is it the screen design specified" — order, presence, absence, and the
 * colour-is-data rules. `design-handoff-dir/specs/*.md` carries numbered
 * acceptance criteria per screen and nothing has been scoring them.
 *
 * TWO RULES THIS SCRIPT ENCODES
 *
 * 1. The `.dc.html` canvases beat the prose. Recorded three times in
 *    TERMINAL_REDESIGN_STATE.md §5 — where a spec sentence and its canvas
 *    disagreed, the canvas was right. So criterion 8's "every element computes
 *    border-radius: 0px" is scored against `specs/radius-ruling.md`, which
 *    resolved that contradiction: rectangular surfaces are 0; circular
 *    indicator glyphs <=24px legitimately keep 50%.
 *
 * 2. What cannot be measured live is reported UNVERIFIED, never passed.
 *    Criteria 4 and 5 depend on market state — which signal cards fired, and
 *    whether the read is bearish. A live page shows one arbitrary state, so
 *    "no violation observed" is not "the rule holds". Those need fixtures.
 *
 * Usage:
 *   node qa/spec-conformance.mjs [--route /dashboard] [--themes dark,light]
 *
 * Run with MSYS_NO_PATHCONV=1 in Git Bash.
 */

import { chromium } from '@playwright/test';
import { readFileSync, existsSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const ROUTE = arg('--route', '/dashboard');
const THEMES = arg('--themes', 'dark,light').split(',');
const JSON_OUT = process.argv.includes('--json');

const DARK = ['#08090a','#141517','#111416','#1f2225','#131618','#16191b','#e8e9ea','#8b8f94','#7c828a','#3a3f45','#d9a626','#3fb950','#f0524d','#22262a','#5e646b','#fbbf24'];
const LIGHT = ['#f7f6f3','#ebe9e6','#e3e1dd','#d5d2cd','#dfdcd7','#e2dfda','#15181b','#585c61','#5e6267','#aeaaa4','#754e00','#14702c','#9d1a23','#755100','#d1cec9','#75797e','#4f5257'];

const PAGE_EVAL = ({ tokens }) => {
  const TOK = Object.fromEntries(tokens.map(t => [t.toLowerCase(), 1]));
  const hex = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null; if (m.length > 3 && m[3] === 0) return null;
    return '#' + m.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); };
  const isChrome = el => !!el.closest('.nav-menu, .gchat-panel, .app-bar, .nav-drawer, .pf-footer, .mobile-tab-bar');
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const q = s => [...document.querySelectorAll(s)].filter(vis);
  const cs = getComputedStyle(document.documentElement);
  const tok = n => cs.getPropertyValue(n).trim().toLowerCase();

  /* C1/C2: presence and vertical order of the main column and rail.
     MATCH ON CONTENT, NOT CLASS. Two of the five main-column sections carry no
     class at all (Best Setup and the signal-card block are bare <div>s), so a
     selector-based check reports them MISSING and scores a passing layout as a
     failure. The first version of this file did exactly that. Section identity
     here is the text each one renders, read in DOM order from the real
     containers. */
  const orderOf = (containerSel, sigs) => {
    const c = q(containerSel)[0];
    if (!c) return { missing: sigs.map(s => s.name), inOrder: false, seen: [], note: `container ${containerSel} not found` };
    const kids = [...c.children].filter(vis).map(e => ({
      top: e.getBoundingClientRect().top,
      txt: (e.textContent || '').replace(/\s+/g, ' ').trim(),
    })).sort((a, b) => a.top - b.top);
    const hit = [], missing = [];
    let cursor = -1;
    for (const s of sigs) {
      let i = kids.findIndex((k, idx) => idx > cursor && s.re.test(k.txt));
      /* CO-LOCATED SECTIONS. The canvas puts Next events and Market conditions
         side by side in one split row, so both live inside a SINGLE child of
         .dash-main. Requiring each section in a strictly later child reported
         the second one MISSING while it was plainly on the page. Falling back
         to the current child preserves ordering between rows without demanding
         that sections which share a row occupy separate ones. */
      if (i === -1 && cursor >= 0 && kids[cursor] && s.re.test(kids[cursor].txt)) i = cursor;
      if (i === -1) { missing.push(s.name); continue; }
      hit.push(s.name); cursor = i;               // advancing cursor enforces ORDER
    }
    return { missing, inOrder: missing.length === 0, seen: hit, kids: kids.map(k => k.txt.slice(0, 34)) };
  };

  /* Section signatures are INJECTED from the canvas — see canvasSections()
     below. They are no longer written here by hand, because when they were,
     they were copied off the rendered page and the check could not fail. */
  const sig = n => ({ name: n, re: new RegExp(n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') });
  const SEC = window.__QA_SECTIONS || { main: [], rail: [] };
  const c1 = orderOf('.dash-main', SEC.main.map(sig));
  const c2 = orderOf('.dash-right', SEC.rail.map(sig));

  /* C3: no coin TABLE on this screen. */
  const tables = q('table').filter(t => /coin|symbol|price/i.test(t.textContent || ''));

  /* C6: grade badges must never compute --red. */
  const red = tok('--red');
  const badges = q('.csb2-health-badge, [class*="health-badge"], [class*="grade"]');
  const badgeRed = badges.filter(b => (hex(getComputedStyle(b).color) || '').toLowerCase() === red)
    .map(b => ({ text: (b.textContent || '').trim().slice(0, 6), color: getComputedStyle(b).color }));

  /* C7: cascade banner ABSENT, not hidden. Count nodes, do not trust display. */
  const cascade = [...document.querySelectorAll('[class*="cascade"]')];
  const cascadeHidden = cascade.filter(e => !vis(e)).length;

  /* C8: radius 0 on rectangular surfaces; circular glyphs <=24px exempt. */
  const radius = {};
  document.querySelectorAll('body *').forEach(el => {
    if (isChrome(el) || !vis(el)) return;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!s.borderRadius || s.borderRadius === '0px') return;
    const circular = s.borderRadius.includes('50%') && r.width <= 24 && Math.abs(r.width - r.height) <= 2;
    if (circular) return;
    const k = (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase();
    radius[k] = (radius[k] || 0) + 1;
  });

  /* C9: every colour from the palette.
     SKIP TRANSLUCENT LAYERS. A tint declared as `color-mix(... 4%, transparent)`
     computes to a near-zero RGB with a low alpha — reading its raw RGB reports
     "#010100 off-palette" for a surface that renders correctly once composited.
     That is the alpha trap already recorded for contrast, and the first version
     of this check walked into it: the grade-D/F badge tints and the FUTURES
     LEADING pill were all flagged on their raw RGB. Only opaque declarations
     are a palette claim; translucent ones are judged by the composited surface,
     which is `token-surfaces.mjs`'s job. */
  const alphaOf = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); return m.length > 3 ? m[3] : 1; };
  const off = {}, translucentSkipped = {};
  document.querySelectorAll('body *').forEach(el => {
    if (isChrome(el) || !vis(el)) return;
    const s = getComputedStyle(el);
    ['color', 'backgroundColor', 'borderTopColor'].forEach(p => {
      const raw = s[p];
      const h = (hex(raw) || '').toLowerCase();
      if (!h) return;
      if (alphaOf(raw) < 1) { if (!TOK[h]) translucentSkipped[h] = (translucentSkipped[h] || 0) + 1; return; }
      if (!TOK[h]) off[h] = (off[h] || 0) + 1;
    });
  });

  /* C4 context: how many signal cards render, and how many carry green/red.
     Reported as OBSERVATION, not a verdict — see header. */
  const green = tok('--green');
  const cards = q('.edge-card, [class*="signal-card"]');
  const cardsColoured = cards.filter(c => [...c.querySelectorAll('*')].some(e => {
    const h = (hex(getComputedStyle(e).color) || '').toLowerCase(); return h === green || h === red;
  })).length;

  return {
    c1, c2,
    c3_coinTables: tables.length,
    c6_badges: badges.length, c6_violations: badgeRed,
    c7_cascadeNodes: cascade.length, c7_cascadeHidden: cascadeHidden,
    c8_radius: Object.entries(radius).sort((a, b) => b[1] - a[1]).slice(0, 8), c8_total: Object.values(radius).reduce((a, c) => a + c, 0),
    c9_off: Object.entries(off).sort((a, b) => b[1] - a[1]).slice(0, 8), c9_distinct: Object.keys(off).length,
    c9_translucent: Object.entries(translucentSkipped).sort((a, b) => b[1] - a[1]).slice(0, 6),
    obs_cards: cards.length, obs_cardsColoured: cardsColoured,
  };
};

/* Pull the section names out of the ROUTE'S CANVAS. This is the whole point of
   the rewrite: the expected sections must come from the design, never from the
   page. If no canvas is mapped, the section checks are reported as UNVERIFIABLE
   rather than silently passing on page-derived strings. */
const CANVAS_FOR = {
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
function canvasSections(route) {
  const name = CANVAS_FOR[route];
  const file = name && `design-handoff-dir/design_files/${name}.dc.html`;
  if (!file || !existsSync(file)) return null;
  let src = readFileSync(file, 'utf8').replace(/<(script|style|helmet)[^>]*>[\s\S]*?<\/>/g, '');
  const cut = src.search(/>(2A|1A|7A)</); if (cut > 0) src = src.slice(cut);
  /* Section headers carry font-size:10px in these canvases — that is what makes
     them identifiable as headers rather than content. Splitting on tags and
     filtering by text shape does NOT work: it let sample data ("E 114,820",
     "▲ 1.42%") and chrome ("DISMISS ✕") through as section names, and the check
     then failed for the wrong reason. Match the STYLE, then the text. */
  const heads = [];
  const re = /<div[^>]*style="[^"]*font-size:\s*10px[^"]*"[^>]*>\s*([^<{][^<]{2,38}?)\s*</g;
  let m;
  while ((m = re.exec(src))) {
    const base = m[1].split('·')[0].trim();           // drop "· 14 Aug 11:42 UTC"
    if (base.length < 4 || base.length > 26) continue;
    if (!/[a-z]/.test(base)) continue;                // all-caps = chrome/CTA
    if (/[\d$₿▲▼→←✕%]/.test(base)) continue;          // sample data or glyph
    if (!heads.includes(base)) heads.push(base);
  }
  /* The file contains a mobile frame after the desktop one, which repeats
     sections under shortened names ("Best setup" for "Best setup today").
     Drop any header that is a strict prefix of one already found. */
  return heads.filter(h => !heads.some(o => o !== h && o.startsWith(h)));
}

const browser = await chromium.launch();
const out = {};
for (const theme of THEMES) {
  const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', () => {});
  await page.goto(`${BASE}${ROUTE}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await page.waitForFunction(() => {
    const g = [...document.querySelectorAll('.dashboard-grid')];
    return !g.length || g.filter(x => x.getBoundingClientRect().width > 0).length === 1;
  }, { timeout: 60000 }).catch(() => {});
  await page.waitForTimeout(5000);

  /* Route readiness must wait for DATA, not for DOM.
     Three versions of this gate failed in a row and each failure was subtler:
       1. no gate            -> the Perps card had not mounted
       2. child count >= 4   -> it had mounted at zero height
       3. VISIBLE count >= 4 -> it was visible but its text was still EMPTY
     The card is a skeleton until its fetch lands, so the DOM is complete and
     still while the page says nothing. Scoring content criteria then reads a
     data-less page: C2 called a present card missing, and C4 counted 1 of 6
     signal cards coloured because none had values yet. Wait for the rail to
     actually say something. */
  const READY = {
    '/dashboard': () => {
      const kids = [...document.querySelectorAll('.dash-right > *')]
        .filter(e => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0; });
      if (kids.length < 4) return false;
      const said = kids.filter(e => (e.textContent || '').replace(/\s+/g, '').length > 8).length;
      const pulse = kids.some(e => /BTC\.D\s*\d/i.test((e.textContent || '').replace(/\s+/g, ' ')));
      return said >= 4 && pulse;          // every rail card has content, and it is real
    },
  };
  if (READY[ROUTE]) await page.waitForFunction(READY[ROUTE], { timeout: 90000 }).catch(() => {});

  await page.waitForFunction(() => {
    const n = document.querySelectorAll('body *').length;
    const s = (window.__lhqSettle ||= { last: -1, stable: 0 });
    s.stable = n === s.last ? s.stable + 1 : 0; s.last = n;
    return n > 0 && s.stable >= 3;
  }, { timeout: 40000, polling: 1200 }).catch(() => {});
  const heads = canvasSections(ROUTE);
  await page.evaluate(h => { window.__QA_SECTIONS = h; }, heads
    ? { main: heads.slice(0, 5), rail: heads.slice(5, 9) }
    : { main: [], rail: [] });
  out[theme] = await page.evaluate(PAGE_EVAL, { tokens: theme === 'light' ? LIGHT : DARK });
  out[theme].canvasSourced = !!heads;
  await ctx.close();
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, route: ROUTE, out }, null, 2)); process.exit(0); }

const V = (ok, s) => `${ok ? 'PASS' : 'FAIL'}  ${s}`;
for (const theme of THEMES) {
  const r = out[theme];
  console.log(`\n## ${ROUTE} vs specs/dashboard-2a.md — ${theme}\n`);
  if (!r.canvasSourced) console.log('UNVERIFIABLE  C1/C2 — no canvas mapped for this route; section checks NOT run (they are not passing)');
  else console.log(V(r.c1.missing.length === 0 && r.c1.inOrder, `C1 main column order [canvas-sourced] — ${r.c1.seen.length}/${r.c1.seen.length + r.c1.missing.length}${r.c1.missing.length ? `, MISSING ${r.c1.missing.join(', ')}` : ''}`));
  if (r.canvasSourced) console.log(V(r.c2.missing.length === 0 && r.c2.inOrder, `C2 rail [canvas-sourced] — ${r.c2.seen.length}/${r.c2.seen.length + r.c2.missing.length}${r.c2.missing.length ? `, MISSING ${r.c2.missing.join(', ')}` : ''}`));
  console.log(V(r.c3_coinTables === 0, `C3 no coin table — ${r.c3_coinTables} found`));
  console.log(`UNVERIFIED  C4 only fired cards compute green/red — ${r.obs_cardsColoured} of ${r.obs_cards} cards carry a semantic colour; needs a fixture to know which fired`);
  console.log(`UNVERIFIED  C5 verdict colour follows a bearish read — needs a bearish fixture`);
  console.log(V(r.c6_violations.length === 0, `C6 grade badges never --red — ${r.c6_badges} badges, ${r.c6_violations.length} violations`));
  console.log(V(r.c7_cascadeNodes === 0, `C7 cascade absent — ${r.c7_cascadeNodes} nodes (${r.c7_cascadeHidden} merely hidden)`));
  console.log(V(r.c8_total === 0, `C8 radius 0 (circular <=24px exempt per radius-ruling.md) — ${r.c8_total} violations`));
  if (r.c8_total) console.log(`      ${r.c8_radius.map(([k, v]) => `${k}x${v}`).join('  ')}`);
  console.log(V(r.c9_distinct === 0, `C9 palette only — ${r.c9_distinct} off-palette colours`));
  if (r.c9_distinct) console.log(`      ${r.c9_off.map(([k, v]) => `${k}x${v}`).join('  ')}`);
  if (r.c9_translucent && r.c9_translucent.length) console.log(`      (skipped, translucent - judged by composited surface not raw RGB: ${r.c9_translucent.map(([k, v]) => `${k}x${v}`).join('  ')})`);
}
console.log('\nC4 and C5 are market-state dependent: a live page shows one arbitrary state,');
console.log('so "no violation observed" is not "the rule holds". Both need fixtures.');
