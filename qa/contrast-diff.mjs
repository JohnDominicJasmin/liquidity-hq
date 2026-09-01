#!/usr/bin/env node
/* Names the elements failing contrast on one route, so a rise in the count can
 * be attributed rather than guessed at.
 *
 * The platform audit reports a number. A number going up does not say whether a
 * fix caused it or merely exposed something that was already wrong — after
 * #560, dark contrast failures went 116 -> 210 while off-palette dropped 45%,
 * and the plausible story (gold tints contrast worse than the blue they
 * replaced) is a hypothesis, not a finding. This prints the actual elements and
 * their colours so the question is answerable from evidence.
 *
 * Usage: node qa/contrast-diff.mjs <url> [--theme dark|light]
 */

import { chromium, devices } from '@playwright/test';

const url = process.argv[2];
if (!url) { console.error('usage: node qa/contrast-diff.mjs <url> [--theme dark|light]'); process.exit(1); }
const theme = process.argv.includes('--theme') ? process.argv[process.argv.indexOf('--theme') + 1] : 'dark';

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(t => { try { localStorage.setItem('theme', t); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} }, theme);
const page = await ctx.newPage();
await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
await page.waitForFunction(() => {
  const g = [...document.querySelectorAll('.dashboard-grid')];
  if (!g.length) return true;
  return g.filter(x => x.getBoundingClientRect().width > 0).length === 1;
}, { timeout: 120000 }).catch(() => {});
await page.waitForTimeout(6000);

const out = await page.evaluate(() => {
  const parse = c => { const m=(c.match(/[\d.]+/g)||[]).map(Number); return m.length?{r:m[0],g:m[1],b:m[2],a:m.length>3?m[3]:1}:null; };
  const over = (f,b) => ({r:f.r*f.a+b.r*(1-f.a),g:f.g*f.a+b.g*(1-f.a),b:f.b*f.a+b.b*(1-f.a),a:1});
  const lum = c => { const f=v=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);}; return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b); };
  const cr = (a,b) => { const l1=lum(a),l2=lum(b); return (Math.max(l1,l2)+0.05)/(Math.min(l1,l2)+0.05); };
  const hx = c => '#'+[c.r,c.g,c.b].map(v=>Math.round(v).toString(16).padStart(2,'0')).join('');
  const bgOf = el => { const L=[]; let p=el;
    while(p){const c=parse(getComputedStyle(p).backgroundColor); if(c&&c.a>0){L.push(c); if(c.a===1)break;} p=p.parentElement;}
    let base=L.length&&L[L.length-1].a===1?L.pop():{r:0,g:0,b:0,a:1};
    for(let i=L.length-1;i>=0;i--) base=over(L[i],base); return base; };

  const isChrome = el => !!el.closest('.nav-menu, .gchat-panel, .app-bar, .nav-drawer, .pf-footer, .mobile-tab-bar');
  const fails = [];
  document.querySelectorAll('body *').forEach(el => {
    if (el.children.length) return;
    const r = el.getBoundingClientRect(); if (r.width < 1 || r.height < 1) return;
    if (isChrome(el)) return;
    const t = (el.textContent || '').trim(); if (!t || t.length > 60) return;
    const s = getComputedStyle(el);
    const px = parseFloat(s.fontSize), bold = parseInt(s.fontWeight) >= 700;
    const need = (px>=24 || (px>=18.66&&bold)) ? 3 : 4.5;
    const fg = parse(s.color); if (!fg) return;
    const bg = bgOf(el);
    const ratio = cr(over(fg,bg), bg);
    if (ratio >= need) return;
    fails.push({
      cls: (el.className||'').toString().trim().split(/\s+/)[0] || el.tagName.toLowerCase(),
      text: t.slice(0, 22),
      fg: hx(over(fg,bg)),
      bg: hx(bg),
      ratio: +ratio.toFixed(2),
      need,
      px: s.fontSize,
    });
  });
  /* Group by class + colour pair — 210 failures is rarely 210 causes. */
  const groups = {};
  fails.forEach(f => {
    const k = `${f.cls}|${f.fg}|${f.bg}`;
    if (!groups[k]) groups[k] = { ...f, count: 0, samples: [] };
    groups[k].count++;
    if (groups[k].samples.length < 2) groups[k].samples.push(f.text);
  });
  return {
    total: fails.length,
    distinctCauses: Object.keys(groups).length,
    groups: Object.values(groups).sort((a,b)=>b.count-a.count).slice(0, 14)
      .map(g => ({ cls: g.cls, fg: g.fg, bg: g.bg, ratio: g.ratio, need: g.need, px: g.px, count: g.count, eg: g.samples.join(' / ') })),
  };
});

console.log(JSON.stringify({ url, theme, ...out }, null, 2));
await browser.close();
