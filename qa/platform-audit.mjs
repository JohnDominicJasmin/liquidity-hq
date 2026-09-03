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

import { readFileSync } from 'node:fs';
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

/* The governed palette is DERIVED from lib/terminalTokens.ts, not copied.
 *
 * It used to be two hand-written arrays, and by 2026-09-03 both had drifted
 * from the source of truth - the light one badly enough to INVERT the check:
 *
 *   still allowed, but no longer tokens   #6a6e73 #8a5c00 #1a7f37 #cf222e #9a6a00
 *   real tokens, reported as violations   --txt3 #5e6267  --accent #754e00
 *                                         --green #14702c --red #9d1a23
 *                                         --amber #755100 --fr-slight-long #7c5e2e
 *                                         --txt-dash #4f5257
 *
 * The first two of those stale values are the ones design REPLACED because
 * they failed AA - `--txt3` light #6a6e73 measured 3.93:1 on --bg2 and
 * `--green` light #1a7f37 measured 3.89:1. So the audit was passing the values
 * that fail and flagging the values that fixed them. A check that points the
 * wrong way is worse than no check: acting on its output means reverting a
 * correctness fix. The dark list had drifted less - two missing tokens
 * (--fr-slight-long, --txt-dash) and no stale extras - but by the same
 * mechanism.
 *
 * qa/mobile-audit.mjs already derives its palette for exactly this reason
 * (#641); this file was not updated with it. Same approach, same guards: a
 * copied list drifts, and a stale hex is invisible among live ones.
 *
 * terminalTokens.ts is a .ts module and this is a plain .mjs script with no
 * loader, so read and extract rather than import. The shapes below are pinned
 * to that file's actual declarations and throw loudly if it is restructured,
 * rather than silently yielding an empty palette and reporting every screen as
 * perfectly on-token. */
const tokenSrc = readFileSync(new URL('../lib/terminalTokens.ts', import.meta.url), 'utf8');

const mapOf = (name) => {
  const open = tokenSrc.indexOf('export const ' + name + ' = {');
  if (open === -1) throw new Error('platform-audit: no ' + name + ' in lib/terminalTokens.ts');
  const close = tokenSrc.indexOf('\n} as const;', open);
  if (close === -1) throw new Error('platform-audit: ' + name + ' has no closing "} as const;"');
  const hexes = tokenSrc.slice(open, close).match(/'(#[0-9a-fA-F]{6})'/g) || [];
  if (hexes.length < 10) throw new Error('platform-audit: ' + name + ' yielded ' + hexes.length + ' colours, expected >= 10');
  return hexes.map((h) => h.slice(1, -1).toLowerCase());
};
const rampHexes = (tokenSrc.match(/color:\s*'(#[0-9a-fA-F]{6})'/g) || [])
  .map((m) => m.slice(m.indexOf('#'), m.indexOf('#') + 7).toLowerCase());
const flatCell = (/export const TERMINAL_FLAT_CELL = '(#[0-9a-fA-F]{6})'/.exec(tokenSrc) || [])[1];

/* Mirrors TERMINAL_ALLOWED / TERMINAL_ALLOWED_LIGHT, same as mobile-audit:
   the magma ramp is shared because the liquidation map is dark-only by design,
   and TERMINAL_FLAT_CELL has no light value anywhere. */
const DARK = [...mapOf('TERMINAL_COLORS'), flatCell, ...rampHexes].filter(Boolean);
const LIGHT = [...mapOf('TERMINAL_COLORS_LIGHT'), ...rampHexes];

/* The one definition of "this field has no value". Lives here, not inside
   PAGE_EVAL and not duplicated in the settle poll below - two copies of a
   pattern is the exact drift that put five superseded hexes in this file's
   palette (#682). Passed into the browser as a source string because
   PAGE_EVAL is serialised across the boundary. */
const EMPTY_SOURCE = '^(—|-|–|N/A|--|NaN|null|undefined|CANNOT MEASURE)$';

const VIEWPORT_CFG = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
};

const PAGE_EVAL = ({ tokens, radiusExempt, emptySource }) => {
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

  const off = {}, radius = {}, emptyLabels = []; let contrastFails = 0, subMin = 0, empties = 0, scanned = 0;
  /* Every failing element, not the worst four. A count cannot be acted on -
     #684 needed to know WHICH 23 cells failed on /econ-calendar, and the
     answer turned out to be 20 impact badges nobody had considered plus 4
     cells from the one row that had been guessed at. Two candidate mechanisms
     were proposed from source reading and neither was the main cause.
     Capped at 30: enough to characterise a page, few enough that a badly
     broken screen does not bury the report. Each entry carries the foreground,
     the COMPOSITED ground, the opacity and the element's own and parent's
     selector - opacity because a 0.45 fade is invisible in a colour pair, and
     the composited ground because the failing surface is usually a translucent
     overlay that appears in no stylesheet. */
  const worstContrast = [];
  const BAD = new RegExp(emptySource);

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
          if (ratio < need) { contrastFails++; if (worstContrast.length < 30) worstContrast.push({ t: t.slice(0,20), ratio:+ratio.toFixed(2), px:s.fontSize, fg: s.color, sel: el.tagName.toLowerCase() + (el.className && typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).join('.') : ''), par: el.parentElement ? (el.parentElement.tagName.toLowerCase() + (el.parentElement.className && typeof el.parentElement.className === 'string' && el.parentElement.className.trim() ? '.' + el.parentElement.className.trim().split(/\s+/).join('.') : '')) : '', op: s.opacity, ground: 'rgb(' + Math.round(bg.r) + ',' + Math.round(bg.g) + ',' + Math.round(bg.b) + ')' }); } }
        if (BAD.test(t)) {
          empties++;
          /* A count with no identity is not actionable - "72 empty fields" says
             nothing about which. Record the nearest preceding label so the
             report names the field, capped so a page of placeholders does not
             dominate the output. */
          if (emptyLabels.length < 12) {
            let lab = '';
            for (let n = el.parentElement, i = 0; n && i < 3 && !lab; n = n.parentElement, i++) {
              const first = (n.innerText || '').split('\n').map(x => x.trim()).filter(x => x && x !== t)[0];
              if (first) lab = first.slice(0, 24);
            }
            emptyLabels.push((lab || el.className || el.tagName.toLowerCase()) + ' => "' + t + '"');
          }
        }
      }
    }
    if (/^(BUTTON|A|INPUT|SELECT)$/.test(el.tagName) && (r.width < 24 || r.height < 24)) subMin++;
  });

  return {
    scanned,
    /* PROVEN scrollable, not merely wider. `html { overflow-x: hidden }` in
       app/globals.css clips the closed nav drawer while scrollWidth still
       reports its extents, so the subtraction alone reports an overflow
       nobody can reach. It did: /dashboard and /liq each showed a non-zero
       `ovf` here on 2026-09-03 while qa/mobile-audit.mjs - which tries to
       scroll and checks the offset sticks - reported horizontalOverflow
       false for both. Four of sixty mobile loads were flagged and none of
       them scrolled. mobile-audit learned this on #641; this file had not.
       Report both: the honest boolean drives the count, and the raw extents
       stay for whoever wants to know something is wider than the viewport
       even though nobody can reach it. */
    overflow: (() => {
      const de = document.documentElement;
      if (de.scrollWidth <= de.clientWidth) return 0;
      const before = de.scrollLeft;
      de.scrollLeft = 99999; window.scrollTo(99999, window.scrollY);
      const moved = de.scrollLeft > 1 || window.scrollX > 1;
      de.scrollLeft = before; window.scrollTo(0, window.scrollY);
      return moved ? de.scrollWidth - de.clientWidth : 0;
    })(),
    widerThanViewport: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    offDistinct: Object.keys(off).length,
    offTop: Object.entries(off).sort((a,b)=>b[1]-a[1]).slice(0,4),
    radiusTotal: Object.values(radius).reduce((a,c)=>a+c,0),
    radiusTop: Object.entries(radius).sort((a,b)=>b[1]-a[1]).slice(0,3),
    contrastFails, worstContrast, subMin, empties, emptyLabels: [...new Set(emptyLabels)],
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
        /* Settle-poll, not a fixed wait. 4500ms sat exactly on the knee of
           /scanner's loading curve, which made its empty-field count a coin
           flip. Measured on qa 52b335f, one page load, counting placeholders
           at intervals:

             desktop  2s=466  5s=66  10s=66 … 90s=66
             mobile   2s=388  5s=335  10s=66 … 90s=66

           A 4.5s sample lands between 466 and 66 on desktop depending on the
           network, and that is why the same route reported 15, 66 and 482 on
           one build - readings that looked like a viewport difference and a
           regression and were neither.

           Poll until the count stops changing rather than guessing a duration:
           two identical consecutive reads, checked every 1.5s, capped at 30s.
           The cap is the honest part - a page that never settles is reported
           at whatever it reached, not waited on forever. */
        /* Settle the DESIGN AND THEME before anything else. The empties poll
           below waits for content; this waits for the page to stop being two
           designs at once.

           qa/mobile-audit.mjs returned 263 contrast failures on / in light on
           qa 2ef168c and 0 on an immediate re-run of the identical command.
           Nothing in that build touches the landing page: it was sampled
           mid-transition, one design's colours applied and the other's not.
           This file has the same exposure and had no such gate - the exact
           'two tools measuring the same thing, only one corrected' shape that
           left a retracted overflow finding publishing here for weeks (#686).

           Watches the inputs, not the output: a full walk is too expensive to
           sample twice, but a transition necessarily moves the design
           attribute, the theme attribute or the body background. The theme
           assertion is separate - a run that never applied the requested theme
           is perfectly stable and measuring the wrong thing. */
        const settled = await page.waitForFunction((want) => {
          const de = document.documentElement;
          const key = de.getAttribute('data-design') + '|' + de.getAttribute('data-theme') +
                      '|' + getComputedStyle(document.body).backgroundColor;
          const s = (window.__paSettle ||= { last: null, n: 0 });
          s.n = key === s.last ? s.n + 1 : 0;
          s.last = key;
          return s.n >= 2 && de.getAttribute('data-theme') === want;
        }, theme, { timeout: 45000, polling: 1000 }).then(() => true).catch(() => false);
        if (!settled) rec.unsettled = true;

        {
          const countEmpties = () => page.evaluate((src) => {
            const re = new RegExp(src);
            let c = 0;
            for (const e of document.querySelectorAll('*')) {
              if (e.children.length) continue;
              const t = (e.textContent || '').trim();
              if (t && t.length < 60 && re.test(t)) c++;
            }
            return c;
          }, EMPTY_SOURCE).catch(() => -1);
          /* Two equal reads is NOT settled. /scanner sits on a plateau of 466
             for the first ~4s, so reads at 1.5s and 3.0s agree while the page
             is still loading - the first version of this poll accepted 268 for
             exactly that reason. Require three consecutive equal reads AND a
             6s floor, which clears both measured curves (desktop drops at 5s,
             mobile at 10s) with room. Costs ~10-14s per load against the old
             fixed 4500ms; a full 120-load run grows by roughly 15 minutes,
             which is the price of the number meaning something. */
          const MIN_MS = 6000, NEED_STABLE = 3, STEP = 1500;
          let prev = -2, stable = 0, waited = 0;
          for (; waited < 30000; waited += STEP) {
            await page.waitForTimeout(STEP);
            const n = await countEmpties();
            if (n === prev) stable++; else stable = 0;
            prev = n;
            if (stable >= NEED_STABLE - 1 && waited + STEP >= MIN_MS) break;
          }
        }
        const data = await page.evaluate(PAGE_EVAL, { tokens: theme === 'light' ? LIGHT : DARK, radiusExempt: 24, emptySource: EMPTY_SOURCE });
        rec = { ...rec, ...data };
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 70);
      }
      rows.push(rec);
      if (!JSON_OUT) {
        const f = rec.error ? `ERROR ${rec.error}` :
          `ovf ${String(rec.overflow).padStart(4)}${rec.overflow === 0 && rec.widerThanViewport > 0 ? '(w' + rec.widerThanViewport + ')' : ''}  off ${String(rec.offDistinct).padStart(3)}  rad ${String(rec.radiusTotal).padStart(3)}  contrast ${String(rec.contrastFails).padStart(3)}  <24px ${String(rec.subMin).padStart(2)}  empty ${String(rec.empties).padStart(2)}` + (rec.unsettled ? '  UNSETTLED' : '');
        console.log(`${vp.padEnd(7)} ${theme.padEnd(5)} ${route.padEnd(18)} ${f}`);
        /* Name the empties. A bare count cannot be acted on - which field is
           blank is the whole question - and the labels are what turn an audit
           row into a bug report. */
        if (rec.emptyLabels && rec.emptyLabels.length) {
          console.log('              empty: ' + rec.emptyLabels.join(' | '));
        }
      }
    }
    await ctx.close();
  }
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(rows, null, 2)); process.exit(0); }

/* `measured`, not `bad` - these are the loads that produced a reading. Every
   count below is over THESE, not over every attempted load, so a route that
   failed to navigate contributes nothing and silently shrinks the denominator.
   The old name said the opposite of what the filter does, which is how this
   report came to look clean while measuring nothing. */
const measured = rows.filter(r => !r.error);
const errored  = rows.filter(r => r.error);
const sum = k => measured.reduce((a, r) => a + (r[k] || 0), 0);
console.log('\n' + '='.repeat(78));
console.log(`routes ${ROUTES.length} x viewports ${VIEWPORTS.length} x themes ${THEMES.length} = ${rows.length} page loads`);
console.log(`measured ${measured.length} of ${rows.length}   errors ${errored.length}`);

/* A run where nothing loaded prints six zeros and reads as a pass. That is
   this project's most-repeated failure - a broken probe is indistinguishable
   from a clean result - so say so, and exit non-zero so nothing downstream
   can mistake it for a green run. */
if (measured.length === 0) {
  console.log('\nNOTHING WAS MEASURED. Every page load errored, so the counts below');
  console.log('would all read zero for that reason alone. This is not a clean run.');
  for (const r of errored.slice(0, 5)) console.log(`  ${r.route} ${r.viewport} ${r.theme}: ${String(r.error).slice(0, 100)}`);
  process.exit(1);
}

console.log(`overflowing            ${measured.filter(r => r.overflow > 0).length} of ${measured.length}`);
console.log(`with contrast failures ${measured.filter(r => r.contrastFails > 0).length}   (total ${sum('contrastFails')})`);
console.log(`with off-palette       ${measured.filter(r => r.offDistinct > 0).length}   (total distinct-instances ${sum('offDistinct')})`);
console.log(`with radius violations ${measured.filter(r => r.radiusTotal > 0).length}   (total ${sum('radiusTotal')}, circular <=24px exempt per radius-ruling.md)`);
console.log(`with sub-24px targets  ${measured.filter(r => r.subMin > 0).length}   (total ${sum('subMin')})`);
console.log(`with empty fields      ${measured.filter(r => r.empties > 0).length}   (total ${sum('empties')})`);

/* A run that never settled is not a clean run, and a flag nobody prints is
   the same defect one level up. */
const unsettled = measured.filter(r => r.unsettled);
if (unsettled.length) {
  console.log('');
  console.log(unsettled.length + ' of ' + measured.length + ' loads NEVER SETTLED within 45s -');
  console.log('their design or theme was still changing when measured. Treat these rows as suspect:');
  for (const r of unsettled.slice(0, 8)) console.log('  ' + r.route + ' ' + r.viewport + ' ' + r.theme);
}

if (errored.length) {
  console.log(`\n${errored.length} of ${rows.length} loads errored and are EXCLUDED from every count above:`);
  for (const r of errored.slice(0, 8)) console.log(`  ${r.route} ${r.viewport} ${r.theme}: ${String(r.error).slice(0, 100)}`);
  process.exit(1);
}
