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
/* WHICH DESIGN TO MEASURE (#741).
 *
 * Every sweep in this folder hardcoded `terminal`, so the design users actually
 * get was never measured by anything. That was reasonable while terminal was
 * the thing under construction; it inverted at #719, when terminal shipped on
 * `/` only and every app screen went back to the current design. The cost was
 * #739 - a 1.62:1 contrast failure live on liquidity-hq.com, invisible to 24
 * page loads of auditing because all 24 forced terminal.
 *
 * DEFAULT STAYS `terminal`. Every figure quoted in the issues to date was
 * measured that way, and silently moving the default would make them
 * incomparable without saying so. The flag makes the choice explicit; the
 * default keeps the existing record readable. */
const DESIGNS = arg('--design', 'terminal').split(',');

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

    /* ── IS THE CONTROL REACHABLE. Added 2026-09-05, and the reason matters ──
     *
     * #845: /learn's logo and BOTH hero buttons, the primary CTA included, were
     * painted over by the terminal app nav and could not be clicked. This file
     * swept /learn on every audit and reported it CLEAN, because none of the
     * checks above can see an unclickable control - contrast, overflow, radius,
     * tap size and empty labels all pass on a button nobody can press.
     *
     * It was caught by the Playwright suite instead, which runs on exactly one
     * trigger: a PR into main. The three releases before it - 2026-08-29,
     * 09-02 and 09-03 - shipped with that suite disabled for cost, so nothing
     * exercised a browser at all. A defect class that only one release-time
     * gate can see is a defect class that ships whenever that gate is off.
     *
     * This check costs nothing extra: the sweep is already on the page with a
     * laid-out DOM. It belongs here rather than only in the suite so it runs
     * every audit, on every design, theme and viewport, for free.
     *
     * ATTRIBUTED BY THE COVERER, NOT COUNTED. A fixed bottom bar legitimately
     * overlaps content on a scrolled page, so a raw count reports a healthy
     * build as broken. `barCovered` is reported separately rather than dropped -
     * the caller decides whether the bar belongs on that route, because on a
     * marketing page it does NOT and that overlap IS the bug. Getting this
     * backwards would have hidden #845 at 390 on the very routes under test. */
    ...(() => {
      const SEL = 'a[href], button, input, select, textarea, [role="button"], [role="link"], [tabindex]:not([tabindex="-1"])';
      const covered = []; let barCovered = 0, probed = 0;
      for (const el of document.querySelectorAll(SEL)) {
        const b = el.getBoundingClientRect();
        if (b.width < 1 || b.height < 1) continue;
        if (b.bottom < 0 || b.top > innerHeight) continue;
        const s = getComputedStyle(el);
        if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
        if (el.closest('[inert]')) continue;
        probed++;
        const x = Math.min(Math.max(b.left + b.width / 2, 1), innerWidth - 1);
        const y = Math.min(Math.max(b.top + b.height / 2, 1), innerHeight - 1);
        const hit = document.elementFromPoint(x, y);
        /* Both directions: a button wrapping an icon hit-tests to the icon and a
           link inside a styled wrapper hit-tests to the wrapper. Only an
           UNRELATED element is a finding. Same rule as layout.spec.ts. */
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;
        if (hit.closest('.mobile-tab-bar, .tnav-tabs')) { barCovered++; continue; }
        const nameOf = n => n.tagName.toLowerCase()
          + (typeof n.className === 'string' && n.className.trim()
            ? '.' + n.className.trim().split(/\s+/).slice(0, 3).join('.') : '');
        if (covered.length < 12) covered.push(`${nameOf(el)} < ${nameOf(hit)}`);
      }
      return { probed, coveredCount: covered.length, covered, barCovered };
    })(),
  };
};

const browser = await chromium.launch();
const rows = [];

for (const design of DESIGNS) {
for (const vp of VIEWPORTS) {
  for (const theme of THEMES) {
    const ctx = await browser.newContext(VIEWPORT_CFG[vp]);
    /* `current` REMOVES the attribute rather than setting data-design="current"
       - lib/designMode.ts:49 is explicit that no [data-design="current"] block
       exists and none should. Storing the string is still correct: it is what
       resolveDesignMode reads, and it maps to "attribute absent". */
    await ctx.addInitScript(([t, d]) => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', d); } catch {} }, [theme, design]);
    /* PIN CONSENT. Added 2026-09-05 with the coverage check, because without it
     * that check measures the banner rather than the layout: the first
     * instrumented run reported 60 covered controls and nearly every one was
     * `< div.consent-bar`, `< p.consent-text` or `< button.consent-btn`.
     *
     * The banner legitimately covers the page until dismissed, so counting it is
     * not a finding — it is the same reason contrast.spec.ts, layout.spec.ts and
     * a11y.spec.ts all seed this key. `layout.spec.ts` keeps a dedicated
     * first-visit sweep for the banner itself, which is where that question
     * belongs. */
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch {} });
    const page = await ctx.newPage();
    page.on('pageerror', () => {});

    /* A 4xx/5xx DURING A RUN INVALIDATES THE RUN. Added 2026-09-05 on Dev Team's
     * finding, and it is the cheapest guard on this page.
     *
     * They spent an afternoon measuring against a local server whose
     * `_next/static/chunks/*` were answering 500 with `text/plain`. The landing
     * JS never executed, `.lp-loading` stayed up at 2.4s and at 15s alike, and
     * every number that came back was well-formed and about a page that had not
     * run. It only surfaced because a figure disagreed with a second instrument.
     *
     * A failed asset does not throw, does not appear in `pageerror`, and does
     * not stop the sweep - it silently changes what is on screen. Same family as
     * trap 13, where a broken fetch shim produced nine confident zeros: the
     * measurement is fine and the SUBJECT is not what you think.
     *
     * So it is counted per route and reported, rather than left to be
     * discovered. Requests the app makes to third parties are excluded - those
     * fail all the time and are not this page's health. */
    let badResponses = [];
    page.on('response', (r) => {
      try {
        const u = r.url();
        if (r.status() < 400 || !u.startsWith(BASE)) return;
        /* DOCUMENTS AND ASSETS ONLY — NOT `/api/*`. Scoped on the first real run
         * of this guard, which fired on 30 of 120 loads and was wrong on nearly
         * all of them.
         *
         * What it caught: 19x `502 /api/proxy?type=premium-index`, 4x `502
         * /api/ath`, and 4x `401 /api/price-alerts`. The 401 is the app working
         * CORRECTLY — the sweep is signed out and that route is supposed to
         * refuse. The 502s are upstream exchange failures wearing our own
         * origin, which happen constantly and say nothing about the build.
         *
         * The failure this guard exists for is Dev Team's: `_next/static/chunks/*`
         * answering 500, so the page's JS never executed while every measurement
         * came back well-formed. That is a DOCUMENT/ASSET failure. An API route
         * answering 401 or 502 leaves the page rendered and the measurement
         * valid — it changes the DATA, which `empty` already counts.
         *
         * Scoped by resourceType rather than by URL shape, because the point is
         * "did the page's own machinery load", not "did every request succeed".
         * A guard that fires on healthy runs gets skimmed past within a day,
         * which is worse than not having one. */
        const kind = r.request().resourceType();
        if (!['document', 'script', 'stylesheet', 'font'].includes(kind)) return;
        badResponses.push(`${r.status()} ${kind} ${u.slice(BASE.length) || '/'}`);
      } catch { /* response gone */ }
    });

    for (const route of ROUTES) {
      const url = BASE + route + (route.includes('?') ? '&' : '?') + 'design=' + design;
      let rec = { route, viewport: vp, theme, design, error: null };
      badResponses = [];
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
        rec = { ...rec, ...data, badResponses: [...badResponses] };
      } catch (e) {
        rec.error = String(e.message || e).slice(0, 70);
      }
      rows.push(rec);
      if (!JSON_OUT) {
        const f = rec.error ? `ERROR ${rec.error}` :
          `ovf ${String(rec.overflow).padStart(4)}${rec.overflow === 0 && rec.widerThanViewport > 0 ? '(w' + rec.widerThanViewport + ')' : ''}  off ${String(rec.offDistinct).padStart(3)}  rad ${String(rec.radiusTotal).padStart(3)}  contrast ${String(rec.contrastFails).padStart(3)}  <24px ${String(rec.subMin).padStart(2)}  empty ${String(rec.empties).padStart(2)}  covered ${String(rec.coveredCount).padStart(2)}${rec.barCovered ? '(bar' + rec.barCovered + ')' : ''}` + (rec.unsettled ? '  UNSETTLED' : '');
        const dcol = DESIGNS.length > 1 ? design.padEnd(9) + ' ' : '';
        console.log(`${dcol}${vp.padEnd(7)} ${theme.padEnd(5)} ${route.padEnd(18)} ${f}`);
        /* Name the empties. A bare count cannot be acted on - which field is
           blank is the whole question - and the labels are what turn an audit
           row into a bug report. */
        if (rec.emptyLabels && rec.emptyLabels.length) {
          console.log('              empty: ' + rec.emptyLabels.join(' | '));
        }
        /* Name the covered controls for the same reason the empties are named:
           "3 covered" cannot be acted on, and "a.lp-btn-primary < header.tnav"
           is a bug report. #845 was three lines like this one, and the audit
           that swept that page every day printed none of them. */
        if (rec.covered && rec.covered.length) {
          for (const c of rec.covered) console.log('              covered: ' + c);
        }
        /* Printed, never swallowed. A row with a 500 behind it is not a result. */
        if (rec.badResponses && rec.badResponses.length) {
          console.log('              🔴 HTTP: ' + rec.badResponses.slice(0, 4).join(' | ')
            + (rec.badResponses.length > 4 ? ` (+${rec.badResponses.length - 4} more)` : '')
            + '  — this row measured a page that did not fully load');
        }
      }
    }
    await ctx.close();
  }
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
/* Scoped to a design when more than one was swept (#776 review, dev's finding).
   A `--design terminal,current` run used to total BOTH designs into one number,
   and the per-row `design` column was the only thing saying otherwise. A reader
   who scrolls to the summary - which is what a summary is for - got a figure
   belonging to neither design.

   That is the same shape as the finding this flag was built to catch: on
   2026-09-04 `current desktop-dark contrast 1330` was 1322 of /correlation and
   8 of everything else, and the fix was looking at what the total contained.
   An aggregate that spans the axis under test cannot be read, and this one was
   latent in precisely the capability the flag adds. */
const sumOf = (rowset, k) => rowset.reduce((a, r) => a + (r[k] || 0), 0);
const sum = k => sumOf(measured, k);
console.log('\n' + '='.repeat(78));
console.log(`designs ${DESIGNS.join('+')} x routes ${ROUTES.length} x viewports ${VIEWPORTS.length} x themes ${THEMES.length} = ${rows.length} page loads`);
console.log(`measured ${measured.length} of ${rows.length}   errors ${errored.length}`);

/* A run where nothing loaded prints six zeros and reads as a pass. That is
   this project's most-repeated failure - a broken probe is indistinguishable
   from a clean result - so say so, and exit non-zero so nothing downstream
   can mistake it for a green run. */
if (measured.length === 0) {
  console.log('\nNOTHING WAS MEASURED. Every page load errored, so the counts below');
  console.log('would all read zero for that reason alone. This is not a clean run.');
  for (const r of errored.slice(0, 5)) console.log(`  ${r.route} ${r.design} ${r.viewport} ${r.theme}: ${String(r.error).slice(0, 100)}`);
  process.exit(1);
}

console.log(`overflowing            ${measured.filter(r => r.overflow > 0).length} of ${measured.length}`);
console.log(`with contrast failures ${measured.filter(r => r.contrastFails > 0).length}   (total ${sum('contrastFails')})`);
/* SEPARATE LINE, not folded into a total. A control nobody can click is a
   different severity from a low-contrast label, and #845 shipped because this
   number did not exist. `bar` is counted apart because a fixed bottom bar
   legitimately overlaps a scrolled page - it is context, not a pass. */
console.log(`with covered controls  ${measured.filter(r => r.coveredCount > 0).length}   (total ${sum('coveredCount')}, plus ${sum('barCovered')} behind a fixed bottom bar)`);
/* LAST, and loudest, because it invalidates everything above it rather than
   adding to it. A sweep with 4xx/5xx in it did not measure the app. */
const withBad = measured.filter(r => (r.badResponses || []).length);
console.log(withBad.length
  ? `🔴 loads with HTTP >= 400   ${withBad.length} of ${measured.length}   — THESE ROWS ARE NOT RESULTS, re-run before quoting any number above`
  : `loads with HTTP >= 400  0 of ${measured.length}`);
console.log(`with off-palette       ${measured.filter(r => r.offDistinct > 0).length}   (total distinct-instances ${sum('offDistinct')})`);
console.log(`with radius violations ${measured.filter(r => r.radiusTotal > 0).length}   (total ${sum('radiusTotal')}, circular <=24px exempt per radius-ruling.md)`);
console.log(`with sub-24px targets  ${measured.filter(r => r.subMin > 0).length}   (total ${sum('subMin')})`);

console.log(`with empty fields      ${measured.filter(r => r.empties > 0).length}   (total ${sum('empties')})`);

/* The per-design split. Printed only for a multi-design run, because for a
   single design it would restate the block above verbatim. */
if (DESIGNS.length > 1) {
  console.log('\nBY DESIGN - the totals above span both and belong to neither:');
  for (const d of DESIGNS) {
    const rs = measured.filter(r => r.design === d);
    if (!rs.length) { console.log(`  ${d.padEnd(9)} nothing measured`); continue; }
    console.log(`  ${d.padEnd(9)} loads ${String(rs.length).padStart(3)}` +
      `  contrast ${String(sumOf(rs, 'contrastFails')).padStart(5)}` +
      `  off-palette ${String(sumOf(rs, 'offDistinct')).padStart(4)}` +
      `  radius ${String(sumOf(rs, 'radiusTotal')).padStart(5)}` +
      `  <24px ${String(sumOf(rs, 'subMin')).padStart(4)}`);
  }
}

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
