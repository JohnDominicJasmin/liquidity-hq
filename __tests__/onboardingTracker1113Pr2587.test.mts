/* QA: PR #2587 (tracker #1113): the Arena chart "?" legend, the password-reset sign-out of OTHER sessions, the journal sign-in text,
 * the landing cards, the session-pill tip, and migration 20261119z4. Read from source and run against stubs: no browser, no database.
 *   G1  labels: 12 keys, each in LABEL_KEYS and labelDefaults.en.json; legend lines <= 15 words, tip <= 20 words (OWNER-RULES 25)
 *   G2  the "?" button and its panel: real <button>, aria-expanded / aria-controls / aria-label, named panel, the 8 chips in order, width capped to the viewport
 *   G3  the legend's effect, RUN against a stand-in document: nothing registered while closed; Escape closes and focuses the "?"; another key does nothing;
 *       a press inside stays open; a press outside closes; the cleanup removes exactly what was added (no leak)
 *   A1  signOutOtherSessions: ONE call, args exactly { scope: 'others' } (not global, not local, not none); null on success
 *   A2  on an error / rejection / hang it RETURNS the error and leaves the stored session alone (forceSignOut clears it: control)
 *   R1  reset-password submit(), RUN with stubs: a failed update never reaches signOutOtherSessions; success calls update THEN others; a failed others-call is logged, not shown, and the form still finishes
 *   J1  the signed-out journal prompt carries no figure in any language
 *   L1  the four landing cards and the Connect step name no jargon token, no vendor, in en/ko/zh/ru
 *   N1  the session pill has the tip as its title
 *   M1  migration 19z4: PROD block == DEV block, 12 keys x 5 locales, en == shipped defaults, placeholders kept, lengths bounded
 *   MUT every pin above is also run on a mutated copy and must go red: a green first run proves nothing */
import test, { mock } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const read = (p: string) => readFileSync(new URL(p, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const chartSrc = read('../components/KLineProChart.tsx');
const authSrc = read('../lib/authSession.ts');
const resetSrc = read('../app/(main)/reset-password/page.tsx');
const navSrc = read('../components/TerminalNav.tsx');
const defaults = JSON.parse(read('../lib/labelDefaults.en.json')) as Record<string, string>;

const LEGEND_KEYS = ['CHART_LEGEND_SR', 'CHART_LEGEND_MAX_PAIN', 'CHART_LEGEND_GEX_FLIP', 'CHART_LEGEND_REALIZED', 'CHART_LEGEND_POSITION', 'CHART_LEGEND_SQZ_UP', 'CHART_LEGEND_SQZ_DOWN', 'CHART_LEGEND_GRADE'];
const KEYS = ['TNAV_SESSION_TIP', 'TRADE_JOURNAL_AUTH_DESC', 'CHART_LEGEND_ARIA', 'CHART_LEGEND_TITLE', ...LEGEND_KEYS];
const LOCALES = ['en', 'ko', 'zh', 'ru', 'ar'];
const words = (s: string) => s.trim().split(/\s+/).length;

/** a mutation that must hit exactly once: a silent no-op would make every "red" below a lie */
function mutate(src: string, from: string, to: string): string {
  const n = src.split(from).length - 1;
  assert.equal(n, 1, `mutation anchor must occur exactly once (found ${n}): ${from.slice(0, 70)}`);
  return src.split(from).join(to);
}
/** transpile a TypeScript snippet to JS and import it */
async function loadTs(code: string): Promise<any> {
  const js = stripTypeScriptTypes(code);
  return import('data:text/javascript;base64,' + Buffer.from(js).toString('base64'));
}
const must = (cond: unknown, msg: string, out: string[]) => { if (!cond) out.push(msg); };

/* ───────────────────────── G1 labels ───────────────────────── */
function labelProblems(def: Record<string, string>, keys: readonly string[]): string[] {
  const p: string[] = [];
  for (const k of KEYS) { must(typeof def[k] === 'string' && def[k].length > 0, `no English default for ${k}`, p); must(keys.includes(k), `${k} is not in LABEL_KEYS`, p); }
  for (const k of LEGEND_KEYS) must(def[k] && words(def[k]) <= 15, `${k} is ${def[k] ? words(def[k]) : '?'} words (>15)`, p);
  must(def.TNAV_SESSION_TIP && words(def.TNAV_SESSION_TIP) <= 20, 'TNAV_SESSION_TIP is over 20 words', p);
  must(def.CHART_LEGEND_TITLE && words(def.CHART_LEGEND_TITLE) <= 3, 'CHART_LEGEND_TITLE is over 3 words', p);
  for (const k of LEGEND_KEYS) must(def[k] && !/\b(will|should|expect|likely|buy|sell)\b/i.test(def[k]), `${k} reads as a forecast or advice`, p);
  return p;
}
test('G1. 12 keys are registered with English defaults; legend lines <= 15 words, tip <= 20, no forecast or advice words', () => {
  assert.deepEqual(labelProblems(defaults, LABEL_KEYS as readonly string[]), []);
});
test('G1-MUT. the label checks go red on a missing key, a long line and a forecast word', () => {
  const d = { ...defaults };
  assert.ok(labelProblems({ ...d, CHART_LEGEND_SR: undefined as unknown as string }, LABEL_KEYS as readonly string[]).length, 'missing default not caught');
  assert.ok(labelProblems({ ...d, CHART_LEGEND_GRADE: 'word '.repeat(16) }, LABEL_KEYS as readonly string[]).length, '16 words not caught');
  assert.ok(labelProblems({ ...d, CHART_LEGEND_SQZ_UP: 'Coins that will squeeze next.' }, LABEL_KEYS as readonly string[]).length, 'forecast word not caught');
  assert.ok(labelProblems(d, (LABEL_KEYS as readonly string[]).filter((k) => k !== 'CHART_LEGEND_ARIA')).length, 'unregistered key not caught');
});

/* ───────────────────────── G2 button + panel source pins ───────────────────────── */
function legendMarkupProblems(src: string): string[] {
  const p: string[] = [];
  const at = src.indexOf('ref={legendWrapRef}');
  const end = src.indexOf('<span className="klc-fs-wrap">');
  if (at < 0 || end < at) return ['legend markup not found'];
  const block = src.slice(at, end);
  must(/<button\b/.test(block) && !/<div[^>]*onClick/.test(block), 'the "?" is not a real <button>', p);
  must(block.includes('aria-expanded={legendOpen}'), 'no aria-expanded={legendOpen}', p);
  must(block.includes('aria-controls={legendPanelId}'), 'no aria-controls={legendPanelId}', p);
  must(block.includes("aria-label={tl('CHART_LEGEND_ARIA')}"), 'the button has no accessible name', p);
  must(block.includes('id={legendPanelId}'), 'the panel does not carry the id aria-controls points at', p);
  must(/role="region"/.test(block) && block.includes("aria-label={tl('CHART_LEGEND_TITLE')}"), 'the panel has no role + name', p);
  must(block.includes('onClick={() => setLegendOpen(v => !v)}'), 'the "?" does not toggle', p);
  must(block.includes('klc-tool-btn klc-clear'), 'the "?" lost klc-clear (it would vanish at 390)', p);
  must(block.includes("width: 'min(320px, calc(100vw - 32px))'"), 'the panel width is not capped to the viewport', p);
  must(/right: 0/.test(block) && /left: 'auto'/.test(block), 'the panel is not right-anchored', p);
  const rows = [...block.matchAll(/\['([^']+)', '(CHART_LEGEND_[A-Z_]+)'\]/g)].map((m) => `${m[1]}=${m[2]}`);
  must(JSON.stringify(rows) === JSON.stringify(['R / S=CHART_LEGEND_SR', 'MAX PAIN=CHART_LEGEND_MAX_PAIN', 'γ FLIP=CHART_LEGEND_GEX_FLIP', 'REALIZED=CHART_LEGEND_REALIZED', 'T · E · S=CHART_LEGEND_POSITION', '↑ n=CHART_LEGEND_SQZ_UP', '↓ n=CHART_LEGEND_SQZ_DOWN', 'A–F=CHART_LEGEND_GRADE']), `chip rows are ${JSON.stringify(rows)}`, p);
  return p;
}
test('G2. the "?" button and its panel: real button, expanded/controls/name, named panel, 8 chips in order, viewport-capped', () => {
  assert.deepEqual(legendMarkupProblems(chartSrc), []);
});
test('G2-MUT. each markup pin goes red when its line is removed', () => {
  const cuts: Array<[string, string]> = [
    ['aria-expanded={legendOpen}', 'data-x="1"'], ['aria-controls={legendPanelId}', 'data-x="1"'], ["aria-label={tl('CHART_LEGEND_ARIA')}", 'data-x="1"'],
    ['id={legendPanelId}', 'data-x="1"'], ['role="region"', 'data-x="1"'], ['onClick={() => setLegendOpen(v => !v)}', 'onClick={() => {}}'],
    ['klc-tool-btn klc-clear', 'klc-tool-btn'], ["width: 'min(320px, calc(100vw - 32px))'", "width: '320px'"], ["left: 'auto', right: 0", "left: 0"],
    ["['γ FLIP', 'CHART_LEGEND_GEX_FLIP'],", ''],
  ];
  for (const [from, to] of cuts) assert.ok(legendMarkupProblems(mutate(chartSrc, from, to)).length, `mutation not caught: ${from}`);
  const asDiv = mutate(chartSrc, '<button\n            className={`klc-tool-btn klc-clear${legendOpen', '<div onClick={() => {}}\n            className={`klc-tool-btn klc-clear${legendOpen');
  assert.ok(legendMarkupProblems(asDiv).length, 'button -> div not caught');
});

/* ───────────────────────── G3 the legend effect, run ───────────────────────── */
function legendEffectBody(src: string): string {
  const from = src.indexOf('const legendPanelId = useId();');
  assert.ok(from > 0, 'legendPanelId not found');
  const m = /useEffect\(\(\) => \{([\s\S]*?)\}, \[legendOpen\]\);/.exec(src.slice(from));
  assert.ok(m, 'the legend useEffect is not where it was');
  return m![1];
}
async function legendRun(src: string): Promise<string[]> {
  const p: string[] = [];
  const mod = await loadTs(`export default function run(legendOpen: boolean, setLegendOpen: any, legendWrapRef: any, document: any) {${legendEffectBody(src)}}`);
  const listeners = new Map<string, Set<(e: any) => void>>();
  const doc = {
    addEventListener: (t: string, f: any) => { (listeners.get(t) ?? listeners.set(t, new Set()).get(t)!).add(f); },
    removeEventListener: (t: string, f: any) => { listeners.get(t)?.delete(f); },
  };
  const count = () => [...listeners.values()].reduce((n, s) => n + s.size, 0);
  let focused = 0, open: boolean | null = null;
  const button = { focus: () => { focused++; } };
  const inside = {}, outside = {};
  const wrap = { current: { contains: (n: unknown) => n === inside, querySelector: (sel: string) => (sel === 'button' ? button : null) } };
  const setOpen = (v: boolean) => { open = v; };
  // closed: nothing is registered
  const cleanClosed = mod.default(false, setOpen, wrap, doc);
  must(count() === 0, 'listeners are registered while the legend is closed', p);
  must(cleanClosed === undefined, 'a closed legend returned a cleanup', p);
  // open: exactly a keydown and a pointerdown listener
  const cleanup = mod.default(true, setOpen, wrap, doc);
  must(listeners.get('keydown')?.size === 1 && listeners.get('pointerdown')?.size === 1 && count() === 2, `expected one keydown + one pointerdown, got ${[...listeners].map(([k, s]) => k + ':' + s.size)}`, p);
  const key = (k: string) => [...(listeners.get('keydown') ?? [])].forEach((f) => f({ key: k }));
  const down = (target: unknown) => [...(listeners.get('pointerdown') ?? [])].forEach((f) => f({ target }));
  key('Enter'); key('Tab'); key('a');
  must(open === null && focused === 0, 'a key other than Escape closed the legend or moved focus', p);
  down(inside);
  must(open === null, 'a press INSIDE the legend closed it (the "?" toggle would double-fire)', p);
  key('Escape');
  must(open === false, 'Escape did not close', p);
  must(focused === 1, `Escape did not return focus to the "?" exactly once (focus calls: ${focused})`, p);
  open = null; focused = 0;
  down(outside);
  must(open === false, 'a press outside did not close', p);
  must(focused === 0, 'an outside press stole focus', p);
  must(typeof cleanup === 'function', 'no cleanup returned', p);
  if (typeof cleanup === 'function') cleanup();
  must(count() === 0, `the cleanup left ${count()} listener(s) on document (leak after close / unmount)`, p);
  return p;
}
test('G3. the legend effect: Escape closes and returns focus, outside press closes, inside does not, cleanup leaves no listener', async () => {
  assert.deepEqual(await legendRun(chartSrc), []);
});
test('G3-MUT. the behavioural checks go red on each mutated copy', async () => {
  const body = legendEffectBody(chartSrc);
  assert.ok(body.includes("if (e.key !== 'Escape') return;"));
  const muts: Array<[string, string, string]> = [
    ['Escape check removed (any key closes)', "if (e.key !== 'Escape') return;", ''],
    ['focus not returned', "legendWrapRef.current?.querySelector<HTMLElement>('button')?.focus();", ''],
    ['outside press ignored', "!legendWrapRef.current?.contains(e.target as Node)", 'false'],
    ['inside press closes', "!legendWrapRef.current?.contains(e.target as Node)", 'true'],
    ['keydown never removed', "document.removeEventListener('keydown', onKey); ", ''],
    ['pointerdown never removed', " document.removeEventListener('pointerdown', onDown);", ''],
    ['registered while closed', 'if (!legendOpen) return;', ''],
    ['Escape does not close', "      setLegendOpen(false);\n      legendWrapRef", '      legendWrapRef'],
  ];
  const L = chartSrc.indexOf('const legendPanelId = useId();');
  for (const [name, from, to] of muts) { const L2 = chartSrc.indexOf('}, [legendOpen]);', L); const head = chartSrc.slice(0, L), mid = chartSrc.slice(L, L2), tail = chartSrc.slice(L2); assert.ok((await legendRun(head + mutate(mid, from, to) + tail)).length, `mutation not caught: ${name}`); }
});

/* ───────────────────────── A signOutOtherSessions ───────────────────────── */
const SESSION_KEY = 'sb-abcdefghijklmnop-auth-token';
function fakeStorage() {
  const removed: string[] = [];
  const store: Record<string, string> = { [SESSION_KEY]: 'x', theme: 'dark' };
  Object.defineProperty(store, 'removeItem', { enumerable: false, value: (k: string) => { removed.push(k); delete store[k]; } });
  (globalThis as { localStorage?: unknown }).localStorage = store;
  return { removed, store };
}
async function authRun(src: string): Promise<string[]> {
  const p: string[] = [];
  const mod = await loadTs(src);
  const fn = mod.signOutOtherSessions as (sb: unknown) => Promise<unknown>;
  if (typeof fn !== 'function') return ['signOutOtherSessions is not exported'];
  // A1 args + success
  let st = fakeStorage();
  const calls: unknown[][] = [];
  const ok = { auth: { signOut: async (...a: unknown[]) => { calls.push(a); return { error: null }; } } };
  const r1 = await fn(ok);
  must(calls.length === 1, `expected one signOut call, got ${calls.length}`, p);
  must(JSON.stringify(calls[0]) === JSON.stringify([{ scope: 'others' }]), `signOut args were ${JSON.stringify(calls[0])}, expected [{"scope":"others"}]`, p);
  must(r1 === null, `success returned ${String(r1)}, expected null`, p);
  must(st.removed.length === 0, 'the stored session was touched on success', p);
  // A2a error returned, session kept
  st = fakeStorage();
  const boom = new Error('offline');
  const r2 = await fn({ auth: { signOut: async () => ({ error: boom }) } });
  must(r2 === boom, 'an error response was not returned to the caller', p);
  must(st.removed.length === 0, `an error cleared the local session: ${st.removed}`, p);
  // A2b rejection
  st = fakeStorage();
  let r3: unknown, threw = false;
  try { r3 = await fn({ auth: { signOut: async () => { throw new Error('rejected'); } } }); } catch { threw = true; }
  must(!threw, 'a rejection escaped (the reset form would hang on its spinner)', p);
  must(r3 instanceof Error && r3.message === 'rejected', 'a rejection was not returned as the error', p);
  must(st.removed.length === 0, 'a rejection cleared the local session', p);
  // A2c hang
  st = fakeStorage();
  mock.timers.enable({ apis: ['setTimeout'] });
  try {
    const pending = fn({ auth: { signOut: () => new Promise(() => {}) } });
    mock.timers.tick(8000);
    const r4 = await Promise.race([pending, new Promise((res) => { setImmediate(() => res('STILL_WAITING')); })]);
    must(r4 instanceof Error && /timed out/.test(r4.message), `a hung signOut did not time out at 8 s (got ${String(r4)})`, p);
  } finally { mock.timers.reset(); }
  must(st.removed.length === 0, 'a hang cleared the local session', p);
  // null client
  must((await fn(null)) === null, 'null client did not return null', p);
  return p;
}
const fnStart = authSrc.indexOf('export async function signOutOtherSessions');
const fnEnd = fnStart < 0 ? -1 : authSrc.indexOf('\n}\n', fnStart) + 3;
test('A1/A2. signOutOtherSessions: scope "others" once; success null; error, rejection and hang are returned and the local session stays', async () => {
  assert.ok(fnStart > 0, 'signOutOtherSessions does not exist in lib/authSession.ts');
  assert.deepEqual(await authRun(authSrc), []);
});
test('A-CONTROL. the stand-in storage can see a clear: forceSignOut on an error DOES remove the session key', async () => {
  const mod = await loadTs(authSrc);
  const st = fakeStorage();
  await mod.forceSignOut({ auth: { signOut: async () => ({ error: new Error('x') }) } });
  assert.deepEqual(st.removed, [SESSION_KEY]);
});
test('A-MUT. the behavioural checks go red on each mutated copy of the function', async () => {
  assert.ok(fnStart > 0);
  const fnSrc = authSrc.slice(fnStart, fnEnd);
  const swap = (to: string) => authSrc.slice(0, fnStart) + to + authSrc.slice(fnEnd);
  const muts: Array<[string, string]> = [
    ['scope global', mutate(authSrc, "sb.auth.signOut({ scope: 'others' }),", "sb.auth.signOut({ scope: 'global' }),")],
    ['scope local', mutate(authSrc, "sb.auth.signOut({ scope: 'others' }),", "sb.auth.signOut({ scope: 'local' }),")],
    ['no scope (default global)', mutate(authSrc, "sb.auth.signOut({ scope: 'others' }),", 'sb.auth.signOut(),')],
    ['clears the local session on error', mutate(authSrc, 'return result.error ?? null;', 'if (result.error) clearStoredSession(); return result.error ?? null;')],
    ['swallows the error', mutate(authSrc, 'return result.error ?? null;', 'return null;')],
    ['no bound, no catch', swap('export async function signOutOtherSessions(sb: SignOutCapable | null | undefined): Promise<unknown> {\n  if (!sb) return null;\n  return (await sb.auth.signOut({ scope: \'others\' })).error ?? null;\n}\n')],
    ['no null guard', swap(mutate(fnSrc, '  if (!sb) return null;\n', ''))],
  ];
  for (const [name, src] of muts) assert.ok((await authRun(src)).length, `mutation not caught: ${name}`);
});

/* ───────────────────────── R reset-password submit(), run ───────────────────────── */
function submitBody(src: string): string {
  const from = src.indexOf('const submit = async () => {');
  const to = src.indexOf('\n  if (invalid) {', from);
  assert.ok(from > 0 && to > from, 'submit() not found in reset-password/page.tsx');
  return src.slice(from, to);
}
async function resetRun(src: string): Promise<string[]> {
  const p: string[] = [];
  const mod = await loadTs(`export default async function run(d: any) { const { password, confirmPassword, t, passwordMeetsPolicy, getSupabase, setLoading, setError, setDone, updatePassword, signOutOtherSessions, friendlyAuthError, router, setTimeout, console } = d; ${submitBody(src)}\n return submit(); }`);
  const make = (upd: { message: string } | null, others: unknown) => {
    const log: string[] = [];
    return {
      log,
      d: {
        password: 'Abcdefg1!x', confirmPassword: 'Abcdefg1!x', t: (k: string) => k, passwordMeetsPolicy: () => true, getSupabase: () => ({ sb: 1 }),
        setLoading: (v: boolean) => log.push('loading:' + v), setError: (v: string) => { if (v) log.push('error:' + v); }, setDone: (v: boolean) => log.push('done:' + v),
        updatePassword: async () => { log.push('update'); return { error: upd }; },
        signOutOtherSessions: async () => { log.push('others'); if (others === 'REJECT') throw new Error('boom'); return others; },
        friendlyAuthError: (m: string) => 'friendly:' + m, router: { push: (u: string) => log.push('push:' + u) },
        setTimeout: (f: () => void) => { f(); }, console: { error: (...a: unknown[]) => log.push('console.error:' + String(a[0]).slice(0, 12)) },
      },
    };
  };
  // failed update: nobody else is signed out
  let m = make({ message: 'weak' }, null);
  await mod.default(m.d);
  must(!m.log.includes('others'), 'signOutOtherSessions ran although the password update FAILED', p);
  must(m.log.includes('error:friendly:weak') && !m.log.includes('done:true'), 'a failed update did not show its error / still finished', p);
  must(m.log.includes('loading:false'), 'a failed update left the spinner on', p);
  // success: update THEN others, then done
  m = make(null, null);
  await mod.default(m.d);
  must(m.log.indexOf('update') >= 0 && m.log.indexOf('others') > m.log.indexOf('update'), `order was ${m.log}, expected update before others`, p);
  must(m.log.includes('done:true') && m.log.includes('push:/dashboard'), 'success did not finish and route to /dashboard', p);
  must(m.log.indexOf('loading:false') > m.log.indexOf('others'), 'the spinner stopped before the other sessions were ended', p);
  must(!m.log.some((x) => x.startsWith('error:')), 'a clean success showed an error', p);
  // others-call returns an error: logged, not shown, form still finishes
  m = make(null, new Error('403'));
  await mod.default(m.d);
  must(m.log.some((x) => x.startsWith('console.error')), 'a failed others-call was not logged', p);
  must(!m.log.some((x) => x.startsWith('error:')), 'a failed others-call was shown to the user as a failed reset', p);
  must(m.log.includes('done:true'), 'a failed others-call blocked the success state', p);
  return p;
}
test('R1. reset-password submit(): others-call only after a successful update; its failure is logged not shown; the form still finishes', async () => {
  assert.deepEqual(await resetRun(resetSrc), []);
});
test('R-MUT. the reset checks go red on each mutated copy of the page', async () => {
  const muts: Array<[string, string]> = [
    ['others-call before the update', mutate(resetSrc, '    const { error } = await updatePassword(sb, password);\n', '    await signOutOtherSessions(sb);\n    const { error } = await updatePassword(sb, password);\n')],
    ['no early return on a failed update', mutate(resetSrc, 'if (error) { setLoading(false); setError(friendlyAuthError(error.message)); return; }', 'if (error) { setError(friendlyAuthError(error.message)); }')],
    ['others-error shown to the user', mutate(resetSrc, "if (othersError) console.error('[auth] ending other sessions after reset failed:', othersError);", 'if (othersError) { setError(String(othersError)); return; }')],
    ['others-error not logged', mutate(resetSrc, "if (othersError) console.error('[auth] ending other sessions after reset failed:', othersError);", '')],
    ['others-call removed', mutate(resetSrc, 'const othersError = await signOutOtherSessions(sb);', 'const othersError = null;')],
    ['spinner stops before the others-call', mutate(resetSrc, '    setLoading(false);\n    setDone(true);', '    setDone(true);')],
  ];
  for (const [name, src] of muts) assert.ok((await resetRun(src)).length, `mutation not caught: ${name}`);
});
test('R2. the reset page calls signOutOtherSessions from lib/authSession, never auth.signOut directly', () => {
  assert.ok(/import \{[^}]*signOutOtherSessions[^}]*\} from '@\/lib\/authSession'/.test(resetSrc));
  assert.ok(!/\bauth\s*\.\s*signOut\s*\(/.test(resetSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')));
});

/* ───────────────────────── N session pill ───────────────────────── */
test('N1. the session pill carries the tip as its title', () => {
  assert.ok(/<span className="tnav-session" title=\{t\('TNAV_SESSION_TIP'\)\}/.test(navSrc));
  assert.ok(!/<span className="tnav-session" title=\{t\('TNAV_SESSION_TIP'\)\}/.test(mutate(navSrc, " title={t('TNAV_SESSION_TIP')}", '')));
});

/* ───────────────────────── migration 19z4 ───────────────────────── */
const sql = (() => { try { return read('../supabase/migrations/20261119z4_labels_onboarding_tracker.sql'); } catch { return ''; } })(); // absent on dev: the tests below go red, one by one
type Row = { key: string; locale: string; value: string };
function block(text: string, table: string): Row[] {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(text);
  assert.ok(m, `no upsert block for ${table}`);
  const rows = [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]+)','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
  assert.equal(m![1].trim().split('\n').length, rows.length, `${table}: a row line did not parse (unquoted apostrophe?)`);
  return rows;
}
const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
function migrationProblems(text: string): string[] {
  const p: string[] = [];
  let prod: Row[], dev: Row[];
  try { prod = block(text, 'lhq_labels'); dev = block(text, 'lhq_dev_labels'); } catch (e) { return [String((e as Error).message)]; }
  must(JSON.stringify(prod) === JSON.stringify(dev), 'the PROD block and the DEV block are not the same rows', p);
  must(prod.length === 60, `expected 60 rows, found ${prod.length}`, p);
  must(JSON.stringify([...new Set(prod.map((r) => r.key))].sort()) === JSON.stringify([...KEYS].sort()), 'the key set is not the 12 keys the PR ships', p);
  const seen = new Set<string>();
  for (const r of prod) { const id = `${r.key}/${r.locale}`; must(!seen.has(id), `duplicate ${id}`, p); seen.add(id); must(r.value.trim().length > 0, `empty ${id}`, p); }
  for (const k of KEYS) for (const l of LOCALES) must(seen.has(`${k}/${l}`), `missing ${k}/${l}`, p);
  for (const r of prod.filter((x) => x.locale === 'en')) { must(r.value === defaults[r.key], `${r.key}: en row differs from lib/labelDefaults.en.json`, p); must((LABEL_KEYS as readonly string[]).includes(r.key), `${r.key} not in labelKeys.ts`, p); }
  for (const k of KEYS) { const en = prod.find((r) => r.key === k && r.locale === 'en'); if (!en) continue; for (const l of LOCALES) { const r = prod.find((x) => x.key === k && x.locale === l); if (r) { must(ph(r.value) === ph(en.value), `${k}/${l}: placeholders differ`, p); must(r.value.length <= Math.max(30, en.value.length * 2), `${k}/${l}: ${r.value.length} chars vs en ${en.value.length}`, p); } } }
  const code = text.split('\n').filter((l) => !l.startsWith('--')).join('\n');
  const stmts = [...code.matchAll(/\b(insert into|update|delete from|alter table|drop|truncate|grant)\s+(\w+)/gi)].map((m) => `${m[1].toLowerCase()} ${m[2]}`).filter((s) => s !== 'update set');
  must(JSON.stringify(stmts) === JSON.stringify(['insert into lhq_labels', 'insert into lhq_dev_labels']), `statements are ${JSON.stringify(stmts)}`, p);
  return p;
}
test('M1. migration 19z4: PROD == DEV, 12 keys x 5 locales, en == shipped defaults, placeholders, lengths, only the two label tables', () => {
  assert.deepEqual(migrationProblems(sql), []);
});
test('M1-MUT. the migration checks go red on a planted drift', () => {
  const devAt = sql.indexOf('insert into lhq_dev_labels');
  assert.ok(devAt > 0);
  const driftDev = sql.slice(0, devAt) + sql.slice(devAt).replace("'Chart labels'", "'Chart labelz'");
  assert.ok(migrationProblems(driftDev).length, 'PROD/DEV drift not caught');
  assert.ok(migrationProblems(sql.replace("('CHART_LEGEND_TITLE','ko','차트 라벨'),\n", '')).length, 'a missing locale row (in PROD only) not caught');
  const en = "('CHART_LEGEND_ARIA','en','What the chart labels mean')";
  assert.ok(migrationProblems(sql.split(en).join("('CHART_LEGEND_ARIA','en','What the chart labels mean!')")).length, 'en != defaults not caught');
  assert.ok(migrationProblems(sql.replace(/\non conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/, '\non conflict (key, locale) do nothing;')).length, 'a changed upsert tail not caught');
  assert.ok(migrationProblems(sql + '\ndelete from lhq_labels;\n').length, 'an extra delete not caught');
  const long = sql.replace("('TNAV_SESSION_TIP','ko','현재 거래 세션 시간대와 남은 시간입니다.')", `('TNAV_SESSION_TIP','ko','${'가'.repeat(200)}')`);
  assert.ok(migrationProblems(long).length, 'a runaway translation length not caught');
});

/* ───────────────────────── J journal prompt: no figures ───────────────────────── */
test('J1. the signed-out journal prompt carries no figure (no digit, $, % or sample number) in any language', () => {
  const rows = block(sql, 'lhq_labels').filter((r) => r.key === 'TRADE_JOURNAL_AUTH_DESC');
  assert.equal(rows.length, 5);
  for (const r of [{ locale: 'default', value: defaults.TRADE_JOURNAL_AUTH_DESC }, ...rows]) assert.ok(!/[0-9٠-٩$%€£]/.test(r.value), `${r.locale}: "${r.value}" contains a figure`);
  assert.ok(/<AuthGate\s+title=\{t\('TRADE_JOURNAL_AUTH_TITLE'\)\}\s+desc=\{t\('TRADE_JOURNAL_AUTH_DESC'\)\}/.test(read('../components/TradeJournal.tsx')), 'the journal prompt is not the label-only AuthGate');
  assert.ok(/[0-9$%]/.test('Win rate 62%'), 'control: the figure regex fires on a figure');
});

/* ───────────────────────── L landing cards ───────────────────────── */
test('L1. the four landing cards and the Connect step: no jargon token, no vendor, no forecast word, in en/ko/zh/ru', async () => {
  const d = await import('../lib/i18n/dictionaries.ts');
  const JARGON = /\b(CVD|GEX|DXY|RSI|EMA|L\/S|FR|taker|S&P)\b|S&P/;
  const VENDOR = /Grok|xAI|Anthropic|Claude|OpenAI|GPT|Gemini|Deribit|Binance|Bybit|Coinglass/i;
  const FORECAST = /\b(will (go|rise|fall|pump|dump|hit)|guarantee[sd]?|predicts?|forecast)\b/i;
  const bad: string[] = [];
  for (const loc of ['en', 'ko', 'zh', 'ru'] as const) {
    const dict = (d as any)[loc];
    const all: Array<{ title: string; desc: string }> = [...dict.features.cards, ...dict.howItWorks.steps];
    assert.ok(all.length >= 9, `${loc}: found only ${all.length} cards/steps: the dictionary shape moved`);
    const target = all.filter((c) => /AI Arena|AI 아레나|AI Арена|Telegram|텔레그램|Утренн|Morning|모닝|晨间|Squeeze Scanner|스퀴즈 스캐너|挤压扫描器|Сканер/.test(c.title));
    assert.equal(target.length, 5, `${loc}: matched ${target.map((c) => c.title)} (want the 4 cards + the Connect step)`);
    for (const c of target) {
      if (JARGON.test(c.desc)) bad.push(`${loc} "${c.title}": jargon ${JARGON.exec(c.desc)![0]}`);
      if (VENDOR.test(c.desc)) bad.push(`${loc} "${c.title}": vendor ${VENDOR.exec(c.desc)![0]}`);
      if (FORECAST.test(c.desc)) bad.push(`${loc} "${c.title}": forecast word`);
    }
  }
  assert.deepEqual(bad, []);
  assert.ok(/\bCVD\b/.test('CVD and GEX'), 'control: the jargon regex fires');
});
