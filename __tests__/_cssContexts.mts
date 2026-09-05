/* Reading globals.css the way the browser does: four contexts, tokens resolved
 * through the cascade.
 *
 * Extracted from __tests__/readableOn.test.mts when a second test needed it
 * (#696). Two copies of a CSS parser is the two-sources shape this repo keeps
 * paying for - and the failure mode is quiet, because a drifted copy still
 * returns well-formed colours, just not the ones the page renders.
 *
 * Not named *.test.mts on purpose: `npm test` globs that pattern, and this file
 * has no assertions of its own.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
export const CSS = readFileSync(path.join(ROOT, 'app', 'globals.css'), 'utf8');

/** Custom-property declarations inside one top-level rule. */
export function tokens(selector: string): Record<string, string> {
  const lines = CSS.split('\n');
  const idx = lines.findIndex(l => l.trim() === selector + ' {');
  assert.ok(idx >= 0, `token block not found in globals.css: ${selector}`);
  const from = lines.slice(0, idx).join('\n').length;
  let i = CSS.indexOf('{', from), depth = 0, end = i;
  for (; i < CSS.length; i++) {
    if (CSS[i] === '{') depth++;
    else if (CSS[i] === '}') { depth--; if (depth === 0) { end = i; break; } }
  }
  const body = CSS.slice(CSS.indexOf('{', from) + 1, end);
  const out: Record<string, string> = {};
  for (const m of body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  return out;
}

/** Follow `var(--x)` chains, including fallbacks, to a literal. */
export function resolve(map: Record<string, string>, value: string, depth = 0): string | null {
  if (depth > 10) return null;
  const m = /^var\((--[a-z0-9-]+)(?:\s*,\s*([^)]+))?\)$/.exec(value.trim());
  if (!m) return value.trim();
  const next = map[m[1]] ?? m[2];
  return next === undefined ? null : resolve(map, next, depth + 1);
}

/** The four contexts a page can actually render in. Terminal light layers on
 *  the light block because that is the cascade order in globals.css. */
export const CONTEXTS: Array<[string, Record<string, string>]> = (() => {
  const root = tokens(':root');
  const light = tokens('[data-theme="light"]');
  const termDark = tokens('[data-design="terminal"]:not([data-theme="light"])');
  const termLight = tokens('[data-design="terminal"][data-theme="light"]');
  return [
    ['current dark', { ...root }],
    ['current light', { ...root, ...light }],
    ['terminal dark', { ...root, ...termDark }],
    ['terminal light', { ...root, ...light, ...termLight }],
  ];
})();
