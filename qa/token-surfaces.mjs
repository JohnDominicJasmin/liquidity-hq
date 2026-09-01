#!/usr/bin/env node
/* Per-token landing-surface report — what design asked for instead of deriving
 * surfaces by hand.
 *
 * WHY THIS EXISTS
 * ---------------
 * specs/light-theme-tokens.md recorded ONE contrast figure per token, measured
 * against --bg0. That is the token's BEST case, not its binding one, and it let
 * three values ship that fail where they actually render:
 *
 *   --txt3 light #6a6e73   documented 5.14:1 on --bg0
 *                          measured   3.93:1 on --bg2, 4.26:1 on #e8eaed
 *   --green light #1a7f37  documented 4.70:1 on --bg0
 *                          measured   3.89:1 on --bg2
 *   --txt3 dark  #7c828a   passes on all three dark tokens
 *                          measured   4.30:1 on a COMPOSITED #1d1e20
 *
 * The last one is the reason a "darkest token" column does not close this
 * either: the surface that binds is not always a token. It has to come from
 * where the token is observed, which means measuring, not reading the palette.
 *
 * WHAT IT REPORTS
 * ---------------
 * For every token in the palette, every distinct background it was actually
 * observed against, the contrast there, and the WCAG threshold that applies to
 * the text that landed on it (3:1 for large/bold, else 4.5:1). Sorted worst
 * first, because the worst row is the only one that matters.
 *
 * Usage:
 *   node qa/token-surfaces.mjs                       # both themes, desktop
 *   node qa/token-surfaces.mjs --themes light
 *   node qa/token-surfaces.mjs --routes /liq,/scanner
 *   node qa/token-surfaces.mjs --md > surfaces.md    # markdown, for design
 *   node qa/token-surfaces.mjs --json
 *
 * Run with MSYS_NO_PATHCONV=1 in Git Bash or /liq becomes a Windows path.
 */

import { chromium, devices } from '@playwright/test';

const arg = (name, dflt) => {
  const i = process.argv.indexOf(name);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : dflt;
};

const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const THEMES = arg('--themes', 'dark,light').split(',');
const VIEWPORT = arg('--viewport', 'desktop');
const MD = process.argv.includes('--md');
const JSON_OUT = process.argv.includes('--json');

const DEFAULT_ROUTES = [
  '/', '/dashboard', '/arena', '/briefing', '/markets', '/scanner', '/journal',
  '/alerts', '/news', '/liq', '/funding', '/correlation', '/calc', '/playbook',
  '/hours', '/research', '/econ-calendar', '/settings', '/upgrade',
  '/about', '/learn', '/privacy', '/terms', '/refund', '/faq', '/disclaimer',
  '/login', '/forgot-password', '/reset-password', '/offline',
];
const ROUTES = arg('--routes', '') ? arg('--routes', '').split(',') : DEFAULT_ROUTES;

/* Token name -> value, per theme. Values track globals.css, not the spec file:
   the spec is what we are checking, so it cannot also be the reference. */
const PALETTE = {
  dark: {
    '--bg0': '#08090a', '--bg1': '#141517', '--bg2': '#111416',
    '--bdr': '#1f2225', '--bdr2': '#131618', '--bdr3': '#16191b',
    '--txt': '#e8e9ea', '--txt2': '#8b8f94', '--txt3': '#7c828a',
    '--txt4': '#3a3f45', '--accent': '#d9a626', '--green': '#3fb950',
    '--red': '#f0524d', '--mark-idle': '#22262a', '--border-input': '#5e646b',
    '--amber': '#fbbf24',
  },
  light: {
    '--bg0': '#f7f6f3', '--bg1': '#ebe9e6', '--bg2': '#e3e1dd',
    '--bdr': '#d5d2cd', '--bdr2': '#dfdcd7', '--bdr3': '#e2dfda',
    '--txt': '#15181b', '--txt2': '#585c61', '--txt3': '#5e6267',
    '--txt4': '#aeaaa4', '--accent': '#8a5c00', '--green': '#14702c',
    '--red': '#cf222e', '--amber': '#9a6a00', '--mark-idle': '#d1cec9',
    '--border-input': '#75797e', '--txt-dash': '#5e6267',
  },
};

/* An unrecognised foreground is SKIPPED, not counted — so a stale palette here
   silently omits exactly the tokens that were most recently changed. The first
   run of this script against c289017 still carried --txt3 #6a6e73 and --green
   #1a7f37 and reported nothing at all for either, on the run whose whole point
   was to check them. Re-read globals.css after every token change. */

const VIEWPORT_CFG = {
  desktop: { viewport: { width: 1440, height: 900 } },
  mobile: { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } },
};

/* Returns one record per (foreground, background) pair actually observed.
   Aggregation happens in node — the page just reports what it saw. */
const PAGE_EVAL = () => {
  const parse = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); return m.length ? { r: m[0], g: m[1], b: m[2], a: m.length > 3 ? m[3] : 1 } : null; };
  const over = (f, b) => ({ r: f.r * f.a + b.r * (1 - f.a), g: f.g * f.a + b.g * (1 - f.a), b: f.b * f.a + b.b * (1 - f.a), a: 1 });
  const hex = c => '#' + [c.r, c.g, c.b].map(v => Math.round(v).toString(16).padStart(2, '0')).join('');
  const lum = c => { const f = v => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const cr = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };

  /* Composite every translucent layer down to the first opaque ancestor.
     Treating a tint as opaque invented 20 failures on an earlier run. */
  const bgOf = el => {
    const L = []; let p = el;
    while (p) { const c = parse(getComputedStyle(p).backgroundColor); if (c && c.a > 0) { L.push(c); if (c.a === 1) break; } p = p.parentElement; }
    let base = L.length && L[L.length - 1].a === 1 ? L.pop() : { r: 0, g: 0, b: 0, a: 1 };
    for (let i = L.length - 1; i >= 0; i--) base = over(L[i], base);
    return base;
  };

  /* Shell chrome is permanently mounted offscreen at full size — counting it
     attributes shell-wide colours to whichever route is being measured. */
  const isChrome = el => !!el.closest('.nav-menu, .gchat-panel, .app-bar, .nav-drawer, .pf-footer, .mobile-tab-bar');

  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length) return;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) return;
    if (isChrome(el)) return;
    const t = (el.textContent || '').trim();
    if (!t || t.length > 60) return;

    const s = getComputedStyle(el);
    const fg = parse(s.color);
    if (!fg) return;
    const bg = bgOf(el);
    const px = parseFloat(s.fontSize);
    const large = px >= 24 || (px >= 18.66 && parseInt(s.fontWeight) >= 700);

    out.push({
      fg: hex(over(fg, bg)),
      bg: hex(bg),
      ratio: +cr(over(fg, bg), bg).toFixed(3),
      need: large ? 3 : 4.5,
      px: s.fontSize,
      cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
      sample: t.slice(0, 24),
    });
  });
  return out;
};

const browser = await chromium.launch();
/* key: `${theme}|${token}|${bg}` */
const seen = new Map();
const errors = [];

for (const theme of THEMES) {
  const pal = PALETTE[theme];
  const byHex = Object.fromEntries(Object.entries(pal).map(([n, v]) => [v.toLowerCase(), n]));
  const bgNameOf = h => byHex[h] ? `${byHex[h]} ${h}` : `${h} (composited)`;

  const ctx = await browser.newContext(VIEWPORT_CFG[VIEWPORT]);
  await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, theme);
  const page = await ctx.newPage();
  page.on('pageerror', () => {});

  for (const route of ROUTES) {
    const url = `${BASE}${route}${route.includes('?') ? '&' : '?'}design=terminal`;
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 90000 });
      /* Dashboard double-mounts during the design-mode transition and the
         phantom carries placeholder values. Scope to the visible grid. */
      await page.waitForFunction(() => {
        const g = [...document.querySelectorAll('.dashboard-grid')];
        return !g.length || g.filter(x => x.getBoundingClientRect().width > 0).length === 1;
      }, { timeout: 60000 }).catch(() => {});
      await page.waitForTimeout(4500);

      for (const rec of await page.evaluate(PAGE_EVAL)) {
        const token = byHex[rec.fg];
        if (!token) continue;              // off-palette; platform-audit.mjs owns those
        const key = `${theme}|${token}|${rec.bg}`;
        const hit = seen.get(key) || {
          theme, token, value: pal[token], bg: rec.bg, bgLabel: bgNameOf(rec.bg),
          isTokenBg: !!byHex[rec.bg], ratio: rec.ratio, need: rec.need,
          count: 0, routes: new Set(), classes: new Set(), sample: rec.sample, px: rec.px,
        };
        hit.count++;
        hit.routes.add(route);
        hit.classes.add(rec.cls);
        /* Keep the strictest threshold observed on this surface — if any text
           landing here is normal-size, the surface must clear 4.5. */
        if (rec.need > hit.need) { hit.need = rec.need; hit.sample = rec.sample; hit.px = rec.px; }
        seen.set(key, hit);
      }
      if (!MD && !JSON_OUT) process.stderr.write(`  ${theme} ${route}\n`);
    } catch (e) {
      errors.push({ theme, route, error: String(e.message || e).slice(0, 70) });
    }
  }
  await ctx.close();
}
await browser.close();

const all = [...seen.values()].map(h => ({
  ...h, routes: [...h.routes].sort(), classes: [...h.classes].sort(),
  pass: h.ratio >= h.need,
}));

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, viewport: VIEWPORT, errors, surfaces: all }, null, 2)); process.exit(0); }

const esc = s => String(s).replace(/\|/g, '\\|');

for (const theme of THEMES) {
  const rows = all.filter(r => r.theme === theme);
  if (!rows.length) continue;
  console.log(`\n## ${theme} theme — observed landing surfaces\n`);
  console.log(`Measured on ${BASE} at ${VIEWPORT}, ${ROUTES.length} routes. Each row is a`);
  console.log(`background this token was actually rendered against, not a background it`);
  console.log(`could be. Threshold is the strictest that applies to text seen on it.\n`);

  const tokens = [...new Set(rows.map(r => r.token))].sort((a, b) => {
    const wa = Math.min(...rows.filter(r => r.token === a).map(r => r.ratio - r.need));
    const wb = Math.min(...rows.filter(r => r.token === b).map(r => r.ratio - r.need));
    return wa - wb;                        // most-failing token first
  });

  for (const token of tokens) {
    const t = rows.filter(r => r.token === token).sort((a, b) => a.ratio - b.ratio);
    const fails = t.filter(r => !r.pass);
    const flag = fails.length ? `**${fails.length} of ${t.length} surfaces FAIL**` : `all ${t.length} pass`;
    console.log(`\n### \`${token}\` \`${t[0].value}\` — ${flag}\n`);
    console.log('| landing surface | contrast | needs | | seen on | example |');
    console.log('|---|---|---|---|---|---|');
    for (const r of t) {
      const where = r.routes.length > 3 ? `${r.routes.slice(0, 3).join(', ')} +${r.routes.length - 3}` : r.routes.join(', ');
      console.log(`| \`${r.bgLabel}\` | ${r.ratio.toFixed(2)}:1 | ${r.need} | ${r.pass ? 'pass' : '**FAIL**'} | ${esc(where)} | \`${esc(r.classes[0])}\` ${esc(r.sample)} |`);
    }
  }

  const failing = rows.filter(r => !r.pass);
  console.log(`\n**${theme}: ${failing.length} failing surface${failing.length === 1 ? '' : 's'} across ${new Set(failing.map(r => r.token)).size} token${new Set(failing.map(r => r.token)).size === 1 ? '' : 's'}, out of ${rows.length} observed.**`);
}

if (errors.length) {
  console.log(`\n> Routes that did not load (${errors.length}) — absent from the data above, not passing:`);
  for (const e of errors) console.log(`> \`${e.theme} ${e.route}\` — ${esc(e.error)}`);
}
