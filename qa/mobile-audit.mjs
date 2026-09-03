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
import { readFileSync } from 'node:fs';

const url = process.argv[2];
if (!url) { console.error('usage: node qa/mobile-audit.mjs <url> [--theme dark|light]'); process.exit(1); }
const theme = (process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'dark');
const width = Number(process.argv.includes('--width') ? process.argv[process.argv.indexOf('--width') + 1] : 390);

/* The 16 governed terminal tokens (15 documented + --amber, confirmed on #542). */
/* The governed palette is DERIVED from lib/terminalTokens.ts, not copied.
   #641 exposed why this matters twice over. First the list here held only
   the dark 16, so every light-theme run counted legitimate light tokens as
   off-palette - about a thousand false entries per route, which is worse
   than no check because it looked like a measurement. Then the fix for that
   hand-copied the light values out of app/globals.css and got three of them
   wrong: the stylesheet documents its own history in place, so a hex-grep
   over that block picks up #8a5c00 and #5e6266 from comments explaining the
   values that REPLACED them, plus #d6cab3 which is the /correlation diagonal
   and not a token at all.
   A copied list drifts and a stale hex is invisible among live ones - the
   whole failure is "a plausible hex in a list of hexes". So parse the source
   of truth instead. terminalTokens.ts is a .ts module and this is a plain
   .mjs script with no loader, so read and extract rather than import; the
   shapes below are pinned to that file's actual declarations and throw
   loudly if it is restructured, rather than silently yielding an empty
   palette and reporting a screen as perfectly on-token. */
const tokenSrc = readFileSync(new URL('../lib/terminalTokens.ts', import.meta.url), 'utf8');

/* indexOf/slice rather than a RegExp for the block boundaries: the first
   version of this used a template-literal regex and the backslashes
   collapsed, so [\s\S] compiled as [sS] and every lookup silently returned
   no match. Caught only because the guard below throws instead of returning
   an empty palette - which would have reported every screen as perfectly
   on-token. Keep the guard even if the parsing is simplified again. */
const mapOf = (name) => {
  const open = tokenSrc.indexOf('export const ' + name + ' = {');
  if (open === -1) throw new Error('mobile-audit: no ' + name + ' in lib/terminalTokens.ts');
  const close = tokenSrc.indexOf('\n} as const;', open);
  if (close === -1) throw new Error('mobile-audit: ' + name + ' has no closing "} as const;"');
  const hexes = tokenSrc.slice(open, close).match(/'(#[0-9a-fA-F]{6})'/g) || [];
  if (hexes.length < 10) throw new Error('mobile-audit: ' + name + ' yielded ' + hexes.length + ' colours, expected >= 10');
  return hexes.map((h) => h.slice(1, -1).toLowerCase());
};
const rampHexes = (tokenSrc.match(/color:\s*'(#[0-9a-fA-F]{6})'/g) || [])
  .map((m) => m.slice(m.indexOf('#'), m.indexOf('#') + 7).toLowerCase());
const flatCell = (/export const TERMINAL_FLAT_CELL = '(#[0-9a-fA-F]{6})'/.exec(tokenSrc) || [])[1];

/* Mirrors TERMINAL_ALLOWED / TERMINAL_ALLOWED_LIGHT exactly: the magma ramp is
   shared because the liquidation map is dark-only by design, and
   TERMINAL_FLAT_CELL has no light value anywhere. */
const TOKENS = theme === 'light'
  ? [...mapOf('TERMINAL_COLORS_LIGHT'), ...rampHexes]
  : [...mapOf('TERMINAL_COLORS'), flatCell, ...rampHexes].filter(Boolean);

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
  /* Same 0-1 vs 0-255 scaling as parse(): a `color(srgb ...)` declaration
     hexes to near-black without it, which is how 50 correctly-coloured
     ticker cells were reported as 1.04:1 failures. */
  const hex = c => {
    const m = (c.match(/[\d.]+/g) || []).map(Number);
    if (m.length < 3) return null;
    if (m.length > 3 && m[3] === 0) return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return '#' + m.slice(0, 3).map(v => Math.round(v * k).toString(16).padStart(2, '0')).join('');
  };
  /* `color(srgb r g b / a)` channels are 0-1; `rgb()`/`rgba()` are 0-255. Scaling by prefix, not by value range - a real rgb(0 1 2) must not be rescaled. Without this every translucent modern-syntax colour composites to near-black: it read the landing ticker's 80%-alpha change values as 1.04:1 when they are 3.96:1. */
  const parse = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return { r: m[0]*k, g: m[1]*k, b: m[2]*k, a: m.length > 3 ? m[3] : 1 }; };
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
    /* scrollWidth > clientWidth does NOT mean the page scrolls: `overflow-x:
       hidden` on <html> (app/globals.css) clips the closed nav drawer while
       scrollWidth still reports its extents. That comparison alone produced a
       phantom "334px overflow" on /dashboard in #641. The only proof is trying
       to scroll and seeing the offset stick, so report both: the honest
       boolean, and the raw extents for whoever wants to know something is
       wider than the viewport even though nobody can reach it. */
    horizontalOverflow: (() => {
      const de = document.documentElement;
      if (de.scrollWidth <= de.clientWidth) return false;
      const before = de.scrollLeft;
      de.scrollLeft = 99999; window.scrollTo(99999, window.scrollY);
      const moved = de.scrollLeft > 1 || window.scrollX > 1;
      de.scrollLeft = before; window.scrollTo(0, window.scrollY);
      return moved;
    })(),
    contentWiderThanViewport: document.documentElement.scrollWidth > document.documentElement.clientWidth,
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
    deadRules: (() => {
      /* A CSS declaration an inline style outranks is DEAD, not overridden -
         it can never apply, and source reads cannot see that. Three defects
         shipped this way (#629, #633, #660): globals.css said 9.5px for weeks
         while the badge rendered 12, because an inline font-size won every
         time. The rule looked correct in the file and had no effect.

         Detection: collect every selector in our own stylesheets that sets a
         property, then find elements matching one of those selectors that ALSO
         carry that property inline. The intersection is exactly the dead set.
         Cross-origin sheets throw on .cssRules and are skipped - we only own
         same-origin ones anyway. */
      const PROPS = ['font-size', 'font-family', 'letter-spacing', 'color', 'background-color'];
      const byProp = {};
      for (const p of PROPS) byProp[p] = [];
      for (const sheet of document.styleSheets) {
        let rules;
        try { rules = sheet.cssRules; } catch { continue; }
        /* Collect BEFORE recursing, and recurse only into a non-empty list.
           Modern Chrome gives every CSSStyleRule a `cssRules` property for
           nested-CSS support - an empty CSSRuleList, which is truthy. A
           `if (r.cssRules) recurse; else collect;` shape therefore treats
           every plain rule as a group, walks an empty list, and collects
           nothing. That version returned [] on a synthetic page built to
           contain exactly one dead rule, which is the only reason it was
           caught: an empty result from a detector and an empty result from a
           clean page are indistinguishable. */
        const walk = (list) => {
          for (const r of list) {
            if (r.selectorText && r.style) {
              for (const p of PROPS) if (r.style.getPropertyValue(p)) byProp[p].push(r.selectorText);
            }
            if (r.cssRules && r.cssRules.length) walk(r.cssRules);
          }
        };
        walk(rules);
      }
      const out = [];
      for (const el of document.querySelectorAll('[style]')) {
        const inline = el.getAttribute('style') || '';
        for (const p of PROPS) {
          if (!new RegExp('(^|;)\s*' + p + '\s*:').test(inline)) continue;
          for (const sel of byProp[p]) {
            let hit = false;
            try { hit = el.matches(sel); } catch { continue; }
            if (!hit) continue;
            /* Only class/id-scoped rules. A base rule like `button, input`
               or `a` being overridden inline is ordinary cascade use, not a
               dead rule - reporting those buries the real case in noise.
               The defects that shipped (#629, #633, #660) were all a
               COMPONENT rule silently losing to an inline declaration, and
               those selectors always carry a class. */
            if (!/[.#]/.test(sel)) continue;
            out.push({ prop: p, selector: sel.slice(0, 70),
                       el: (el.className || el.tagName).toString().slice(0, 30),
                       computed: getComputedStyle(el).getPropertyValue(p) });
            break;
          }
        }
      }
      const seen = new Set();
      return out.filter(x => { const k = x.prop + x.selector + x.el;
        if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, 12);
    })(),
  };
}, TOKENS);

console.log(JSON.stringify({ url, requestedTheme: theme, ...result }, null, 2));
await browser.close();
