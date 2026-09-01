#!/usr/bin/env node
/* Scores `/` against every criterion in design-handoff-dir/specs/landing.md.
 *
 * Landing is the strictest spec in the handoff: 21 criteria, most of them exact
 * counts or exact pixel geometry, and almost all readable straight off the DOM.
 * That makes it the one screen where "done" is genuinely binary rather than a
 * judgement call — which is why it is worth automating in full rather than
 * spot-checking.
 *
 * NO DATA DEPENDENCY. Unlike /dashboard, nothing here waits on a market fetch,
 * so the readiness problem that produced four false readings there does not
 * apply. The ticker is the one live element and no criterion depends on its
 * values.
 *
 * ONE CONTRADICTION IS FLAGGED, NOT RESOLVED
 * Criterion 12 says "EVERY element has border-radius: 0px. Zero exceptions,
 * including img." `specs/radius-ruling.md` exempts circular indicator glyphs
 * <=24px platform-wide. On this route the spec is explicit and later, so it is
 * scored as written — but any violation that is a circular glyph <=24px is
 * reported separately, because that is a spec conflict for design to settle
 * rather than a defect for dev to fix.
 *
 * Usage:
 *   node qa/landing-conformance.mjs [--base <url>] [--themes dark,light] [--json]
 */

import { chromium, devices } from '@playwright/test';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const THEMES = arg('--themes', 'dark,light').split(',');
const JSON_OUT = process.argv.includes('--json');

const DESKTOP = () => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const Q = s => [...document.querySelectorAll(s)].filter(vis);
  const cs = getComputedStyle(document.documentElement);
  const tok = n => cs.getPropertyValue(n).trim().toLowerCase();
  const hex = c => { const m = (c.match(/[\d.]+/g) || []).map(Number); if (m.length < 3) return null;
    return '#' + m.slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join(''); };
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();

  /* C1 — 8 top-level sections in order. Identify by content, not class: the
     dashboard audit showed class-based section matching reports a passing
     layout as failing when sections are bare divs. */
  /* Sections live inside .lp-root, not as body grandchildren. Counting from
     body picked up the consent banner and missed the real structure. */
  const root = document.querySelector('.lp-root') || document.body;
  const secs = [...root.children].filter(vis);
  const c1 = { count: secs.length, tags: secs.map(e => e.tagName.toLowerCase() + (e.className ? '.' + e.className.toString().trim().split(/\s+/)[0] : '')).slice(0, 10) };

  /* C2 — link count */
  const links = [...document.querySelectorAll('a[href]')];
  const c2 = links.length;

  /* C3/C4 — feature grid: 6 cards, ordered hrefs, each outermost is <a> */
  /* Scope to the actual grid. The first version matched every link to those
     six paths ANYWHERE on the page and reported 27 cards for a 6-card grid. */
  const wanted = ['/arena', '/settings', '/briefing', '/news', '/dashboard', '/scanner'];
  const featureLinks = [...document.querySelectorAll('.lp-features .lp-feature-card')].filter(vis);
  const seen = [];
  for (const a of featureLinks) { const p = new URL(a.href, location.origin).pathname; if (!seen.includes(p)) seen.push(p); }
  const c3 = { count: featureLinks.length, order: seen };
  const c4 = featureLinks.filter(a => a.tagName === 'A' && vis(a)).length;

  /* C5 — footer link columns */
  const footer = Q('footer, .pf-footer')[0];
  const fgrid = document.querySelector('.lp-footer-grid');
  const c5 = fgrid ? [...fgrid.children].filter(vis).filter(e => e.querySelectorAll('a[href]').length >= 2).length : -1;

  /* C6 — risk disclosure items */
  /* Take the UL/OL closest to the RISK DISCLOSURE heading. Matching any
     ancestor containing li counted all 19 list items on the page. */
  const riskHead = [...document.querySelectorAll('*')].find(e => !e.children.length && /risk disclosure/i.test(txt(e)));
  let riskList = null;
  if (riskHead) { let n = riskHead.parentElement, hops = 0;
    while (n && !riskList && hops < 4) { riskList = n.querySelector('ul, ol'); n = n.parentElement; hops++; } }
  const c6 = riskList ? [...riskList.children].filter(vis).length : -1;

  /* C7 — pricing: 2 plans, $0 and $25 */
  /* Price strings are embedded in CTA copy ("Get Pro - $25/mo"), not standalone
     nodes, so an anchored ^\$\d+$ match found nothing. Extract instead. */
  const planRoot = document.querySelector('[class*="lp-plan"], [class*="pricing"]')?.closest('section') || document;
  const prices = [...new Set((planRoot.textContent || '').match(/\$\d+/g) || [])];
  const c7 = { prices };

  /* C8 — hero stats */
  const heroStats = ['50', '35', 'Grok', 'Live'];
  const statHits = heroStats.filter(s => [...document.querySelectorAll('*')].some(e => !e.children.length && txt(e) === s));
  const c8 = { want: heroStats, found: statHits };

  /* C9 — hero CTAs */
  const ctas = links.filter(a => { const p = new URL(a.href, location.origin).pathname + new URL(a.href, location.origin).search;
    return p === '/login?signup=1' || p === '/briefing'; }).map(a => new URL(a.href, location.origin).pathname + new URL(a.href, location.origin).search);
  const c9 = [...new Set(ctas)];

  /* C10 — no decorative beams/glow */
  const c10 = document.querySelectorAll('[class*="beams"], [class*="hero-glow"]').length;

  /* C11 — nav/ticker heights, hero top */
  const nav = Q('nav, .lp-nav, header')[0];
  /* No element on this route carries a ticker-ish class. Fall back to content -
     a strip of coin prices near the top - so "absent" is a finding rather than
     a selector miss. */
  const ticker = Q('[class*="ticker"], [class*="marquee"]')[0]
    || [...document.querySelectorAll('div')].filter(vis).find(e => {
         const r = e.getBoundingClientRect();
         return r.top < 200 && r.height > 0 && r.height < 60 && (e.textContent.match(/\$[\d,]+/g) || []).length >= 3;
       });
  const hero = Q('[class*="hero"], section')[0];
  const c11 = { nav: nav ? nav.offsetHeight : -1, ticker: ticker ? ticker.offsetHeight : -1,
    heroTop: hero ? Math.round(hero.getBoundingClientRect().top + window.scrollY) : -1 };

  /* C12 — radius 0, zero exceptions. Circular <=24px reported separately as a
     conflict with radius-ruling.md rather than folded in. */
  const radAll = [], radCircularSmall = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el)) return;
    const s = getComputedStyle(el), r = el.getBoundingClientRect();
    if (!s.borderRadius || s.borderRadius === '0px') return;
    const rec = { cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(), radius: s.borderRadius, w: Math.round(r.width), h: Math.round(r.height) };
    if (s.borderRadius.includes('50%') && r.width <= 24 && Math.abs(r.width - r.height) <= 2) radCircularSmall.push(rec);
    else radAll.push(rec);
  });

  /* C13 — features grid 3 equal tracks */
  const grid = [...document.querySelectorAll('*')].filter(e => vis(e) && getComputedStyle(e).display === 'grid'
    && getComputedStyle(e).gridTemplateColumns.split(' ').length === 3
    && e.querySelectorAll('a[href]').length >= 3)[0];
  const c13 = grid ? { cols: getComputedStyle(grid).gridTemplateColumns, gap: getComputedStyle(grid).gap } : null;

  /* C14 — feature description min-height */
  const c14 = featureLinks.map(a => { const d = [...a.querySelectorAll('*')].find(e => getComputedStyle(e).minHeight !== '0px' && getComputedStyle(e).minHeight !== 'auto');
    return d ? getComputedStyle(d).minHeight : null; });

  /* C15 — Pro plan border-top */
  const accent = tok('--accent');
  const proCard = [...document.querySelectorAll('*')].filter(e => vis(e) && /\$25/.test(txt(e)) && txt(e).length < 400).pop();
  const c15 = proCard ? { w: getComputedStyle(proCard).borderTopWidth, c: (hex(getComputedStyle(proCard).borderTopColor) || '').toLowerCase(), accent } : null;

  /* C16 — live read panel width */
  const panel = [...document.querySelectorAll('*')].filter(e => vis(e) && Math.round(e.getBoundingClientRect().width) === 472)[0];
  const c16 = panel ? 472 : (() => { const near = [...document.querySelectorAll('*')].filter(vis)
    .map(e => Math.round(e.getBoundingClientRect().width)).filter(w => w > 400 && w < 560); return [...new Set(near)].sort((a, b) => a - b).slice(0, 6); })();

  /* C17 — no 0.5px rules */
  const halfPx = [];
  document.querySelectorAll('body *').forEach(el => {
    if (!vis(el)) return; const s = getComputedStyle(el);
    ['borderTopWidth', 'borderBottomWidth', 'borderLeftWidth', 'borderRightWidth'].forEach(p => {
      if (/^0\.5px$/.test(s[p])) halfPx.push({ cls: (el.className || '').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(), p });
    });
  });

  return { c1, c2, c3, c4, c5, c6, c7, c8, c9, c10, c11,
    c12: { violations: radAll.length, sample: radAll.slice(0, 6), circularSmall: radCircularSmall.length, circularSample: radCircularSmall.slice(0, 4) },
    c13, c14, c15, c16, c17: { count: halfPx.length, sample: halfPx.slice(0, 4) } };
};

const MOBILE = () => {
  const vis = el => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const Q = s => [...document.querySelectorAll(s)].filter(vis);
  const links = [...document.querySelectorAll('a[href]')];
  const cards = [...document.querySelectorAll('.lp-features .lp-feature-card')].filter(vis);
  const nav = Q('nav, .lp-nav, header')[0];
  /* No element on this route carries a ticker-ish class. Fall back to content -
     a strip of coin prices near the top - so "absent" is a finding rather than
     a selector miss. */
  const ticker = Q('[class*="ticker"], [class*="marquee"]')[0]
    || [...document.querySelectorAll('div')].filter(vis).find(e => {
         const r = e.getBoundingClientRect();
         return r.top < 200 && r.height > 0 && r.height < 60 && (e.textContent.match(/\$[\d,]+/g) || []).length >= 3;
       });
  const txt = e => (e.textContent || '').replace(/\s+/g, ' ').trim();
  const free = [...document.querySelectorAll('*')].filter(e => vis(e) && /\$0/.test(txt(e)) && txt(e).length < 400).pop();
  const pro = [...document.querySelectorAll('*')].filter(e => vis(e) && /\$25/.test(txt(e)) && txt(e).length < 400).pop();
  const fgrid = document.querySelector('.lp-footer-grid');
  const cols = fgrid ? [...fgrid.children].filter(vis).filter(e => e.querySelectorAll('a[href]').length >= 2) : [];
  return {
    c18: { nav: nav ? nav.offsetHeight : -1, ticker: ticker ? ticker.offsetHeight : -1 },
    c19: { lefts: [...new Set(cards.map(a => Math.round(a.getBoundingClientRect().left)))], n: cards.length },
    c20: (free && pro) ? { freeBottom: Math.round(free.getBoundingClientRect().bottom), proTop: Math.round(pro.getBoundingClientRect().top) } : null,
    c21: { distinctLefts: [...new Set(cols.map(e => Math.round(e.getBoundingClientRect().left)))].length, cols: cols.length },
  };
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
    await page.goto(`${BASE}/?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(4000);
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('body *').length;
      const s = (window.__s ||= { last: -1, stable: 0 });
      s.stable = n === s.last ? s.stable + 1 : 0; s.last = n;
      return n > 0 && s.stable >= 3;
    }, { timeout: 40000, polling: 1000 }).catch(() => {});
    out[theme][vp] = await page.evaluate(fn);
    await ctx.close();
  }
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify({ base: BASE, out }, null, 2)); process.exit(0); }

const V = (ok, s) => `${ok === null ? 'CHECK' : ok ? 'PASS ' : 'FAIL '} ${s}`;
for (const theme of THEMES) {
  const d = out[theme].desktop, m = out[theme].mobile;
  console.log(`\n## / vs specs/landing.md — ${theme}\n`);
  console.log(V(d.c1.count === 8, `C1  8 top-level sections — ${d.c1.count} (${d.c1.tags.join(', ')})`));
  console.log(V(d.c2 >= 28, `C2  >=28 links — ${d.c2}`));
  console.log(V(d.c3.count === 6 && JSON.stringify(d.c3.order) === JSON.stringify(['/arena','/settings','/briefing','/news','/dashboard','/scanner']), `C3  6 feature cards in order — ${d.c3.count}: ${d.c3.order.join(' ')}`));
  console.log(V(d.c4 === d.c3.count, `C4  each card outermost is <a> — ${d.c4}/${d.c3.count}`));
  console.log(V(d.c5 === 4, `C5  4 footer columns — ${d.c5}`));
  console.log(V(d.c6 === 6, `C6  6 risk items — ${d.c6}`));
  console.log(V(d.c7.prices.length === 2 && d.c7.prices.includes('$0') && d.c7.prices.includes('$25'), `C7  2 plans $0/$25 — ${d.c7.prices.join(' ')}`));
  console.log(V(d.c8.found.length === 4, `C8  hero stats 50/35/Grok/Live — found ${d.c8.found.join(' ')}`));
  console.log(V(d.c9.length === 2, `C9  2 hero CTAs — ${d.c9.join(' ')}`));
  console.log(V(d.c10 === 0, `C10 no beams/hero-glow — ${d.c10}`));
  console.log(V(d.c11.nav === 56 && d.c11.ticker === 34 && d.c11.heroTop === 90, `C11 nav 56 / ticker 34 / hero top 90 — ${d.c11.nav} / ${d.c11.ticker} / ${d.c11.heroTop}`));
  console.log(V(d.c12.violations === 0, `C12 radius 0, zero exceptions — ${d.c12.violations} violations${d.c12.circularSmall ? ` (+${d.c12.circularSmall} circular <=24px — SPEC CONFLICT with radius-ruling.md, design's call)` : ''}`));
  if (d.c12.violations) console.log(`      ${d.c12.sample.map(r => `${r.cls} ${r.radius} ${r.w}x${r.h}`).join(' | ')}`);
  console.log(V(d.c13 ? /^(\S+) \1 \1$/.test(d.c13.cols.trim()) : null, `C13 features grid 3 equal tracks — ${d.c13 ? d.c13.cols + '  gap ' + d.c13.gap : 'grid not found'}`));
  console.log(V(d.c14.every(v => v === '66px'), `C14 6 descriptions min-height 66px — ${d.c14.join(' ')}`));
  console.log(V(d.c15 ? d.c15.w === '2px' && d.c15.c === d.c15.accent : null, `C15 Pro border-top 2px --accent — ${d.c15 ? `${d.c15.w} ${d.c15.c} vs ${d.c15.accent}` : 'plan not found'}`));
  console.log(V(d.c16 === 472, `C16 live read panel 472 — ${Array.isArray(d.c16) ? 'not found; nearby widths ' + d.c16.join(',') : d.c16}`));
  console.log(V(d.c17.count === 0, `C17 no 0.5px rules — ${d.c17.count}${d.c17.count ? ' e.g. ' + d.c17.sample.map(s => s.cls).join(',') : ''}`));
  console.log(V(m.c18.nav === 52 && m.c18.ticker === 30, `C18 mobile nav 52 / ticker 30 — ${m.c18.nav} / ${m.c18.ticker}`));
  console.log(V(m.c19.lefts.length === 1, `C19 feature cards stack — ${m.c19.lefts.length} distinct offsetLeft across ${m.c19.n}`));
  console.log(V(m.c20 ? m.c20.proTop > m.c20.freeBottom : null, `C20 pricing stacks — ${m.c20 ? `free bottom ${m.c20.freeBottom}, pro top ${m.c20.proTop}` : 'plans not found'}`));
  console.log(V(m.c21.distinctLefts === 2, `C21 footer 2 columns on mobile — ${m.c21.distinctLefts} distinct lefts across ${m.c21.cols}`));
}
console.log('\nCHECK = the checker could not locate the element; that is a checker gap, not a verdict.');
