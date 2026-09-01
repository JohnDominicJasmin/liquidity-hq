#!/usr/bin/env node
/* Audits design-handoff-dir/ for what a screen needs before it can be
 * implemented and QA'd, and prints exactly what is missing.
 *
 * Written because "what is missing from the handoff?" was answered three times
 * by hand this session and got a different answer each time — once wrongly
 * (#516/#517 claimed 15 screens needed designing when they were already built).
 * A script that reads the directory cannot misremember it.
 *
 * Usage:  node qa/audit-handoff.mjs [--json]
 *
 * Exit 0 always — this reports, it does not gate. Nothing in CI runs it.
 */

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.join(process.cwd(), 'design-handoff-dir');
const PAGES = path.join(ROOT, 'pages');

/* The token values the owner ratified on 2026-09-01 (#526). A canvas still
 * drawing the superseded value is not wrong about geometry, but its colours
 * cannot be measured from. */
const SUPERSEDED = {
  '#0c0d0f': '#141517  (--bg1)',
  '#5a5f66': '#7c828a  (--txt3, the original fails 4.5:1)',
  '#2a2e32': '#5e646b  (--border-input, the original is 1.36:1)',
};

/* Routes with no design material that SHOULD have none, so the audit does not
 * report them as gaps every run. */
const INTENTIONALLY_UNDESIGNED = {
  '/backtest': 'hidden route (#264, shipped #265) — qa/e2e/hidden-routes.spec.ts asserts it',
  '/live-tracking': 'hidden route (#264, shipped #265)',
  '/admin': 'internal, no user-facing surface',
  '/ops/*': 'internal, no user-facing surface',
  '/auth/callback': 'no UI',
};

function read(f) {
  try { return fs.readFileSync(f, 'utf8'); } catch { return null; }
}

function canvases() {
  if (!fs.existsSync(PAGES)) return [];
  return fs.readdirSync(PAGES)
    .filter(f => f.endsWith('.dc.html'))
    .map(f => ({ name: f.replace(/\.dc\.html$/, ''), file: path.join(PAGES, f) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/* An artboard is identified by its frame width. 1440 is the desktop frame and
 * 390 the mobile one throughout this handoff; both are stated in the Arena
 * README and hold for every file delivered so far. */
function widths(src) {
  const set = new Set();
  for (const m of src.matchAll(/width:\s*(\d{3,4})px/g)) set.add(Number(m[1]));
  return set;
}

/* A light artboard would need a light ground. Counting light background
 * declarations is a proxy: a handful are accents, a frame's worth is a theme. */
function lightArtboardLikely(src) {
  const hits = (src.match(/background:\s*#(?:f[0-9a-f]{5}|e[0-9a-f]{5})/gi) || []).length;
  return hits >= 12;
}

function specFor(name) {
  // Arena is the only screen with a normative spec; its layout is nested.
  const candidates = [
    path.join(ROOT, 'design_handoff_arena', 'specs', 'arena.md'),
    path.join(ROOT, 'specs', `${name.toLowerCase().replace(/\s+/g, '-')}.md`),
    path.join(PAGES, 'specs', `${name}.md`),
  ];
  if (!/^arena/i.test(name)) candidates.shift();
  return candidates.find(p => fs.existsSync(p)) || null;
}

function readmeFor(name) {
  const candidates = [
    path.join(ROOT, 'design_handoff_arena', 'README.md'),
    path.join(PAGES, `${name}.md`),
    path.join(PAGES, 'README.md'),
  ];
  if (!/^arena/i.test(name)) candidates.shift();
  return candidates.find(p => fs.existsSync(p)) || null;
}

const rows = [];
for (const { name, file } of canvases()) {
  const src = read(file) || '';
  const w = widths(src);
  const stale = Object.keys(SUPERSEDED).filter(hex => src.includes(hex));
  rows.push({
    screen: name,
    desktop: w.has(1440),
    mobile: w.has(390),
    light: lightArtboardLikely(src),
    spec: !!specFor(name),
    readme: !!readmeFor(name),
    staleTokens: stale,
    kb: Math.round(fs.statSync(file).size / 102.4) / 10,
  });
}

const runtimeOk = fs.existsSync(path.join(PAGES, 'support.js'))
  && fs.existsSync(path.join(PAGES, 'assets', 'logo.png'));

if (process.argv.includes('--json')) {
  console.log(JSON.stringify({ rows, runtimeOk, intentionallyUndesigned: INTENTIONALLY_UNDESIGNED }, null, 2));
  process.exit(0);
}

const n = rows.length;
const miss = k => rows.filter(r => !r[k]);
const pad = (s, w) => String(s).padEnd(w);
const mark = b => (b ? ' ok ' : ' -- ');

console.log(`\ndesign-handoff-dir — ${n} canvases\n`);
console.log(pad('SCREEN', 26) + 'DESKTOP MOBILE  LIGHT  SPEC  README  STALE');
console.log('-'.repeat(78));
for (const r of rows) {
  console.log(
    pad(r.screen, 26) +
    pad(mark(r.desktop), 8) + pad(mark(r.mobile), 7) +
    pad(mark(r.light), 7) + pad(mark(r.spec), 6) +
    pad(mark(r.readme), 8) +
    (r.staleTokens.length ? r.staleTokens.join(' ') : '')
  );
}

console.log(`\n${'='.repeat(78)}\nMISSING\n${'='.repeat(78)}`);

const noSpec = miss('spec'), noReadme = miss('readme'), noLight = miss('light');
const noDesktop = miss('desktop'), noMobile = miss('mobile');
const staleAny = rows.filter(r => r.staleTokens.length);

const report = [
  ['Specs (normative, numbered acceptance criteria)', noSpec, 'Only Arena has one. Without a spec there is nothing to score an implementation against.'],
  ['READMEs (fidelity, extend rules, colour-is-data, open decisions)', noReadme, 'Only Arena has one.'],
  ['Light-theme artboards', noLight, 'The product ships a light theme and the owner requires it audited. No design exists for it.'],
  ['Desktop 1440 artboards', noDesktop, ''],
  ['Mobile 390 artboards', noMobile, ''],
];

for (const [label, list, note] of report) {
  if (!list.length) { console.log(`\n${label}: complete (${n}/${n}).`); continue; }
  console.log(`\n${label} — missing on ${list.length} of ${n}:`);
  if (note) console.log(`  ${note}`);
  for (const r of list) console.log(`  - ${r.screen}`);
}

if (staleAny.length) {
  console.log(`\nSuperseded token values — present in ${staleAny.length} of ${n} canvases:`);
  for (const [oldHex, replacement] of Object.entries(SUPERSEDED)) {
    const hit = rows.filter(r => r.staleTokens.includes(oldHex));
    if (hit.length) console.log(`  ${oldHex} -> ${replacement}   (${hit.length} canvases)`);
  }
  console.log('  These predate the owner-approved amendment (#526). Geometry is unaffected;');
  console.log('  colours must not be measured from these canvases until they are redrawn.');
}

console.log(`\nCanvas runtime (support.js + assets/logo.png): ${runtimeOk ? 'present' : 'MISSING — canvases will not render'}`);

console.log('\nDeliberately undesigned, not gaps:');
for (const [route, why] of Object.entries(INTENTIONALLY_UNDESIGNED)) {
  console.log(`  ${pad(route, 18)} ${why}`);
}
console.log('');
