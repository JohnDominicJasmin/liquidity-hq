#!/usr/bin/env node
/* Audits every converted route across desktop/mobile and dark/light in one run.
 *
 * The unit of "done" on this project is the whole platform, not a screen, so a
 * per-route script that has to be invoked 31 times four ways is the wrong tool.
 * This walks CONVERTED_ROUTES and prints one table.
 *
 * Usage:
 *   node qa/platform-audit.mjs [--base <url>] [--routes /a,/b] [--json]
 *   node qa/platform-audit.mjs --viewports desktop,mobile --themes dark,light
 *
 * Reuses one browser and one context per (viewport, theme) pair rather than per
 * route — 31 routes x 4 combinations is 124 page loads, and a fresh context each
 * time triples the wall clock for no isolation benefit here.
 */

import { chromium, devices } from '@playwright/test';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const BASE = (arg('--base', 'https://liquidity-hq-qa.onrender.com')).replace(/\/$/, '');
const VIEWPORTS = arg('--viewports', 'desktop,mobile').split(',');
const THEMES = arg('--themes', 'dark,light').split(',');
const JSON_OUT = process.argv.includes('--json');

/* Kept in step with qa/e2e/_design-tokens.ts. /correlation is included even
   though it has no design frame yet — it is a converted route, so it is in
   scope for token/contrast/overflow checks even while geometry is unspecced. */
const DEFAULT_ROUTES = [
  '/', '/dashboard', '/arena', '/briefing', '/markets', '/scanner', '/journal',
  '/alerts', '/news', '/liq', '/funding', '/correlation', '/calc', '/playbook',
  '/hours', '/research', '/econ-calendar', '/settings', '/upgrade',
  '/about', '/learn', '/privacy', '/terms', '/refund', '/faq', '/disclaimer',
  '/login', '/forgot-password', '/reset-password', '/offline',
];
const ROUTES = arg('--routes', '') ? arg('--routes', '').split(',') : DEFAULT_ROUTES;

/* Dark terminal palette: the 15 documented tokens plus --amber (#542). */
const DARK = ['#08090a','#141517','#111416','#1f2225','#131618','#16191b',
  '#e8e9ea','#8b8f94','#7c828a','#3a3f45','#d9a626','#3fb950','#f0524d',
  '#22262a','#5e646b','#fbbf24'];
/* Light terminal palette, transcribed from specs/light-theme-tokens.md.
 * Three of these are NOT the dark value and were wrong in the first version of
 * this file: --amber #9a6a00, --mark-idle #d1cec9, --border-input #75797e.
 * Scoring light against dark values inflates every off-palette count. */
const LIGHT = ['#f7f6f3','#ebe9e6','#e3e1dd','#d5d2cd','#dfdcd7','#e2dfda',
  '#15181b','#585c61','#6a6e73','#aeaaa4','#8a5c00','#1a7f37','#cf222e',
  '#9a6a00','#d1cec9','#75797e'];

const VIEWPORT_CFG = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
};

const PAGE_EVAL = ({ tokens, radiusExempt }) => {
  const TOK = Object.fromEntries(tokens.map(t => [t, 1]));
  /* Same 0-1 vs 0-255 scaling as parse(): a `color(srgb ...)` declaration
     hexes to near-black without it, which is how 50 correctly-coloured
     ticker cells were reported as 1.04:1 failures. */
  const hex = c => { const m=(c.match(/[\d.]+/g)||[]).map(Number); if(m.length<3)return null; if(m.length>3&&m[3]===0)return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return '#'+m.slice(0,3).map(v=>Math.round(v*k).toString(16).padStart(2,'0')).join(''); };
  /* `color(srgb r g b / a)` channels are 0-1; `rgb()`/`rgba()` are 0-255. Scaling by prefix, not by value range - a real rgb(0 1 2) must not be rescaled. Without this every translucent modern-syntax colour composites to near-black: it read the landing ticker's 80%-alpha change values as 1.04:1 when they are 3.96:1. */
  const parse = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return { r: m[0]*k, g: m[1]*k, b: m[2]*k, a: m.length > 3 ? m[3] : 1 }; };
  const over = (f,b) => ({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  const cr = (a,b) => { const l1=lum(a),l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  const bgOf = el => { const L=[]; let p=el;
    while(p){const c=parse(getComputedStyle(p).backgroundColor); if(c&&c.a>0){L.push(c); if(c.a===1)break;} p=p.parentElement;}
    let base=L.length&&L[L.length-1].a===1?L.pop():{r:0,g:0,b:0,a:1};
    for(let i=L.length-1;i>=0;i--) base=over(L[i],base); return base; };

  /* Shell chrome sits permanently in the DOM offscreen at full width; counting
     it attributes shell-wide colours to whichever route is being measured. */
  const isChrome = el => !!el.closest('.nav-menu, .gchat-panel, .app-bar, .nav-drawer, .pf-footer, .mobile-tab-bar');

  const off = {}, radius = {}; let contrastFails = 0, subMin = 0, empties = 0, scanned = 0;
  const worstContrast = [];
  const BAD = /^(—|-|–|N\/A|--|NaN|null|undefined|CANNOT MEASURE)$/;

  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (isChrome(el)) return;
    scanned++;
    const s = getComputedStyle(el);

    ['color','backgroundColor','borderTopColor'].forEach(p => {
      const h = hex(s[p]); if (h && !TOK[h]) off[h] = (off[h]||0)+1;
    });

    if (s.borderRadius && s.borderRadius !== '0px') {
      /* radius-ruling.md: circular indicator glyphs <=24px legitimately compute
         50% — status dots, coin/avatar markers, toggle thumbs, step circles. */
      const circular = s.borderRadius.includes('50%') && r.width <= radiusExempt && Math.abs(r.width - r.height) <= 2;
      if (!circular) {
        const k = (el.className||'').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase();
        radius[k] = (radius[k]||0)+1;
      }
    }

    if (!el.children.length) {
      const t = (el.textContent||'').trim();
      if (t && t.length < 60) {
        const px = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700;
        const need = (px>=24 || (px>=18.66&&bold)) ? 3 : 4.5;
        const fg = parse(s.color);
        if (fg) { const bg = bgOf(el); const ratio = cr(over(fg,bg), bg);
          if (ratio < need) { contrastFails++; if (worstContrast.length < 4) worstContrast.push({ t: t.slice(0,20), ratio:+ratio.toFixed(2), px:s.fontSize }); } }
        if (BAD.test(t)) empties++;
      }
    }
    if (/^(BUTTON|A|INPUT|SELECT)$/.test(el.tagName) && (r.width < 24 || r.height < 24)) subMin++;
  });

  return {
    scanned,
    overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offDistinct: Object.keys(off).length,
    offTop: Object.entries(off).sort((a,b)=>b[1]-a[1]).slice(0,4),
    radiusTotal: Object.values(radius).reduce((a,c)=>a+c,0),
    radiusTop: Object.entries(radius).sort((a,b)=>b[1]-a[1]).slice(0,3),
    contrastFails, worstContrast, subMin, empties,
  };
};

const browser = await chromium.launch();
const rows = [];

for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext(VIEWPORT_CFG[vp]);
    await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode','terminal'); } catch {} }, theme);
    const page = await ctx.newPage();
    page.on('pageerror', () => {});

    for (const route of ROUTES) {
      const url = BASE + route + (route.includes('?') ? '&' : '?') + 'design=terminal';
      let rec = { route, viewport: vp, theme, error: null };
      try {
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
        /* Dashboard double-mounts during the design-mode transition; wait for a
           single visible root rather than a fixed delay. */
        await page.waitForFunction(() => {
          const g = [...document.querySelectorAll('.dashboard-grid')];
          if (!g.length) return true;
          return g.filter(x => x.getBoundingClientRect().width > 0).length === 1;
        }, { timeout: 60000 }).catch(() => {});
        await page.waitForTimeout(4500);
        const data = await page.evaluate(PAGE_EVAL, { tokens: theme === 'light' ? LIGHT : DARK, radiusExempt: 24 });
        rec = { ...rec, ...data };
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 70);
      }
      rows.push(rec);
      if (!JSON_OUT) {
        const f = rec.error ? `ERROR ${rec.error}` :
          `ovf ${String(rec.overflow).padStart(4)}  off ${String(rec.offDistinct).padStart(3)}  rad ${String(rec.radiusTotal).padStart(3)}  contrast ${String(rec.contrastFails).padStart(3)}  <24px ${String(rec.subMin).padStart(2)}  empty ${String(rec.empties).padStart(2)}`;
        console.log(`${vp.padEnd(7)} ${theme.padEnd(5)} ${route.padEnd(18)} ${f}`);
      }
    }
    await ctx.close();
  }
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

const bad = rows.filter(r => !r.error);
const sum = k => bad.reduce((a, r) => a + (r[k] || 0), 0);
console.log('\n' + '='.repeat(78));
console.log(`routes ${ROUTES.length} x viewports ${VIEWPORTS.length} x themes ${THEMES.length} = ${rows.length} page loads`);
console.log(`errors ${rows.filter(r => r.error).length}`);
console.log(`overflowing            ${bad.filter(r => r.overflow > 0).length} of ${bad.length}`);
console.log(`with contrast failures ${bad.filter(r => r.contrastFails > 0).length}   (total ${sum('contrastFails')})`);
console.log(`with off-palette       ${bad.filter(r => r.offDistinct > 0).length}   (total distinct-instances ${sum('offDistinct')})`);
console.log(`with radius violations ${bad.filter(r => r.radiusTotal > 0).length}   (total ${sum('radiusTotal')}, circular <=24px exempt per radius-ruling.md)`);
console.log(`with sub-24px targets  ${bad.filter(r => r.subMin > 0).length}   (total ${sum('subMin')})`);
console.log(`with empty fields      ${bad.filter(r => r.empties > 0).length}   (total ${sum('empties')})`);
