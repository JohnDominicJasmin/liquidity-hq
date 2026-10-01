#!/usr/bin/env node
/* Layout diff: text being present is not layout being correct (#1487).
 *
 * On 2026-09-30 a page hint landed inside the dashboard's two-column grid, took
 * the wide column, and squeezed the whole dashboard into the 360px rail. Every
 * check that night read page text and status codes, and all the text was
 * there. This tool measures geometry instead, so the same seat can see the
 * difference before a PR is opened (ai-team-os/08-quality-checks.md).
 *
 * TWO STEPS, so base and branch never need to be served at the same time:
 *
 *   node scripts/layout-diff.mjs measure --url <origin> --out <dir> [--routes /a,/b] [--widths 1280,1440,1920,390] [--lang ru]
 *   node scripts/layout-diff.mjs diff <baseDir> <headDir> [--md <report.md>]
 *
 * `measure` loads each route signed out (analytics consent denied, first-run
 * tour marked seen), waits for the page to settle, and records per width:
 *   - boxes: every element up to 3 levels below the main content (and below
 *     the top nav, header.tnav) that is at least 100px wide, keyed by its
 *     class path (x, y, width, height);
 *   - overflow: every element on the page whose text is cut off (scrollWidth >
 *     clientWidth with overflow hidden or clip), with the text it holds;
 *   - pageScroll: whether the page scrolls sideways;
 *   - hint: where [data-page-hint] sits and what its parent does with it;
 *   - a screenshot of the first screen.
 * It writes <dir>/layout.json plus the PNGs. It is read-only: GET requests only,
 * nothing clicked. Point it at a server you started, or at a deployed site.
 *
 * `diff` compares two measurements and lists, per route and width:
 *   - boxes whose x or width moved by more than 2px, or that exist on one side only;
 *   - text cut off on the head side that was not cut off on the base side;
 *   - a page that newly scrolls sideways;
 *   - a hint that takes a grid track or sits in a row flex container.
 * Height and y changes are not flagged: live data changes them between runs.
 * It exits 1 when anything is flagged, so a clean run means something.
 *
 * Live data differs between two runs, so read a flagged box before calling it
 * a defect; a flagged cut-off value or a column that moved is almost never noise.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const DEFAULT_ROUTES = ['/dashboard', '/news', '/alerts', '/settings', '/calc', '/econ-calendar', '/hours', '/playbook', '/scanner', '/upgrade', '/zz-layout-diff-404'];
const DEFAULT_WIDTHS = [1280, 1440, 1920, 390];

function arg(args, name, fallback) {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
}

async function measure(args) {
  const origin = arg(args, '--url');
  const out = arg(args, '--out');
  if (!origin || !out) throw new Error('measure needs --url <origin> and --out <dir>');
  const routes = arg(args, '--routes', DEFAULT_ROUTES.join(',')).split(',');
  const widths = arg(args, '--widths', DEFAULT_WIDTHS.join(',')).split(',').map(Number);
  // --lang ko|zh|ru: the in-app language (the label locale), for checking a
  // translation's fit. The landing page follows its URL (/ko, /zh) instead.
  const lang = arg(args, '--lang', null);
  const require = createRequire(path.join(process.cwd(), 'package.json'));
  const { chromium } = require('playwright');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch();
  const pages = [];
  try {
    for (const route of routes) {
      for (const width of widths) {
        const ctx = await browser.newContext({ viewport: { width, height: 1000 }, colorScheme: 'dark' });
        await ctx.addInitScript((l) => {
          try {
            localStorage.setItem('lhq_analytics_consent_v1', 'denied');
            localStorage.setItem('lhq_tour_seen', '1');
            if (l) localStorage.setItem('lhq_lang_v1', l);
          } catch { /* storage unavailable */ }
        }, lang);
        const page = await ctx.newPage();
        const res = await page.goto(origin + route, { waitUntil: 'domcontentloaded', timeout: 240_000 });
        await page.waitForLoadState('networkidle', { timeout: 20_000 }).catch(() => {});
        await page.waitForTimeout(1500);
        await page.addStyleTag({ content: 'nextjs-portal{display:none!important}' });
        const m = await page.evaluate(() => {
          const root = document.querySelector('.app-content') || document.querySelector('main') || document.body;
          const cls = (el) => (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : el.tagName.toLowerCase());
          const r = (el) => { const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
          const boxes = {};
          const walk = (el, key, depth) => {
            if (depth > 3) return;
            const seen = {};
            for (const child of el.children) {
              /* The hint is recorded on its own below. Skipping it here keeps
                 every sibling's key the same whether a page has a hint or not,
                 so adding one does not read as the whole page moving. */
              if (child.hasAttribute('data-page-hint')) continue;
              const c = cls(child);
              seen[c] = (seen[c] ?? 0) + 1;
              const k = `${key} > ${c}${seen[c] > 1 ? `[${seen[c]}]` : ''}`;
              const b = r(child);
              if (b.w >= 100) boxes[k] = b;
              walk(child, k, depth + 1);
            }
          };
          walk(root, cls(root), 1);
          /* The top nav sits outside the main content, and a nav that does not
             fit is exactly the kind of layout defect this tool exists for. */
          const nav = document.querySelector('header.tnav');
          if (nav) { boxes['header.tnav'] = r(nav); walk(nav, 'header.tnav', 1); }
          const overflow = [];
          for (const el of document.body.querySelectorAll('*')) {
            if (!el.childElementCount && el.textContent && el.textContent.trim() && el.scrollWidth > el.clientWidth + 1) {
              const s = getComputedStyle(el);
              // clientWidth > 1: a visually hidden (.sr-only) element is 1px by design.
              if (/hidden|clip/.test(s.overflowX) && el.clientWidth > 1) overflow.push({ el: cls(el), text: el.textContent.trim().slice(0, 60), sw: el.scrollWidth, cw: el.clientWidth });
            }
          }
          let hint = null;
          const h = document.querySelector('[data-page-hint]');
          if (h) {
            const p = h.parentElement, ps = getComputedStyle(p), hs = getComputedStyle(h);
            const tracks = ps.display.includes('grid') ? ps.gridTemplateColumns.split(' ').length : 1;
            const spans = /-1|span/.test(hs.gridColumn);
            hint = { key: h.dataset.pageHint, ...r(h), parent: cls(p), display: ps.display, tracks, spans, rowFlex: ps.display.includes('flex') && !ps.flexDirection.startsWith('column') };
          }
          /* The language the page actually rendered in, not the one asked for:
             an unoffered --lang value renders English (QA, #1497). */
          const htmlLang = document.documentElement.lang || null;
          /* Nav items ending past the page edge. Recorded as a fact, so an
             overflow that is the same on both builds still shows in the diff. */
          let navPastViewport = null;
          if (nav) {
            const right = Math.max(...[...nav.querySelectorAll('*')].map((e) => e.getBoundingClientRect().right));
            if (right > window.innerWidth + 1) navPastViewport = Math.round(right);
          }
          return { boxes, overflow, pageScroll: document.documentElement.scrollWidth > window.innerWidth + 1, hint, htmlLang, navPastViewport };
        });
        const shot = `${route.replace(/[^\w-]+/g, '_').replace(/^_|_$/g, '') || 'root'}-${width}.png`;
        await page.screenshot({ path: path.join(out, shot) });
        pages.push({ route, width, status: res?.status() ?? null, shot, ...m });
        console.log(`${route} @${width}: status ${res?.status()} boxes ${Object.keys(m.boxes).length} cut-off ${m.overflow.length}${m.pageScroll ? ' SIDE-SCROLL' : ''}${m.hint ? ` hint in ${m.hint.display} (${m.hint.tracks} tracks)` : ''}`);
        await ctx.close();
      }
    }
  } finally {
    await browser.close();
    fs.writeFileSync(path.join(out, 'layout.json'), JSON.stringify({ origin, lang, measuredAt: new Date().toISOString(), pages }, null, 2));
  }
}

function diff(args) {
  const [baseDir, headDir] = args;
  if (!baseDir || !headDir) throw new Error('diff needs <baseDir> <headDir>');
  const load = (d) => JSON.parse(fs.readFileSync(path.join(d, 'layout.json'), 'utf8'));
  const base = load(baseDir), head = load(headDir);
  const langOf = (m) => [...new Set(m.pages.map((p) => p.htmlLang ?? m.lang ?? '?'))].join(',');
  const lines = [`# Layout diff`, ``, `base: ${base.origin} (${base.measuredAt}), rendered lang ${langOf(base)}`, `head: ${head.origin} (${head.measuredAt}), rendered lang ${langOf(head)}`, ``];
  let flagged = 0;
  /* Two different languages make every translated box read as moved (QA, #1497). */
  if (langOf(base) !== langOf(head)) {
    flagged += 1;
    lines.push(`## Language mismatch: base rendered ${langOf(base)}, head rendered ${langOf(head)} - compare like with like`, '');
  }
  for (const hp of head.pages) {
    const bp = base.pages.find((p) => p.route === hp.route && p.width === hp.width);
    const issues = [];
    if (!bp) issues.push('no base measurement');
    else {
      for (const [k, hb] of Object.entries(hp.boxes)) {
        const bb = bp.boxes[k];
        if (!bb) { if (hb.w >= 200) issues.push(`new box ${k} (x=${hb.x} w=${hb.w})`); continue; }
        if (Math.abs(hb.x - bb.x) > 2 || Math.abs(hb.w - bb.w) > 2) issues.push(`moved ${k}: x ${bb.x}->${hb.x}, w ${bb.w}->${hb.w}`);
      }
      for (const [k, bb] of Object.entries(bp.boxes)) if (!hp.boxes[k] && bb.w >= 200) issues.push(`gone ${k} (was x=${bb.x} w=${bb.w})`);
      const baseCut = new Set(bp.overflow.map((o) => `${o.el}|${o.text}`));
      for (const o of hp.overflow) if (!baseCut.has(`${o.el}|${o.text}`)) issues.push(`cut off: ${o.el} "${o.text}" (${o.sw}px in ${o.cw}px)`);
      if (hp.pageScroll && !bp.pageScroll) issues.push('page now scrolls sideways');
      if (bp.htmlLang && hp.htmlLang && bp.htmlLang !== hp.htmlLang) issues.push(`rendered in ${hp.htmlLang}, base in ${bp.htmlLang}`);
    }
    if (hp.navPastViewport) issues.push(`top nav ends at ${hp.navPastViewport}px on a ${hp.width}px page${bp?.navPastViewport ? ' (base too)' : ''}`);
    if (hp.hint && ((hp.hint.tracks > 1 && !hp.hint.spans) || hp.hint.rowFlex)) issues.push(`hint "${hp.hint.key}" takes a slot in ${hp.hint.parent} (${hp.hint.display}, ${hp.hint.tracks} tracks)`);
    flagged += issues.length;
    lines.push(`## ${hp.route} @ ${hp.width}px: ${issues.length ? `${issues.length} flagged` : 'no change'}`);
    for (const i of issues.slice(0, 40)) lines.push(`- ${i}`);
    if (issues.length > 40) lines.push(`- ...and ${issues.length - 40} more`);
    lines.push('');
  }
  /* An empty or partial head must never read as clean: a measure run that
     crashed on its first route would otherwise diff to "0 flagged". */
  const headKeys = new Set(head.pages.map((p) => `${p.route}@${p.width}`));
  const missing = base.pages.filter((p) => !headKeys.has(`${p.route}@${p.width}`));
  if (!head.pages.length || missing.length) {
    flagged += Math.max(1, missing.length);
    lines.push(`## Not measured on head: ${head.pages.length ? missing.map((p) => `${p.route} @ ${p.width}px`).join(', ') : 'every page (the head measurement is empty)'}`, '');
  }
  lines.push(`**Total flagged: ${flagged}.**`);
  const md = lines.join('\n');
  const mdPath = arg(args, '--md');
  if (mdPath) fs.writeFileSync(mdPath, md);
  console.log(md);
  process.exitCode = flagged ? 1 : 0;
}

const [cmd, ...rest] = process.argv.slice(2);
if (cmd === 'measure') await measure(rest);
else if (cmd === 'diff') diff(rest);
else {
  console.error('usage: layout-diff.mjs measure --url <origin> --out <dir> [--routes ...] [--widths ...]\n       layout-diff.mjs diff <baseDir> <headDir> [--md <file>]');
  process.exitCode = 2;
}
