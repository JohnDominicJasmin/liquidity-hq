/* QA: PR #2730 (HELD, not before QA's 5-locale slow-3G sweep), #1185: the first-load JavaScript stops carrying the whole English label table (226 KB raw / 71 KB gzip). Public routes paint from a generated critical subset; every other route waits for the whole table before it renders.
 *
 * THE WRITTEN RULE (the PR body): (a) lib/labelDefaults.critical.json is a STRICT SUBSET of labelDefaults.en.json with identical values and `node scripts/gen-critical-labels.mjs --check` passes; (b) the routes that paint from it are the listed public ones, an offered-locale landing (/ko /zh /ru, one segment) and nothing else (a signed-in page renders thousands of keys on the server, so it must wait for the whole table); (c) a fetched locale table is layered OVER the English base exactly as `{ ...DEFAULT_EN_LABELS, ...data }` was, with the same empty-payload guard; (d) a key a public route paints is in the subset, or it would show its raw name.
 *   C1  THE SUBSET: every key exists in the English table with the same value, the file is not empty and not the whole table (1,000-1,400 of ~3,700 keys), keys unique
 *   C2  THE GENERATOR: `--check` exits 0 on this tree (the subset is what the scan produces)
 *   C3  THE ROUTE RULE: the real isCriticalLabelRoute run on a table: every listed route, a trailing slash, /ko /zh /ru are critical; every signed-in app route, /ko/nope, an unlisted path, null and "" are not; every listed route has a page, every extra entry exists
 *   C4  AN INDEPENDENT KEY CHECK (not the generator's closure scan): every label key written as a quoted literal directly in the listed pages and layouts, and in the shell layout, is in the subset
 *   C5  THE PROVIDER: the lazy rule is `localeFromPath || isCriticalLabelRoute(pathname)`; the whole table is awaited with `use(loadFullEnglish())` ONLY on the non-lazy side; the subset is the base only when the whole table is not in; the locale layer is merged OVER the base; the empty-payload guard is still there
 *   C6  THE LOADER (the real lib/labelsFull.ts run with its two chunk imports replaced by counters): one cached promise that is NEVER reset (the 72-requests-in-40-s defect QA measured came from `cached = null`), 3 attempts per page, ONE reload per tab session guarded by sessionStorage while the promise stays pending, then the critical subset for good; one failure then success needs no reload and clears the guard; blocked storage and the server never reload
 * WHAT THIS CANNOT PROVE: any of the browser behaviour, which is the sweep: hydration with the table delayed, no raw key at 390 / 1280 light and dark in en / ko / zh / ru, no change after the idle load, CLS, and the app routes with the chunk blocked. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import * as nodeModule from 'node:module';
import { isCriticalLabelRoute } from '../lib/labelCriticalRoutes.ts';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const EN = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>; const CRIT = JSON.parse(read('lib/labelDefaults.critical.json')) as Record<string, string>;
const CFG = JSON.parse(read('lib/labelCriticalRoutes.json')) as { routes: string[]; extraEntries: string[] };
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

test('C1. the critical table is a strict subset of the English table, same values', () => {
  const keys = Object.keys(CRIT); assert.ok(keys.length >= 1000 && keys.length <= 1400, `${keys.length} keys`); assert.ok(keys.length < Object.keys(EN).length * 0.5, 'the subset is more than half the table: the saving is gone');
  const bad = keys.filter((k) => !(k in EN) || EN[k] !== CRIT[k]); assert.deepEqual(bad.slice(0, 5), [], `${bad.length} keys missing from or different in the English table`); assert.equal(new Set(keys).size, keys.length);
  console.log(`[C1] ${keys.length} of ${Object.keys(EN).length} keys`);
});

test('C2. the generator agrees with the file (--check)', () => {
  const r = spawnSync(process.execPath, ['scripts/gen-critical-labels.mjs', '--check'], { cwd: new URL('..', import.meta.url), encoding: 'utf8' });
  assert.equal(r.status, 0, `--check exited ${r.status}: ${(r.stdout + r.stderr).slice(0, 300)}`);
});

test('C3. the route rule, run on a table', () => {
  for (const r of CFG.routes) assert.equal(isCriticalLabelRoute(r), true, `${r} should paint from the subset`);
  for (const r of ['/about/', '/faq/', '/ko', '/zh', '/ru', '/ko/']) assert.equal(isCriticalLabelRoute(r), true, `${r}`);
  for (const r of ['/dashboard', '/arena', '/markets', '/settings', '/upgrade', '/liq', '/funding', '/scanner', '/news', '/journal', '/ko/nope', '/ko/dashboard', '/nope', '/about/team', '/arena/x']) assert.equal(isCriticalLabelRoute(r), false, `${r} must wait for the whole table`);
  assert.equal(isCriticalLabelRoute(null), false); assert.equal(isCriticalLabelRoute(undefined), false); assert.equal(isCriticalLabelRoute(''), false);
  for (const r of CFG.routes) { const dir = r === '/' ? 'app/(main)' : `app/(main)${r}`; const has = ['page.tsx', 'layout.tsx'].some((f) => existsSync(new URL(`../${dir}/${f}`, import.meta.url))) || existsSync(new URL(`../app/(auth)${r}/page.tsx`, import.meta.url)) || existsSync(new URL(`../app/(intl)${r}/page.tsx`, import.meta.url)); if (!has) console.log(`[C3] no page file under app/(main) for ${r} (the generator skips it)`); }
  for (const e of CFG.extraEntries) assert.ok(existsSync(new URL(`../${e}`, import.meta.url)), `extra entry ${e} does not exist`);
});

test('C4. keys written directly in the listed pages and the shell are in the subset', () => {
  const files = [...CFG.extraEntries.filter((e) => /layout\.tsx$/.test(e)), ...CFG.routes.flatMap((r) => { const d = r === '/' ? 'app/(main)' : `app/(main)${r}`; return ['page.tsx', 'layout.tsx'].map((f) => `${d}/${f}`); })].filter((f) => existsSync(new URL(`../${f}`, import.meta.url)));
  assert.ok(files.length >= 10, 'CONTROL: only ' + files.length + ' files found'); const missing: string[] = []; let seen = 0;
  for (const f of files) for (const m of strip(read(f)).matchAll(/['"`]([A-Z][A-Z0-9_]{5,})['"`]/g)) if (m[1] in EN) { seen++; if (!(m[1] in CRIT)) missing.push(`${f}: ${m[1]}`); }
  console.log(`[C4] ${files.length} files, ${seen} direct key literals`); assert.ok(seen >= 100, 'CONTROL: ' + seen + ' literals seen'); assert.deepEqual(missing.slice(0, 8), [], `${missing.length} keys written in a public page are not in the subset (they would paint raw)`);
});

test('C5. the provider: lazy rule, whole table awaited only on the other side, locale layer over the base, empty-payload guard', () => {
  const p = strip(read('components/LabelsProvider.tsx'));
  assert.match(p, /const lazy = localeFromPath \|\| isCriticalLabelRoute\(pathname\);/); assert.match(p, /const full: LabelTable \| null = lazy \? \(fullEn \?\? fullEnglishIfLoaded\(\)\) : use\(loadFullEnglish\(\)\);/, 'the whole table must be awaited with use() on the non-lazy side only');
  assert.equal((p.match(/use\(loadFullEnglish\(\)\)/g) ?? []).length, 1); assert.match(p, /const base: LabelTable = full \?\? \(CRITICAL_EN_LABELS as LabelTable\);/); assert.match(p, /overrides \? \{ \.\.\.base, \.\.\.overrides \} : base/, 'the fetched locale layer must go OVER the base');
  assert.match(p, /Object\.keys\(data\)\.length === 0/, 'the empty-payload guard is gone'); assert.ok(!/import DEFAULT_EN_LABELS from/.test(p), 'the whole table is statically imported again (the saving is gone)');
  assert.match(strip(read('components/LabelsSeed.tsx')), /use\(/, 'LabelsSeed no longer reads the whole table with use()');
});

/* a whole-table chunk that FAILS: the real lib/labelsFull.ts is run with the two chunk imports replaced by counters (the English table rejects, the critical subset resolves), `setTimeout` made instant, and a stand-in window / sessionStorage / location.reload */
function loaderWith(opts: { failEn: number; storage: 'ok' | 'blocked'; windowDefined: boolean; flag?: boolean }) {
  const lsrc = stripTypeScriptTypes(read('lib/labelsFull.ts')).replace(/import\('\.\/labelDefaults\.en\.json'\)/g, '__importEn()').replace(/import\('\.\/labelDefaults\.critical\.json'\)/g, '__importCrit()').replace(/export function/g, 'function');
  const calls = { en: 0, crit: 0, reload: 0 }; const store = new Map<string, string>(); if (opts.flag) store.set('lhq_labels_chunk_reload_v1', '1');
  const sessionStorage = { getItem: (k: string) => { if (opts.storage === 'blocked') throw new Error('blocked'); return store.get(k) ?? null; }, setItem: (k: string, v: string) => { if (opts.storage === 'blocked') throw new Error('blocked'); store.set(k, v); }, removeItem: (k: string) => { if (opts.storage === 'blocked') throw new Error('blocked'); store.delete(k); } };
  const window = opts.windowDefined ? { location: { reload: () => { calls.reload++; } } } : undefined;
  const EN = { A: 'a-en', B: 'b-en' }; const CRIT = { A: 'a-crit' };
  const __importEn = async () => { calls.en++; if (calls.en <= opts.failEn) throw new Error('chunk load failed'); return { default: EN }; }; const __importCrit = async () => { calls.crit++; return { default: CRIT }; };
  const mod = new Function('__importEn', '__importCrit', 'sessionStorage', 'window', 'setTimeout', `${lsrc}\nreturn { loadFullEnglish, fullEnglishIfLoaded };`)(__importEn, __importCrit, sessionStorage, window, (f: () => void) => { f(); return 0; }) as { loadFullEnglish: () => Promise<Record<string, string>>; fullEnglishIfLoaded: () => Record<string, string> | null };
  return { ...mod, calls, store, EN, CRIT };
}
const tick = () => new Promise((r) => setImmediate(r));
const within = <T,>(p: Promise<T>): Promise<T> => Promise.race([p, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error('the promise never settled')), 2000))]); const settled = async (p: Promise<unknown>) => { let done = false; void p.then(() => { done = true; }); await tick(); await tick(); await tick(); return done; };

test('C6a. the loader source: one cached promise that is never reset, three attempts, one reload guarded by sessionStorage, then the subset', () => {
  const s = strip(read('lib/labelsFull.ts')); assert.match(s, /if \(cached\) return cached;/); assert.ok(!/cached\s*=\s*null/.test(s), '`cached = null` is back: every render would start a new three-attempt import (QA measured 72 requests in 40 s)'); assert.match(s, /for \(let i = 0; i < 3; i\+\+\)/);
  assert.match(s, /sessionStorage\.getItem\(RELOADED\)/); assert.match(s, /window\.location\.reload\(\)/); assert.match(s, /labelDefaults\.critical\.json/);
});

test('C6b. behaviour: a chunk that always fails costs 3 attempts per page, one reload per tab session, then the subset for good', async () => {
  const a = loaderWith({ failEn: 99, storage: 'ok', windowDefined: true }); const first = a.loadFullEnglish(); for (let i = 0; i < 50; i++) assert.equal(a.loadFullEnglish(), first, 'a later call must return the SAME promise'); await tick(); await tick();
  assert.equal(a.calls.en, 3, `${a.calls.en} attempts on the first page load`); assert.equal(a.calls.reload, 1, 'the page must reload exactly once'); assert.equal(await settled(first), false, 'the promise must stay pending while the page reloads (no subset flash)'); assert.equal(a.fullEnglishIfLoaded(), null);
  const b = loaderWith({ failEn: 99, storage: 'ok', windowDefined: true, flag: true }); const p2 = b.loadFullEnglish(); for (let i = 0; i < 50; i++) b.loadFullEnglish(); const got = await Promise.race([p2, new Promise<never>((_r, rej) => setTimeout(() => rej(new Error('the promise never settled after the reload (the page would stay on its loading state)')), 2000))]); assert.deepEqual(got, b.CRIT, 'after the reload the page settles to the critical subset'); assert.equal(b.calls.en, 3, `${b.calls.en} attempts after the reload (the 72-request bug made this grow with every render)`); assert.equal(b.calls.crit, 1); assert.equal(b.calls.reload, 0, 'a second reload would be a loop'); assert.deepEqual(b.fullEnglishIfLoaded(), b.CRIT);
});

test('C6c. behaviour: one failure then success needs no reload and clears the guard; blocked storage and the server never reload', async () => {
  const c = loaderWith({ failEn: 1, storage: 'ok', windowDefined: true, flag: true }); const v = await within(c.loadFullEnglish()); assert.deepEqual(v, c.EN); assert.equal(c.calls.en, 2); assert.equal(c.calls.reload, 0); assert.equal(c.store.has('lhq_labels_chunk_reload_v1'), false, 'a successful load must clear the reload guard');
  const d = loaderWith({ failEn: 99, storage: 'blocked', windowDefined: true }); assert.deepEqual(await within(d.loadFullEnglish()), d.CRIT); assert.equal(d.calls.reload, 0, 'blocked storage must not reload (no way to stop a loop)');
  const e = loaderWith({ failEn: 99, storage: 'ok', windowDefined: false }); assert.deepEqual(await within(e.loadFullEnglish()), e.CRIT); assert.equal(e.calls.reload, 0);
  const f = loaderWith({ failEn: 0, storage: 'ok', windowDefined: true }); assert.deepEqual(await within(f.loadFullEnglish()), f.EN); assert.equal(f.calls.en, 1); assert.equal(f.fullEnglishIfLoaded(), f.EN);
});
