#!/usr/bin/env node
/* Writes lib/labelDefaults.critical.json: the English labels the public routes paint on first load (#1185 slow-3G, option B, DRAFT).
 *
 * A key is "critical" when it appears as a quoted string literal in a file reachable by import from the entry files in lib/labelCriticalRoutes.json (the shell layout, each public route's page and layout,
 * the translated landing, the 404). The scan follows static and dynamic imports, skips lib/labelKeys.ts and the label tables themselves (they name every key), and is a SUPERSET on purpose: a key that
 * only appears in a comment or an unused branch is included, a key that is missing would paint as its raw name. Keys built from a prefix (`PREFIX_${x}` in a template literal) pull in every key with that prefix.
 *
 * Usage: node scripts/gen-critical-labels.mjs          write the file
 *        node scripts/gen-critical-labels.mjs --check  exit 1 if the file is not what the scan produces (for CI)
 * Landing hard gate: the English snapshot is untouched by this script; only the subset file is written. */
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const EN = JSON.parse(readFileSync(path.join(root, 'lib/labelDefaults.en.json'), 'utf8'));
const cfg = JSON.parse(readFileSync(path.join(root, 'lib/labelCriticalRoutes.json'), 'utf8'));
const TARGET = path.join(root, 'lib/labelDefaults.critical.json');
const keys = new Set(Object.keys(EN));

const entries = [...cfg.extraEntries];
for (const r of cfg.routes) {
  const dir = r === '/' ? 'app/(main)' : `app/(main)${r}`;
  for (const f of ['page.tsx', 'layout.tsx']) if (existsSync(path.join(root, dir, f))) entries.push(`${dir}/${f}`);
}

function resolveSpec(spec, from) {
  let base;
  if (spec.startsWith('@/')) base = path.join(root, spec.slice(2));
  else if (spec.startsWith('.')) base = path.resolve(path.dirname(from), spec);
  else return null;
  for (const c of [base, `${base}.ts`, `${base}.tsx`, `${base}.mts`, `${base}.js`, `${base}.jsx`, `${base}/index.ts`, `${base}/index.tsx`]) {
    if (existsSync(c) && statSync(c).isFile()) return c;
  }
  return null;
}

const seen = new Set();
const stack = entries.map(e => path.resolve(root, e));
const missing = stack.filter(f => !existsSync(f));
if (missing.length) { console.error(`entry files not found: ${missing.join(', ')}`); process.exit(2); }
while (stack.length) {
  const f = stack.pop();
  if (seen.has(f) || path.basename(f) === 'labelKeys.ts' || path.basename(f).startsWith('labelDefaults') || !/\.(tsx?|mts|jsx?)$/.test(f)) continue;
  seen.add(f);
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/(?:from|import)\s*\(?\s*['"]([^'"]+)['"]/g)) {
    const r = resolveSpec(m[1], f);
    if (r) stack.push(r);
  }
}

const used = new Set();
const prefixes = new Set();
for (const f of seen) {
  const src = readFileSync(f, 'utf8');
  for (const m of src.matchAll(/['"`]([A-Z][A-Z0-9_]{2,})['"`]/g)) if (keys.has(m[1])) used.add(m[1]);
  for (const m of src.matchAll(/`([A-Z][A-Z0-9]*_[A-Z0-9_]*)\$\{/g)) prefixes.add(m[1]);
}
for (const k of keys) for (const p of prefixes) if (k.startsWith(p)) used.add(k);

const out = {};
for (const k of Object.keys(EN)) if (used.has(k)) out[k] = EN[k];   // the English snapshot's own order: a stable diff
const text = JSON.stringify(out, null, 2) + '\n';
const count = Object.keys(out).length;

if (process.argv.includes('--check')) {
  const have = existsSync(TARGET) ? readFileSync(TARGET, 'utf8') : '';
  if (have.replace(/\r\n/g, '\n') !== text) { console.error(`lib/labelDefaults.critical.json is out of date (the scan finds ${count} keys). Run: npm run labels:critical`); process.exit(1); }
  console.log(`critical labels up to date: ${count} keys, ${seen.size} files scanned`);
} else {
  writeFileSync(TARGET, text);
  console.log(`wrote ${count} of ${keys.size} keys to lib/labelDefaults.critical.json (${seen.size} files scanned, ${prefixes.size} key prefixes)`);
}
