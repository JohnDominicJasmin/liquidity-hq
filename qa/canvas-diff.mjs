#!/usr/bin/env node
/* Compares each live route against ITS DESIGN CANVAS, not against itself.
 *
 * WHY THIS EXISTS — the failure it is fixing
 * -----------------------------------------
 * `spec-conformance.mjs` derived its expected sections by reading the RENDERED
 * PAGE: the C1 checks searched for "market read", "best setup", "coin signals"
 * — strings taken off the implementation. So it confirmed the page matched
 * itself and passed while `/dashboard` was structurally nothing like
 * `Dashboard 2a.dc.html`. A test whose expectations come from the thing under
 * test cannot fail.
 *
 * Everything colour/contrast/radius that passed today was measured on the wrong
 * layout. This script exists so that can never be the shape of the answer again.
 *
 * WHAT IT DOES
 * Pulls every STATIC label out of a canvas (skipping `{{ handlebars }}`, which
 * are data placeholders, not design), then reports which of those labels the
 * live route does not render. Absence of a designed label is the cheapest
 * reliable signal that a section is missing or renamed.
 *
 * WHAT IT DELIBERATELY DOES NOT CLAIM
 * A label present is NOT proof the section matches — arrangement, geometry and
 * component treatment are not checked here. This finds missing and renamed
 * things. It cannot find "present but built differently", which is most of the
 * `/dashboard` gap. Treat a clean result as "nothing obviously absent", never
 * as "matches the design".
 *
 * Usage:
 *   node qa/canvas-diff.mjs                    # every mapped route
 *   node qa/canvas-diff.mjs --route /dashboard
 *   node qa/canvas-diff.mjs --json
 */

import { chromium } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';

const arg = (n, d) => { const i = process.argv.indexOf(n); return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : d; };
const BASE = arg('--base', 'https://liquidity-hq-qa.onrender.com').replace(/\/$/, '');
const ONLY = arg('--route', '');
const JSON_OUT = process.argv.includes('--json');
const DIR = 'design-handoff-dir/design_files';

/* canvas file (minus .dc.html) -> route */
const MAP = {
  'Dashboard 2a': '/dashboard', 'Arena 1a': '/arena', 'Landing 7a': '/',
  'Alerts': '/alerts', 'Briefing': '/briefing', 'Calculator': '/calc',
  'Economic Calendar': '/econ-calendar', 'FAQ': '/faq', 'Funding': '/funding',
  'Journal': '/journal', 'Learn': '/learn', 'Liquidation Map': '/liq',
  'Markets': '/markets', 'News': '/news', 'Offline': '/offline',
  'About': '/about', 'Disclaimer': '/disclaimer',
  'Research': '/research', 'Settings': '/settings', 'Setup Scanner': '/scanner',
  'Playbook': '/playbook', 'Trading Hours': '/hours', 'Upgrade': '/upgrade',
  'Privacy': '/privacy', 'Terms': '/terms', 'Refunds': '/refund',
  'Login - Forgot Password': '/login', 'Reset Password': '/reset-password',
};

/* Labels that are canvas chrome rather than product copy. */
const IGNORE = /^(2A|1A|7A|DESK|LONDON|NEW YORK|TOKYO|✕|→|←|▲|▼|·|\.|,|\d+|[A-Z]|⌘K|J)$/;

/* SAMPLE DATA IS NOT DESIGN. A canvas is populated with mock values - prices,
   percentages, clock times, dates, frame markers - and a live page rendering
   real data will never contain them. Counting those as "missing" inflates the
   gap and is the same overstatement as counting instances instead of
   components. Structural labels only. */
const SAMPLE = [
  /^[\d,]+(\.\d+)?$/,                    // 115,284  ·  115,284.50
  /^[+−-]?[\d.]+%$/,                  // +1.42%  ·  -0.04%
  /^\$[\d,]+(\.\d+)?$/,                  // $115,284.50
  /^[+−-]?[\d.]+R$/,                  // +1.6R
  /^\d{1,2}:\d{2}( UTC)?$/,               // 11:42 UTC
  /^\d{1,2} [A-Z][a-z]{2}( \d{4})?$/,     // 14 Aug 2026
  /^>?[0-9]+[A-Z]$/,                       // >2A frame marker
  /^(E|S|T|FC|PREV) [\d,]+(\.\d+)?%?$/,   // E 114,820  ·  FC 2.9%
  /\d{1,2}h \d{1,2}m/,                // LONDON · 2h 14m
  /^\d+ ?(TERMS|Q|PERPS|STORIES)/i,        // 42 TERMS · 18 Q
];
const isSample = t => SAMPLE.some(re => re.test(t));

function canvasLabels(file) {
  let s = readFileSync(file, 'utf8');
  s = s.replace(/<(script|style|helmet)[^>]*>[\s\S]*?<\/\1>/g, '');
  /* Drop the annotation preamble: everything before the first frame marker is
     the designer's note to us, not screen content. */
  const cut = s.search(/>(2A|1A|7A)</);
  if (cut > 0) s = s.slice(cut);
  const raw = s.split(/<[^>]+>/).map(t => t.trim()).filter(Boolean);
  const out = [];
  for (const t of raw) {
    if (t.includes('{{')) continue;            // data placeholder, not design
    if (t.length < 3 || t.length > 44) continue;
    if (IGNORE.test(t)) continue;
    if (/^https?:/.test(t)) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out;
}

const files = readdirSync(DIR).filter(f => f.endsWith('.dc.html') && !f.includes('-light-theme'));
const jobs = [];
for (const f of files) {
  const key = f.replace('.dc.html', '');
  const route = MAP[key];
  if (!route) continue;
  if (ONLY && route !== ONLY) continue;
  jobs.push({ key, route, file: `${DIR}/${f}` });
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq-design-mode', 'terminal'); } catch {} });
const page = await ctx.newPage();
page.on('pageerror', () => {});

const results = [];
for (const j of jobs) {
  const labels = canvasLabels(j.file);
  let live = '';
  try {
    await page.goto(`${BASE}${j.route}?design=terminal`, { waitUntil: 'domcontentloaded', timeout: 90000 });
    await page.waitForTimeout(6000);
    await page.waitForFunction(() => {
      const n = document.querySelectorAll('body *').length;
      const s = (window.__s ||= { last: -1, stable: 0 });
      s.stable = n === s.last ? s.stable + 1 : 0; s.last = n;
      return n > 0 && s.stable >= 3;
    }, { timeout: 40000, polling: 1200 }).catch(() => {});
    live = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
  } catch (e) {
    results.push({ ...j, error: String(e.message || e).slice(0, 60) });
    continue;
  }
  const norm = live.toLowerCase();
  const missingAll = labels.filter(l => !norm.includes(l.toLowerCase()));
  const missing = missingAll.filter(l => !isSample(l));
  const structural = labels.filter(l => !isSample(l));
  results.push({ ...j, total: structural.length, missing, sampleSkipped: missingAll.length - missing.length });
  if (!JSON_OUT) process.stderr.write(`  ${j.route} ${labels.length - missing.length}/${labels.length}\n`);
}
await browser.close();

if (JSON_OUT) { console.log(JSON.stringify(results, null, 2)); process.exit(0); }

console.log('\n# Canvas vs live — designed labels the route does not render\n');
console.log('A label present is NOT proof the section matches. This finds ABSENT and');
console.log('RENAMED things only; "present but built differently" is invisible here.\n');
const sorted = results.filter(r => !r.error).sort((a, b) => (b.missing.length / b.total) - (a.missing.length / a.total));
for (const r of sorted) {
  const pct = Math.round(100 * (r.total - r.missing.length) / r.total);
  console.log(`## ${r.route}  —  ${r.total - r.missing.length}/${r.total} labels present (${pct}%)`);
  if (r.missing.length) console.log(`   MISSING: ${r.missing.slice(0, 18).map(m => JSON.stringify(m)).join(', ')}${r.missing.length > 18 ? ` … +${r.missing.length - 18}` : ''}`);
  if (r.sampleSkipped) console.log(`   (${r.sampleSkipped} further absent strings were canvas SAMPLE DATA - prices, times, dates - not counted)`);
  console.log('');
}
for (const r of results.filter(r => r.error)) console.log(`## ${r.route} — ERROR ${r.error} (absent from the data, not passing)`);
