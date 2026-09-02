#!/usr/bin/env node
/* Scores `/arena` against the 35 acceptance criteria in
 * `design-handoff-dir/specs/arena.md`.
 *
 * WHAT THIS CAN AND CANNOT ANSWER — read before quoting a number from it.
 *
 * Arena's criteria split three ways, and conflating them is how a screen gets
 * called done while a third of its spec is unexamined:
 *
 *   DOM-checkable    structure, geometry, timeframe chips, absent-vs-hidden,
 *                    mobile geometry, tap targets. Scored here.
 *   FIXTURE-GATED    12-18 describe a *stubbed read* — 2-of-8 evidence rows
 *                    firing, FUNDING 8H red while positive, a bearish verdict,
 *                    a null evidence row, cleared penalties, an MTF neutral
 *                    band. A live page shows one arbitrary market state, so
 *                    "no violation observed" is NOT "the rule holds". Reported
 *                    UNVERIFIED, never PASS. There is no test seam for these
 *                    today; that is a known gap, not an oversight here.
 *   AUTH-GATED       27-30 need a signed-out free session. Use
 *                    `qa/gating-audit.mjs --free`, not this.
 *
 * Criterion 31 is a source lint (no literal user-visible strings), not a DOM
 * check, and is skipped here by design.
 *
 * THREE ROWS ARE PERMANENTLY EM-DASHED and that is correct, not a defect:
 * `CB PREM` (spec line 228, no source wired), `BASIS` (removed from the Grok
 * prompt on #343 — building a number repeats that mistake) and `LIQ 15M`
 * (the spec assumes a 15-minute Binance window; the only liquidation endpoint
 * in the codebase is a Coinglass h4 levels chart, and coinglass is not even
 * configured). See #594.
 *
 * Usage:
 *   node qa/arena-conformance.mjs [--base <url>] [--themes dark,light] [--json]
 *
 * Run with MSYS_NO_PATHCONV=1 in Git Bash, or `/arena` becomes a Windows path.
 */

import { chromium, devices } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const THEMES = arg('--themes', 'dark').split(',');
const JSON_OUT = process.argv.includes('--json');

const DESKTOP = () => {
  /* The 15 terminal tokens, for criterion 19. Declared INSIDE the evaluated
     function on purpose: `page.evaluate(fn)` serialises fn and runs it in the
     page, where module-scope constants do not exist — a module-level list
     threw `TOKENS_DARK is not defined` at runtime, not at parse. Kept literal
     rather than imported from lib/terminalTokens.ts so the checker cannot
     silently agree with a wrong palette file. */
  const TOKENS_DARK = ['#08090a', '#121314', '#1a1c1e', '#1f2225', '#2a2e32', '#16191b',
    '#e8e9ea', '#8b8f94', '#7c828a', '#3a3f45', '#d9a626', '#3fb950', '#f0524d', '#58a6ff', '#a371f7'];
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const Q = s => [...document.querySelectorAll(s)].filter(vis);
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const cs = getComputedStyle(document.documentElement);
  const tok = n => cs.getPropertyValue(n).trim().toLowerCase();
  /* 0-1 vs 0-255: see qa/TERMINAL_REDESIGN_STATE.md section 4. */
  const hex = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null;
    if (m.length > 3 && m[3] === 0) return null;
    const k = /^color\(/.test(c.trim()) ? 255 : 1;
    return '#' + m.slice(0, 3).map(v => Math.round(v * k).toString(16).padStart(2, '0')).join(''); };

  /* Root: accept either prefix, and never fall back to <body> silently — the
     landing checker's `|| document.body` turned a locator miss into a
     structural failure. A null root is reported as a miss. */
  const root = document.querySelector('.at-root, .arena-terminal, [data-arena-root]')
    || [...document.querySelectorAll('main.app-content > div')].filter(vis)[0]
    || null;

  /* C1 — 7 top-level regions */
  const regions = root ? [...root.children].filter(vis) : [];
  const c1 = { found: !!root, count: regions.length,
    tags: regions.map(e => e.tagName.toLowerCase() + (e.className ? '.' + e.className.toString().trim().split(/\s+/)[0] : '')).slice(0, 9) };

  /* C2 — rail 352. Structural: the widest <aside>, or the body row's second
     child. Not keyed to a class, which is what broke six landing criteria. */
  const aside = Q('aside')[0];
  const c2 = aside ? aside.offsetWidth : -1;

  /* C7 — band heights, by position rather than by class */
  const h = (el) => el ? el.offsetHeight : -1;
  const c7 = { nav: h(Q('nav, header')[0]), regions: regions.map(e => e.offsetHeight).slice(0, 7) };

  /* C8 — chart panel 430 */
  const chart = [...document.querySelectorAll('*')].filter(e => vis(e) &&
    /klc-|chart/i.test((e.className || '').toString()))
    .sort((a, b) => b.getBoundingClientRect().height - a.getBoundingClientRect().height)[0];
  const c8 = chart ? chart.offsetHeight : -1;

  /* C9 — verdict 34px. Find the largest mono text on the page above 24px;
     the verdict is by far the biggest string in the band. */
  const bigText = [...document.querySelectorAll('*')].filter(e => vis(e) && !e.children.length && txt(e).length > 1)
    .map(e => ({ e, px: parseFloat(getComputedStyle(e).fontSize), t: txt(e) }))
    .filter(x => x.px >= 24).sort((a, b) => b.px - a.px);
  const c9 = bigText[0] ? { px: bigText[0].px, text: bigText[0].t.slice(0, 24),
    colour: hex(getComputedStyle(bigText[0].e).color) } : null;

  /* C10 — panel headers 30 (body) / 28 (rail) */
  const headers = [...document.querySelectorAll('*')].filter(e => vis(e) && [28, 30].includes(e.offsetHeight)
    && /header|head|title/i.test((e.className || '').toString()));
  const c10 = { n: headers.length, heights: [...new Set(headers.map(e => e.offsetHeight))] };

  /* C11 — verdict band full width, no fixed px in its style attribute */
  const band = regions[4] || null;
  const c11 = band ? { w: band.offsetWidth, inner: root.clientWidth,
    fixedPx: /width:\s*\d+px/.test(band.getAttribute('style') || '') } : null;

  /* C6 — radius 0, circular <=24px exempt per radius-ruling.md */
  const radBad = [], radCircle = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el)) return;
    const s = getComputedStyle(el);
    const r = ['borderTopLeftRadius','borderTopRightRadius','borderBottomLeftRadius','borderBottomRightRadius'].map(k => s[k]);
    if (r.every(v => v === '0px')) return;
    const b = el.getBoundingClientRect();
    const cls = (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase();
    if (r.every(v => v === '50%') && Math.max(b.width, b.height) <= 24) radCircle.push(cls);
    else radBad.push(`${cls} ${r[0]} ${Math.round(b.width)}x${Math.round(b.height)}`);
  });
  const c6 = { bad: radBad.slice(0, 8), n: radBad.length, circular: radCircle.length };

  /* C16 — the string `Liq 24h` must appear nowhere */
  const c16 = /liq\s*24h/i.test(document.body.innerText || '');

  /* C19 — every colour is one of the 15 tokens. Translucent declarations are
     reported separately, not counted: judging a 4%-alpha tint by its raw RGB
     produced four false off-palette findings on /dashboard. */
  const off = {}, translucent = {};
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el)) return;
    const s = getComputedStyle(el);
    ['color', 'backgroundColor', 'borderTopColor'].forEach(p => {
      const raw = s[p]; if (!raw || /transparent/.test(raw)) return;
      const m = (raw.match(/[\d.]+/g) || []).map(Number);
      const a = m.length > 3 ? m[3] : 1;
      const hx = hex(raw); if (!hx) return;
      if (a < 0.999) { translucent[hx] = (translucent[hx] || 0) + 1; return; }
      if (!TOKENS_DARK.includes(hx)) off[hx] = (off[hx] || 0) + 1;
    });
  });
  const c19 = { off: Object.entries(off).sort((a, b) => b[1] - a[1]).slice(0, 6),
    translucent: Object.entries(translucent).sort((a, b) => b[1] - a[1]).slice(0, 4) };

  /* C20/C21/C23 — timeframe chips */
  const chips = [...document.querySelectorAll('button, [role="button"], a')].filter(el => {
    if (!vis(el)) return false;
    const t = txt(el);
    return /^(1m|5m|15m|30m|1h|4h|1d|1w)$/i.test(t) || /^(1m|5m|15m|30m|1h|4h|1d|1w)\s/i.test(t);
  });
  const locked = chips.filter(el => /🔒|lock/i.test(el.innerHTML) ||
    !!el.querySelector('svg[class*="lock"], [data-locked], [aria-label*="ock"]'));
  const accent = tok('--accent');
  const active = chips.filter(el => (hex(getComputedStyle(el).backgroundColor) || '') === accent);
  const c20 = { n: locked.length, labels: locked.map(txt) };
  const c21 = { n: active.length, labels: active.map(txt) };
  const c23 = /need\s*pro/i.test(document.body.innerText || '');

  /* C24/C25/C26 — absent, not hidden. Node count, per the criterion. */
  const c24 = document.querySelectorAll('[data-layout="mobile"]').length;
  const c25 = document.querySelectorAll('[class*="klc-"], [class*="KLinePro"]').length
    ? [...document.querySelectorAll('*')].filter(e => /klc-root|klc-container/.test((e.className || '').toString())).length
    : -1;

  /* ── Q1-Q4: QA's, not the spec's. Ported from the landing suite after the
     owner found three defects by opening the page that a 20/21 score had
     missed. Labelled Q so a report never confuses them with arena.md's
     criteria. ── */

  /* Q1 — what the page PAINTS, not what :root declares. On landing (#595)
     --bg0 and --accent were both correct at the root and the page ignored
     both, so any getPropertyValue assertion passed. */
  const q1 = { tokenBg: tok('--bg0'), paintedBg: hex(getComputedStyle(document.body).backgroundColor) };

  /* Q2 — text wider than its own box. Bounding-box intersection cannot find
     this: on /dashboard the price element's box did not intersect its
     neighbour's, yet the string painted 40px across it, and page-level
     horizontal overflow was 0 at the same moment. */
  const q2 = [];
  document.querySelectorAll('body *').forEach(e => {
    if (e.children.length) return;
    const t = txt(e); if (t.length < 2) return;
    const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    const over = e.scrollWidth - e.clientWidth;
    if (over > 1) q2.push({ t: t.slice(0, 22), box: Math.round(r.width),
      needs: e.scrollWidth, over, escapes: getComputedStyle(e).overflowX === 'visible' });
  });

  /* Q3 — a band's children must fit inside it. C7 asserts each band's own
     height; landing's nav was correctly 52 while its child rendered 55. Arena
     has six fixed-height bands, so this is six chances at the same defect. */
  const q3 = [];
  regions.forEach((band, i) => {
    const br = band.getBoundingClientRect();
    if (br.height < 20 || br.height > 200) return;   // flex bands have no fixed height to violate
    [...band.querySelectorAll('a, button, span, div')].forEach(e => {
      if (!vis(e)) return;
      const er = e.getBoundingClientRect();
      const out = Math.max(br.top - er.top, er.bottom - br.bottom);
      if (out > 0.5) q3.push({ band: i, t: txt(e).slice(0, 14), h: Math.round(er.height),
                               bandH: Math.round(br.height), out: +out.toFixed(1) });
    });
  });

  /* Q4 — dev's own arena root-cause, generalised. `.at-chart` had a fixed
     430px height with no overflow rule, so the chart's price-tag overlays
     bled into the panels below (the garbled Market Structure the owner saw).
     Any fixed-height box whose content exceeds it and which does not clip is
     the same bug waiting to happen. */
  const q4 = [];
  document.querySelectorAll('body *').forEach(e => {
    if (!vis(e)) return;
    const s = getComputedStyle(e);
    if (s.overflowY !== 'visible') return;
    if (!/^\d+(\.\d+)?px$/.test(s.height)) return;
    const spill = e.scrollHeight - e.clientHeight;
    if (spill > 2) q4.push({ cls: (e.className || '').toString().trim().split(/\s+/)[0] || e.tagName.toLowerCase(),
                             h: s.height, spill });
  });

  return { c1, c2, c6, c7, c8, c9, c10, c11, c16, c19, c20, c21, c23, c24, c25,
    q1, q2: q2.slice(0, 8), q3: q3.slice(0, 6), q4: q4.slice(0, 6),
    rootMissing: !root };
};

const MOBILE = () => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const Q = s => [...document.querySelectorAll(s)].filter(vis);
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();

  /* C32 — mobile band geometry */
  const c32 = { nav: Q('nav, header')[0]?.offsetHeight ?? -1,
    tabbar: Q('.mobile-tab-bar, [class*="tab-bar"], [class*="tabbar"]')[0]?.offsetHeight ?? -1 };

  /* C33 — verdict 26px */
  const big = [...document.querySelectorAll('*')].filter(e => vis(e) && !e.children.length && txt(e).length > 1)
    .map(e => ({ px: parseFloat(getComputedStyle(e).fontSize), t: txt(e) }))
    .filter(x => x.px >= 20).sort((a, b) => b.px - a.px)[0];
  const c33 = big ? { px: big.px, text: big.t.slice(0, 24) } : null;

  /* C26 — rail absent in the DOM at 390, not merely hidden */
  const c26 = { aside: document.querySelectorAll('aside').length,
    railish: document.querySelectorAll('[class*="rail"]').length };

  /* C24 (other half) — desktop tree count 0 at 390 */
  const c24 = document.querySelectorAll('[data-layout="desktop"]').length;

  /* C35 — every control >=24x24, with SC 2.5.8's inline and spacing carve-outs
     left to qa/tap-targets.mjs; this is the blunt count. */
  const small = [];
  document.querySelectorAll('button, a[href], input, select, [role="button"]').forEach(el => {
    if (!vis(el)) return;
    const r = el.getBoundingClientRect();
    if (r.width < 24 || r.height < 24) {
      const inline = getComputedStyle(el).display.includes('inline') && el.closest('p, li, span');
      small.push({ cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
        size: `${Math.round(r.width)}x${Math.round(r.height)}`, inline: !!inline });
    }
  });
  const c35 = { total: small.length, nonInline: small.filter(s => !s.inline).length, sample: small.slice(0, 6) };

  /* Q2/Q4 at 390 — dashboard's price overflow only appears at mobile widths
     and worsens sharply below 390 (box 76 at 390, 43 at 320, for a string
     needing 116). Arena's snapshot band is denser than dashboard's coin row. */
  const q2 = [];
  document.querySelectorAll('body *').forEach(e => {
    if (e.children.length) return;
    const t = txt(e); if (t.length < 2) return;
    const r = e.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return;
    const over = e.scrollWidth - e.clientWidth;
    if (over > 1) q2.push({ t: t.slice(0, 22), box: Math.round(r.width),
      needs: e.scrollWidth, over, escapes: getComputedStyle(e).overflowX === 'visible' });
  });
  const q4 = [];
  document.querySelectorAll('body *').forEach(e => {
    if (!vis(e)) return;
    const s = getComputedStyle(e);
    if (s.overflowY !== 'visible') return;
    if (!/^\d+(\.\d+)?px$/.test(s.height)) return;
    const spill = e.scrollHeight - e.clientHeight;
    if (spill > 2) q4.push({ cls: (e.className || '').toString().trim().split(/\s+/)[0] || e.tagName.toLowerCase(),
                             h: s.height, spill });
  });

  return { c24, c26, c32, c33, c35, q2: q2.slice(0, 8), q4: q4.slice(0, 6) };
};

const browser = await chromium.launch();
const out = {};
for (const theme of THEMES) {
  out[theme] = {};
  for (const [vp, cfg, fn] of [['desktop', { viewport: { width: 1440, height: 900 } }, DESKTOP],
                               ['mobile', { ...devices['iPhone 13'], viewport: { width: 390, height: 844 } }, MOBILE]]) {
    const ctx = await browser.newContext(cfg);
    await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, theme);
    const page = await ctx.newPage();
    page.on('pageerror', () => {});
    await page.goto(`${BASE}/arena?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    /* Arena is data-heavy and the qa tier is slow. A fixed sleep produced three
       consecutive wrong readings on /correlation; a bare "DOM stopped growing"
       poll halved coverage because two equal polls satisfy it mid-load. Floor,
       then three consecutive stable polls. */
    await page.waitForTimeout(6000);
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('body *').length;
      const s = (window.__s ||= { last: -1, stable: 0 });
      s.stable = n === s.last ? s.stable + 1 : 0; s.last = n;
      return n > 400 && s.stable >= 3;
    }, { timeout: 60000, polling: 1200 }).catch(() => {});
    out[theme][vp] = await page.evaluate(fn);
    await ctx.close();
  }
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, out }, null, 2)); process.exit(0); }

const V = (ok, s) => `${ok === null ? 'CHECK' : ok ? 'PASS ' : 'FAIL '} ${s}`;
const U = s => `UNVERIFIED  ${s}`;

for (const theme of THEMES) {
  const d = out[theme].desktop, m = out[theme].mobile;
  console.log(`\n## /arena vs specs/arena.md — ${theme}\n`);

  if (d.rootMissing) {
    console.log('CHECK  root container not found — every structural criterion below is a locator miss, not a verdict.\n');
  }

  console.log(V(d.c1.count === 7, `C1  7 top-level regions — ${d.c1.count} (${d.c1.tags.join(', ')})`));
  console.log(V(d.c2 === 352, `C2  rail offsetWidth 352 — ${d.c2}`));
  console.log(U('C3  main column 5 panels in order — needs the panel class hooks; add once the build names them'));
  console.log(U('C4  rail 5 panels in order — same'));
  console.log(U('C5  all 15 modules render for an entitled user — needs an entitled session'));
  console.log(V(d.c6.n === 0, `C6  radius 0 (circular <=24px exempt per radius-ruling.md) — ${d.c6.n} violations, ${d.c6.circular} exempt`));
  if (d.c6.n) console.log('      ' + d.c6.bad.join(' | '));

  console.log(V(d.c7.nav === 44, `C7  nav 44 — ${d.c7.nav}   [band heights: ${d.c7.regions.join(', ')}]`));
  console.log(V(d.c8 === 430, `C8  chart panel 430 — ${d.c8}`));
  console.log(V(d.c9 ? d.c9.px === 34 : null, `C9  verdict font 34px — ${d.c9 ? `${d.c9.px}px "${d.c9.text}" ${d.c9.colour}` : 'not found'}`));
  console.log(`      (C9's COLOUR half is fixture-gated — --green only under a bullish read)`);
  console.log(V(d.c10.n > 0 ? d.c10.heights.every(v => v === 28 || v === 30) : null,
    `C10 panel headers 30 body / 28 rail — ${d.c10.n} found, heights ${d.c10.heights.join('/')}`));
  console.log(V(d.c11 ? (Math.abs(d.c11.w - d.c11.inner) <= 1 && !d.c11.fixedPx) : null,
    `C11 verdict band full width, no fixed px — ${d.c11 ? `${d.c11.w} of ${d.c11.inner}, fixedPx=${d.c11.fixedPx}` : 'band not located'}`));

  console.log(U('C12 2 of 8 evidence rows fire — needs a stubbed read'));
  console.log(U('C13 FUNDING 8H red while positive — needs a stubbed read'));
  console.log(U('C14 bearish verdict keeps 34px and its box — needs a bearish fixture'));
  console.log(U('C15 null evidence row em-dashes in --txt2 — needs a fixture'));
  console.log(V(!d.c16, `C16 the string "Liq 24h" appears nowhere — ${d.c16 ? 'FOUND, must not appear' : 'absent'}`));
  console.log('      (C16\'s "CB PREM em-dashes under every fixture" half is fixture-gated)');
  console.log(U('C17 cleared penalties compute --txt3 and read CLEAR — needs a fixture'));
  console.log(U('C18 MTF neutral band 43<=rsi<=57 — needs a fixture'));
  console.log(V(d.c19.off.length === 0, `C19 palette only — ${d.c19.off.length} off-palette`));
  if (d.c19.off.length) console.log('      ' + d.c19.off.map(([c, n]) => `${c}x${n}`).join('  '));
  if (d.c19.translucent.length) console.log('      (skipped, translucent — judged by composited surface, not raw RGB: '
    + d.c19.translucent.map(([c, n]) => `${c}x${n}`).join('  ') + ')');

  const wantLocks = ['1m', '5m', '15m'];
  console.log(V(d.c20.n === 3 && wantLocks.every(l => d.c20.labels.some(x => x.toLowerCase().startsWith(l))),
    `C20 exactly 3 padlocked chips, labels 1m/5m/15m — ${d.c20.n}: ${d.c20.labels.join(' ')}`));
  console.log(V(d.c21.n === 1, `C21 exactly 1 chip on --accent — ${d.c21.n}: ${d.c21.labels.join(' ')}`));
  console.log(U('C22 clicking a gated chip opens the modal and does not switch — interaction, run separately'));
  console.log(V(d.c23, `C23 the row contains "NEED PRO" — ${d.c23 ? 'present' : 'absent'}`));

  console.log(V(d.c24 === 0, `C24 no [data-layout="mobile"] nodes at 1440 — ${d.c24}`));
  console.log(V(d.c25 === 1 ? true : (d.c25 === -1 ? null : false), `C25 exactly 1 chart instance — ${d.c25 === -1 ? 'no chart hook found' : d.c25}`));
  console.log('      (C25\'s "one candle subscription" half needs a network check, not the DOM)');

  console.log(V(m.c24 === 0, `C24b no [data-layout="desktop"] nodes at 390 — ${m.c24}`));
  console.log(V(m.c26.aside === 0, `C26 rail absent at 390 (not hidden) — ${m.c26.aside} aside, ${m.c26.railish} rail-ish`));
  console.log(V(m.c32.nav === 38, `C32 mobile nav 38 — ${m.c32.nav}   [tab bar ${m.c32.tabbar}, want 60]`));
  console.log(V(m.c33 ? m.c33.px === 26 : null, `C33 mobile verdict 26px — ${m.c33 ? `${m.c33.px}px "${m.c33.text}"` : 'not found'}`));
  console.log('      (26 is arena.md\'s own soft number — "ratio argument only, do not cite as measured")');
  console.log(U('C34 levels render as 3 cells in one row — needs the cell hook'));
  console.log(V(m.c35.nonInline === 0, `C35 controls >=24x24 — ${m.c35.nonInline} non-inline undersized of ${m.c35.total} total`));

  /* Q-criteria are QA's, not arena.md's. Each exists because a real defect
     scored clean: the owner found three on landing and dashboard that a
     20/21 and a 5/5 had both missed. */
  console.log(V(d.q1.paintedBg === d.q1.tokenBg, `Q1  ground paints --bg0 — token ${d.q1.tokenBg}, painted ${d.q1.paintedBg}`));
  console.log(V(d.q2.length === 0, `Q2  no text wider than its own box — ${d.q2.length}`));
  d.q2.forEach(x => console.log(`      "${x.t}" box ${x.box} needs ${x.needs} (+${x.over}${x.escapes ? ', ESCAPES — paints outside' : ', clipped'})`));
  console.log(V(d.q3.length === 0, `Q3  every band's children fit the band — ${d.q3.length} overflowing`));
  d.q3.forEach(x => console.log(`      band ${x.band} "${x.t}" ${x.h}px in ${x.bandH}px, out by ${x.out}`));
  console.log(V(d.q4.length === 0, `Q4  no fixed-height box spills unclipped — ${d.q4.length}`));
  d.q4.forEach(x => console.log(`      .${x.cls} height ${x.h}, content spills ${x.spill}px, overflow-y visible`));

  const mq2 = m.q2 || [], mq4 = m.q4 || [];
  console.log(V(mq2.length === 0, `Q2m mobile: no text wider than its own box — ${mq2.length}`));
  mq2.forEach(x => console.log(`      "${x.t}" box ${x.box} needs ${x.needs} (+${x.over}${x.escapes ? ', ESCAPES' : ', clipped'})`));
  console.log(V(mq4.length === 0, `Q4m mobile: no fixed-height box spills unclipped — ${mq4.length}`));
  mq4.forEach(x => console.log(`      .${x.cls} height ${x.h}, spills ${x.spill}px`));
  if (m.c35.nonInline) console.log('      ' + m.c35.sample.filter(s => !s.inline).map(s => `${s.cls} ${s.size}`).join(' | '));
}

console.log(`
UNVERIFIED is not a pass. Criteria 12-18 describe a stubbed read and cannot be
scored from a live page: a market shows one arbitrary state, so "no violation
observed" is not "the rule holds". 27-30 need a signed-out free session — use
qa/gating-audit.mjs --free. 31 is a source lint. See #594 for the three
evidence rows that are permanently em-dashed by design.`);
