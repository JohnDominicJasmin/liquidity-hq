/* Guard: no label key appears twice in lib/labelDefaults.en.json or lib/labelKeys.ts.
 *
 * WHY RAW TEXT. JSON.parse keeps the LAST of two equal keys without a word, so a merge that unions both sides of a conflict leaves the stale
 * wording winning silently (2026-11-17: an old "Short squeeze ↑" beat the new text on #2409). A test that reads the parsed object can never see it.
 * This reads the file text and counts.
 *   K1  labelDefaults.en.json: every top-level key occurs once (raw scan, string-aware, so a key name inside a VALUE is not counted)
 *   K2  lib/labelKeys.ts: every registered key occurs once in LABEL_KEYS
 *   K3  CONTROL: the scanner finds a planted duplicate (a guard that cannot fire is not a guard)
 * Test-only; runs in the quick checks on every PR. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');

/** Every depth-1 string key of a JSON object text, in order, scanning characters so strings and escapes are respected. */
export function topLevelJsonKeys(text: string): string[] {
  const keys: string[] = []; let depth = 0; let i = 0; let expectKey = false;
  while (i < text.length) {
    const ch = text[i];
    if (ch === '"') {
      let j = i + 1, s = '';
      while (j < text.length && text[j] !== '"') { if (text[j] === '\\') { s += text[j] + text[j + 1]; j += 2; } else { s += text[j]; j++; } }
      if (depth === 1 && expectKey) { keys.push(JSON.parse(`"${s}"`)); expectKey = false; }
      i = j + 1; continue;
    }
    if (ch === '{' || ch === '[') { depth++; if (depth === 1) expectKey = true; }
    else if (ch === '}' || ch === ']') depth--;
    else if (ch === ',' && depth === 1) expectKey = true;
    i++;
  }
  return keys;
}
const dups = (keys: string[]) => { const seen = new Set<string>(), d = new Set<string>(); for (const k of keys) { if (seen.has(k)) d.add(k); seen.add(k); } return [...d]; };

test('K1. lib/labelDefaults.en.json has no duplicate key', () => {
  const keys = topLevelJsonKeys(read('lib/labelDefaults.en.json')); assert.ok(keys.length > 1000, `CONTROL: only ${keys.length} keys scanned`);
  assert.deepEqual(dups(keys), [], 'a key is defined twice: JSON keeps the LAST one silently, so a stale text can win. Delete the wrong one.');
});
test('K2. lib/labelKeys.ts registers every key once', () => {
  const s = read('lib/labelKeys.ts'); const body = s.slice(s.indexOf('export const LABEL_KEYS'), s.indexOf('export type LabelKey'));
  const keys = [...body.matchAll(/'([A-Z][A-Z0-9_]+)'/g)].map((m) => m[1]); assert.ok(keys.length > 1000, `CONTROL: only ${keys.length} keys scanned`);
  assert.deepEqual(dups(keys), [], 'a key is registered twice in LABEL_KEYS');
});
test('K3. CONTROL: the scanner finds a planted duplicate and ignores a key name inside a value', () => {
  assert.deepEqual(dups(topLevelJsonKeys('{\n  "A": "one",\n  "B": "two",\n  "A": "stale"\n}')), ['A']);
  assert.deepEqual(dups(topLevelJsonKeys('{"A": "he said \\"B\\": x", "B": "y", "C": {"A": 1}}')), [], 'a key inside a value or a nested object was counted');
  assert.deepEqual(topLevelJsonKeys('{"a\\"b": 1, "c": [1, {"d": 2}]}'), ['a"b', 'c']);
});
