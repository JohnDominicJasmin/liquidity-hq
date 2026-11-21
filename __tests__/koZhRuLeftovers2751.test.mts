/* QA: PR #2751 (held, v2026.11.24), #1185: the ko / zh / ru leftovers QA listed after its re-measure on qa 637de6f.
 *
 * THE WRITTEN RULE (the PR body, QA's lines): a Russian, Korean or Chinese visitor does not read English where a label or the visitor's language exists. (1) the /econ-calendar day header's long date is formatted in the visitor's APP language, not the browser's; (2) its source line "official schedules: BLS, BEA, Census, Fed" goes through a label when the API sends exactly that string, any other string stays as sent; agency names stay English; (3) the /arena coin-health badge tooltip reads the label by key, not the English label carried next to it; (4) the chart feed dot's tooltip is the same text as its aria-label (a label, not the raw status word); (5) the /upgrade Free card's "Not included:" screen-reader text has ko / zh / ru rows. The migration is held (NOT YET APPLIED), PROD + DEV, 7 rows per block.
 *   R1  THE DATE: the real fmtHeaderDate is cut out of the page and RUN: ru, ko, zh and en each give their own language's long date for a fixed day, today gets the prefix label, the function takes the locale and never `undefined`, and the call site passes the visitor's locale
 *   R2  THE SOURCE LINE: the constant equals what the API route sends and the English default; the line shows the label only for that exact string, anything else (and 'none') is shown as sent
 *   R3  THE BADGE TOOLTIP: title reads t(h.labelKey); the English label field is not the tooltip any more
 *   R4  THE DOT: title and aria-label are the same expression, built from three feed labels that have English defaults and ko / zh / ru rows
 *   R5  THE MIGRATION: ECON_CALENDAR_SOURCE_OFFICIAL x en/ko/zh/ru (en equals the default and the API string) and UPGRADE_FREE_NOT_INCLUDED_SR x ko/zh/ru, once in the PROD block (lhq_labels) and once in the DEV block (lhq_dev_labels), upsert, NOT YET APPLIED; the second key really had no ko / zh / ru row before; both keys are registered
 * WHAT THIS CANNOT PROVE: the pages in a browser with the rows applied (the ru / ko / zh cells on qa after PM applies them), and the quality of the AI-drafted translations. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { appPath } from './_appPath.mts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EN = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const PAGE = read(appPath('app/econ-calendar/page.tsx')); const ARENA = read(appPath('app/arena/page.tsx')); const CHART = read('components/KLineProChart.tsx'); const ROUTE = read('app/api/econ-calendar/route.ts');
const OFFICIAL = 'official schedules: BLS, BEA, Census, Fed';
const cutFn = (src: string, re: RegExp): string => { const m = re.exec(src); assert.ok(m, `not found: ${re}`); let i = src.indexOf('{', m!.index + m![0].length - 1), d = 0; for (; i < src.length; i++) { if (src[i] === '{') d++; else if (src[i] === '}') { d--; if (d === 0) break; } } return src.slice(m!.index, i + 1); };

test('R1. the date header is formatted in the visitor\'s language', () => {
  const fn = new Function(`${stripTypeScriptTypes(cutFn(PAGE, /function fmtHeaderDate\(/))}\nreturn fmtHeaderDate;`)() as (iso: string, t: (k: string, v?: Record<string, string>) => string, locale: string) => string;
  const t = (k: string, v?: Record<string, string>) => `${k}:${v?.date ?? ''}`; const day = '2031-11-25T12:00:00Z';
  const ru = fn(day, t, 'ru'), ko = fn(day, t, 'ko'), zh = fn(day, t, 'zh'), en = fn(day, t, 'en');
  assert.match(ru, /[Ѐ-ӿ]/, `ru: ${ru}`); assert.match(ru, /ноября/); assert.match(ko, /[가-힯]/, `ko: ${ko}`); assert.match(zh, /[一-鿿]/, `zh: ${zh}`); assert.match(en, /November/, `en: ${en}`);
  assert.notEqual(new Set([ru, ko, zh, en]).size, 1, 'CONTROL: the four locales gave the same text');
  const todayIso = new Date().toISOString(); assert.match(fn(todayIso, t, 'ru'), /^ECON_CALENDAR_TODAY_PREFIX:/, 'today lost its prefix label');
  const body = cutFn(PAGE, /function fmtHeaderDate\(/); assert.match(body, /\(iso: string, t: TFn, locale: string\)/); assert.ok(!/toLocaleDateString\(undefined/.test(body), 'the header date takes the browser locale again');
  assert.match(PAGE, /const \{ t, locale \} = useLabels\(\);/); assert.match(PAGE, /fmtHeaderDate\(dayEvents\[0\]\.isoDate, t, locale\)/, 'the call site does not pass the visitor\'s locale');
});

test('R2. the source line: label for the exact API string, anything else as sent', () => {
  const c = /const OFFICIAL_SOURCE = '([^']+)';/.exec(PAGE); assert.ok(c, 'OFFICIAL_SOURCE not found'); assert.equal(c![1], OFFICIAL); assert.equal(EN.ECON_CALENDAR_SOURCE_OFFICIAL, OFFICIAL, 'the English default is not the API string');
  assert.ok(ROUTE.includes(`source: '${OFFICIAL}'`), 'the API route no longer sends that exact string, so the label would never show');
  assert.match(PAGE, /\{source === OFFICIAL_SOURCE \? t\('ECON_CALENDAR_SOURCE_OFFICIAL'\) : source\}/, 'the line is not the written conditional'); assert.ok(!/\{source\}\{source && failed/.test(PAGE), 'the raw source is printed unconditionally again');
  const other = [...ROUTE.matchAll(/source:\s*'([^']+)'/g)].map((m) => m[1]).filter((s) => s !== OFFICIAL); console.log(`[R2] other source strings the route sends: ${JSON.stringify(other)}`);
});

test('R3. the coin-health badge tooltip is the label by key', () => {
  const lines = ARENA.split('\n').filter((l) => /healthGradeA11y\(h\.grade, h\.labelKey, t\)/.test(l)); assert.equal(lines.length, 1, 'the badge span is not found exactly once');
  assert.match(lines[0], /title=\{t\(h\.labelKey\)\}/, 'the tooltip is not t(h.labelKey)'); assert.ok(!/title=\{h\.label\}/.test(ARENA), 'the English label field is a tooltip again');
});

test('R4. the chart feed dot: tooltip equals its aria-label, from three translated labels', () => {
  const at = CHART.indexOf("tl('CHART_FEED_LIVE')"); assert.ok(at > 0); const block = CHART.slice(CHART.lastIndexOf('aria-label=', at), at + 400);
  const aria = /aria-label=\{([^\n]+)\}\n/.exec(block)?.[1], title = /title=\{([^\n]+)\}\n/.exec(CHART.slice(at))?.[1]; assert.ok(aria && title, 'aria-label / title not found'); assert.equal(title, aria, 'the dot tooltip differs from its aria-label'); assert.ok(!/title=\{wsStatus\}/.test(CHART), 'the raw status word is the tooltip again');
  const migs = readdirSync(new URL('../supabase/migrations/', import.meta.url)).map((f) => read(`supabase/migrations/${f}`));
  for (const k of ['CHART_FEED_LIVE', 'CHART_FEED_OFFLINE', 'CHART_FEED_CONNECTING']) { assert.ok(EN[k], `${k} has no default`); for (const l of ['ko', 'zh', 'ru']) assert.ok(migs.some((m) => m.includes(`('${k}','${l}',`)), `${k}/${l} has no migration row`); }
});

test('R5. the held migration: both keys, both projects, the right locales, an upsert', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const name = readdirSync(dir).find((f) => /^20261129c_labels_ko_zh_ru_leftovers/.test(f)); assert.ok(name, 'the migration is missing'); const sql = read(`supabase/migrations/${name}`);
  assert.match(sql, /NOT YET APPLIED/); const p = sql.indexOf('insert into lhq_labels'), d = sql.indexOf('insert into lhq_dev_labels'); assert.ok(p > 0 && d > p);
  for (const [nm, block] of [['PROD', sql.slice(p, d)], ['DEV', sql.slice(d)]] as const) {
    const rows = [...block.matchAll(/\('([A-Z_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((r) => ({ k: r[1], l: r[2], v: r[3].replace(/''/g, "'") })); const of = (k: string) => rows.filter((r) => r.k === k).map((r) => r.l).sort();
    assert.deepEqual(of('ECON_CALENDAR_SOURCE_OFFICIAL'), ['en', 'ko', 'ru', 'zh'], `${nm}: source label locales`); assert.deepEqual(of('UPGRADE_FREE_NOT_INCLUDED_SR'), ['ko', 'ru', 'zh'], `${nm}: not-included locales`); assert.equal(rows.length, 7, `${nm}: ${rows.length} rows`);
    assert.equal(rows.find((r) => r.k === 'ECON_CALENDAR_SOURCE_OFFICIAL' && r.l === 'en')!.v, OFFICIAL); for (const r of rows.filter((x) => x.l !== 'en')) assert.ok(r.v.trim().length > 0 && r.v !== EN[r.k], `${nm}: ${r.k}/${r.l} empty or English`);
    assert.match(block, /on conflict \(key, locale\) do update set value = excluded\.value/, `${nm}: not an upsert`);
  }
  assert.ok(EN.UPGRADE_FREE_NOT_INCLUDED_SR, 'the existing key has no English default');
  const keysTs = read('lib/labelKeys.ts'); assert.ok(keysTs.includes('ECON_CALENDAR_SOURCE_OFFICIAL') && keysTs.includes('UPGRADE_FREE_NOT_INCLUDED_SR'));
});

test('R6. no other migration writes a different value for a key / locale this one writes (two held files that disagree decide by apply order)', () => {
  const dir = new URL('../supabase/migrations/', import.meta.url); const mine = readdirSync(dir).find((f) => /^20261129c_labels_ko_zh_ru_leftovers/.test(f))!;
  const rowsOf = (sql: string) => [...sql.matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)].map((r) => ({ k: r[1], l: r[2], v: r[3].replace(/''/g, "'") }));
  const mineRows = rowsOf(read(`supabase/migrations/${mine}`)); assert.ok(mineRows.length >= 14, 'CONTROL: the rows were not parsed'); const clashes: string[] = [];
  for (const f of readdirSync(dir)) { if (f === mine) continue; const rows = rowsOf(read(`supabase/migrations/${f}`)); for (const m of mineRows) for (const o of rows) if (o.k === m.k && o.l === m.l && o.v !== m.v) clashes.push(`${m.k}/${m.l}: ${f} says "${o.v}", this file says "${m.v}"`); }
  assert.deepEqual([...new Set(clashes)], [], 'a key / locale is written with two different values');
});
