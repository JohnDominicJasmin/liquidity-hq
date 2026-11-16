/* The held label migrations (header "NOT YET APPLIED TO ANY DATABASE") must agree with the build, because a STORED en row overrides the shipped default (the migrations' own headers say so):
 *   M1  every English row in a held migration equals the value shipped in lib/labelDefaults.en.json, for both the PROD and the DEV block (a drift means the page shows different words depending on whether the migration ran)
 *   M2  the PROD and DEV blocks carry the same keys and the same values (they are one change applied to two projects)
 *   M3  every key that has an en row has ko, zh and ru rows too, and every {placeholder} in the English text is in each translation (a translation without {n} prints "{n}" or drops the number)
 *   M4  every key in a held migration is registered in lib/labelKeys.ts (an unregistered key is never read)
 *   M5  CONTROL: at least one held migration was found when this runs on a branch that has them, and each parsed block yields rows (a changed SQL layout must turn this red, not green)
 * Branch-agnostic: it reads whatever held migrations the checked-out tree has, so it travels with each PR's pins and runs again on the integration branch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const defaults = JSON.parse(readFileSync(new URL('lib/labelDefaults.en.json', root), 'utf8')) as Record<string, string>;
const keysSrc = readFileSync(new URL('lib/labelKeys.ts', root), 'utf8');
const dir = new URL('supabase/migrations/', root);
const held = readdirSync(dir).filter((f) => /_labels_.*\.sql$/.test(f)).filter((f) => /NOT YET APPLIED TO ANY DATABASE/.test(readFileSync(new URL(f, dir), 'utf8')));

type Rows = Map<string, Map<string, string>>;   // key -> locale -> value
const ROW = /\('([A-Za-z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g;
function parse(block: string): Rows {
  const out: Rows = new Map();
  for (const m of block.matchAll(ROW)) { if (!out.has(m[1])) out.set(m[1], new Map()); out.get(m[1])!.set(m[2], m[3].replace(/''/g, "'")); }
  return out;
}
function blocks(sql: string) {
  const p = sql.indexOf('===================== PROD'), d = sql.indexOf('============ DEV');
  assert.ok(p >= 0 && d > p, 'the PROD / DEV block markers were not found: the migration layout changed');
  return { prod: parse(sql.slice(p, d)), dev: parse(sql.slice(d)) };
}

test('M5. CONTROL: the held migrations parse into non-empty PROD and DEV blocks (skipped only when this tree has none)', (t) => {
  if (held.length === 0) { t.skip('no held label migration in this tree'); return; }
  for (const f of held) { const b = blocks(readFileSync(new URL(f, dir), 'utf8')); assert.ok(b.prod.size > 0 && b.dev.size > 0, `${f}: a block parsed to zero rows`); }
});

for (const f of held) {
  const { prod, dev } = blocks(readFileSync(new URL(f, dir), 'utf8'));
  test(`M1. ${f}: the English rows equal the shipped defaults (PROD and DEV)`, () => {
    for (const [name, rows] of [['PROD', prod], ['DEV', dev]] as const) for (const [k, loc] of rows) {
      const en = loc.get('en'); if (en === undefined) continue;
      assert.ok(k in defaults, `${k}: has an en row in the ${name} block but no shipped default`);
      assert.equal(en, defaults[k], `${f} ${name} ${k}: the stored English differs from the shipped default, so the words depend on whether the migration ran`);
    }
  });
  test(`M2. ${f}: the PROD and DEV blocks are the same rows`, () => {
    assert.deepEqual([...prod.keys()].sort(), [...dev.keys()].sort(), 'the blocks carry different keys');
    for (const [k, loc] of prod) for (const [l, v] of loc) assert.equal(dev.get(k)?.get(l), v, `${k}/${l} differs between PROD and DEV`);
  });
  test(`M3. ${f}: every en key has ko, zh, ru, and every {placeholder} survives translation`, () => {
    for (const [k, loc] of prod) {
      if (!loc.has('en')) continue;
      for (const l of ['ko', 'zh', 'ru']) assert.ok(loc.get(l), `${k}: no ${l} row`);
      for (const ph of loc.get('en')!.match(/\{[a-zA-Z]+\}/g) ?? []) for (const l of ['ko', 'zh', 'ru']) assert.ok(loc.get(l)!.includes(ph), `${k}/${l}: the placeholder ${ph} was lost in translation`);
    }
  });
  test(`M4. ${f}: every key is registered in labelKeys.ts`, () => {
    for (const k of prod.keys()) assert.ok(keysSrc.includes(`'${k}'`), `${k} is not registered in lib/labelKeys.ts: nothing reads it`);
  });
}
