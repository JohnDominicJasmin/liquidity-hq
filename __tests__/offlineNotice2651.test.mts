import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

/* PR #2651 - a notice when the network connection drops.
   The PR's written rule: "role=status, never takes focus, disappears on the browser's online event"; a label key
   (OFFLINE_NOTICE) with an English default and a held migration for ko/zh/ru/ar; "it sits at the top" so it does not meet
   the tab bar or the Ask AI button; "never shows a false offline".

   Part 1 actually RUNS the component: the real OfflineNotice.tsx is compiled by the TypeScript compiler and executed
   against a tiny stand-in for React's hooks, a fake window and a fake navigator. There is no DOM in node, so what it
   proves is the logic (first paint, going offline, coming back, cleanup), not the pixels. Pixels need a browser run
   on GitHub CI. */

const read = (p: string): string => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');

/* ---------------- Part 1: run the real component ---------------- */
type El = { type: unknown; props: Record<string, unknown> };
function texts(node: unknown): string[] {
  if (node === null || node === undefined || typeof node === 'boolean') return [];
  if (typeof node === 'string' || typeof node === 'number') return [String(node)];
  if (Array.isArray(node)) return node.flatMap(texts);
  const el = node as El;
  return texts(el.props?.children);
}

function harness(onLine: boolean) {
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const win = {
    addEventListener(t: string, f: (e: unknown) => void) { if (!listeners.has(t)) listeners.set(t, new Set()); listeners.get(t)!.add(f); },
    removeEventListener(t: string, f: (e: unknown) => void) { listeners.get(t)?.delete(f); },
  };
  const nav = { onLine };
  const state: unknown[] = [];
  const ran: boolean[] = [];
  const cleanups: Array<(() => void) | void> = [];
  let pending: Array<() => void> = [];
  let hi = 0, ei = 0;
  let current: unknown = null;

  const reactShim = {
    useState(init: unknown) {
      const i = hi++;
      if (!(i in state)) state[i] = init;
      const set = (v: unknown) => { state[i] = typeof v === 'function' ? (v as (p: unknown) => unknown)(state[i]) : v; rerender(); };
      return [state[i], set];
    },
    useEffect(cb: () => (() => void) | void) {
      const i = ei++;
      if (!ran[i]) { ran[i] = true; pending.push(() => { cleanups[i] = cb(); }); }
    },
  };
  const jsx = (type: unknown, props: Record<string, unknown>) => ({ type, props });
  const shims: Record<string, unknown> = {
    react: reactShim,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '@/lib/labels': { useLabels: () => ({ t: (k: string) => `<<${k}>>` }) },
  };
  const js = ts.transpileModule(read('components/OfflineNotice.tsx'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod: { exports: { default?: () => unknown } } = { exports: {} };
  const req = (name: string) => { assert.ok(name in shims, 'OfflineNotice imports an unexpected module: ' + name); return shims[name]; };
  new Function('require', 'module', 'exports', 'window', 'navigator', js)(req, mod, mod.exports, win, nav);
  const Comp = mod.exports.default;
  assert.equal(typeof Comp, 'function', 'OfflineNotice has a default export');

  function renderOnce() { hi = 0; ei = 0; current = Comp!(); }
  function flush() { const p = pending; pending = []; p.forEach(f => f()); }
  function rerender() { renderOnce(); flush(); }
  return {
    nav,
    /** what the server (and the first client render) produces: effects never run */
    firstPaint(): unknown { renderOnce(); pending = []; return current; },
    mount() { renderOnce(); flush(); },
    view: () => current,
    fire(type: 'online' | 'offline') { [...(listeners.get(type) ?? [])].forEach(f => f({ type })); },
    count: (type: string) => listeners.get(type)?.size ?? 0,
    unmount() { cleanups.forEach(c => { if (typeof c === 'function') c(); }); },
  };
}

/* "Shown" means the user can read words, not that the component returned a node: an always-present empty live region is allowed. */
const words = (v: unknown): string => texts(v).join('').trim();
function collect(v: unknown, pred: (e: El) => boolean, out: El[] = []): El[] {
  if (v === null || v === undefined || typeof v !== 'object') return out;
  if (Array.isArray(v)) { v.forEach(c => collect(c, pred, out)); return out; }
  const e = v as El;
  if (e.props) { if (pred(e)) out.push(e); collect(e.props.children, pred, out); }
  return out;
}
const statusNodes = (v: unknown): El[] => collect(v, e => e.props.role === 'status');

test('hydration: the first render shows no words even when the browser is already offline', () => {
  const h = harness(false);
  assert.equal(words(h.firstPaint()), '', 'server/first paint must render no notice (else the markup differs from the server)');
});

test('online at load: nothing shown', () => {
  const h = harness(true);
  h.mount();
  assert.equal(words(h.view()), '');
});

test('already offline at load: the notice appears after mount', () => {
  const h = harness(false);
  h.mount();
  assert.equal(words(h.view()), '<<OFFLINE_NOTICE>>', 'its words come from the OFFLINE_NOTICE label, nothing hard-coded');
});

test('going offline shows it, coming back online removes it, repeatedly', () => {
  const h = harness(true);
  h.mount();
  assert.equal(words(h.view()), '');
  for (let round = 0; round < 3; round++) {
    h.nav.onLine = false; h.fire('offline');
    assert.equal(words(h.view()), '<<OFFLINE_NOTICE>>', `round ${round}: shown after the offline event`);
    h.nav.onLine = true; h.fire('online');
    assert.equal(words(h.view()), '', `round ${round}: gone after the online event`);
  }
});

/* The repo's own rule (qa/e2e/a11y-auth.spec.ts U5, written after the 2026-08-06.4 release; WCAG 2.2 SC 4.1.3): a live region only
   announces a change if it EXISTED, empty, before the change. A role="status" element that is created together with its text has
   nothing to announce against. OfflineNotice returns null until offline, so the region and the words arrive in the same render. */
test('the live region exists BEFORE the message does (SC 4.1.3; repo rule U5), and the words land in that same node', () => {
  const h = harness(true);
  h.mount();
  const before = statusNodes(h.view());
  assert.equal(before.length, 1, 'online: one role=status container is already in the page, empty');
  assert.equal(words(before[0]), '');
  h.nav.onLine = false; h.fire('offline');
  const after = statusNodes(h.view());
  assert.equal(after.length, 1);
  assert.equal(words(after[0]), '<<OFFLINE_NOTICE>>', 'the words arrive inside the container that was already there');
  h.nav.onLine = true; h.fire('online');
  assert.equal(statusNodes(h.view()).length, 1, 'and the container stays after the connection returns');
  assert.equal(words(statusNodes(h.view())[0]), '');
});

test('the shown notice is polite status: role=status, no alert, no assertive live region, nothing that takes focus', () => {
  const h = harness(false);
  h.mount();
  const el = statusNodes(h.view())[0];
  assert.ok(el, 'a role=status element is rendered while offline');
  assert.equal(el.props.role, 'status');
  assert.equal(collect(h.view(), e => e.props.role === 'alert' || e.props['aria-live'] === 'assertive').length, 0, 'no alert, no assertive region');
  for (const node of collect(h.view(), () => true)) {
    assert.equal('tabIndex' in node.props, false, 'nothing focusable');
    assert.equal('autoFocus' in node.props, false, 'no autofocus');
  }
  const src = read('components/OfflineNotice.tsx');
  assert.doesNotMatch(src, /\.focus\s*\(/, 'never moves focus');
  assert.doesNotMatch(src, /role="alert"|aria-live="assertive"/);
});

test('cleanup: unmounting removes both listeners (no leak, no update after unmount)', () => {
  const h = harness(true);
  h.mount();
  assert.equal(h.count('offline'), 1);
  assert.equal(h.count('online'), 1);
  h.unmount();
  assert.equal(h.count('offline'), 0, 'offline listener removed');
  assert.equal(h.count('online'), 0, 'online listener removed');
});

test('never a false offline: only navigator.onLine === false counts as offline', () => {
  const h = harness(true);
  h.mount();
  (h.nav as { onLine: unknown }).onLine = undefined; h.fire('offline');
  assert.equal(words(h.view()), '', 'an unknown onLine value must not show the notice');
  h.nav.onLine = true; h.fire('offline');
  assert.equal(words(h.view()), '', 'a stray offline event while onLine is true must not show it');
});

/* ---------------- Part 2: mounting, label key, migration ---------------- */
test('AppShell mounts OfflineNotice inside the providers, next to the save toast, on the main (non-auth) shell', () => {
  const shell = read('components/AppShell.tsx');
  assert.match(shell, /import OfflineNotice from '\.\/OfflineNotice';/);
  const i = shell.indexOf('<OfflineNotice />');
  assert.ok(i > 0, 'mounted');
  assert.equal(shell.indexOf('<OfflineNotice />', i + 1), -1, 'mounted exactly once');
  assert.ok(i > shell.indexOf('<LabelsProvider>', shell.indexOf('return (\n    <PostHogProvider>')), 'inside LabelsProvider so t() has its labels');
  assert.ok(Math.abs(i - shell.indexOf('<SettingsSaveToast />', shell.indexOf('<PWAInstallPrompt />'))) < 80, 'next to the save toast, as the PR says');
});

const EN = 'You are offline. Figures may be out of date.';
test('label key: one OFFLINE_NOTICE in LABEL_KEYS, an English default, and sensible English copy', () => {
  const keys = read('lib/labelKeys.ts');
  assert.equal(keys.match(/'OFFLINE_NOTICE'/g)?.length, 1, 'declared once in LABEL_KEYS');
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  assert.equal(defaults.OFFLINE_NOTICE, EN);
  const ops = JSON.parse(read('lib/labelDefaults.ops.en.json')) as Record<string, string>;
  assert.equal('OFFLINE_NOTICE' in ops, false, 'not duplicated in the ops defaults');
  // copy rules: says what is true now, no forecast or advice, never names the AI vendor or model
  assert.doesNotMatch(defaults.OFFLINE_NOTICE, /\b(will|expect|predict|forecast|should|buy|sell|trade|signal)\b/i);
  assert.doesNotMatch(defaults.OFFLINE_NOTICE, /claude|anthropic|openai|gpt|gemini|grok|xai|llm/i);
  assert.ok(defaults.OFFLINE_NOTICE.length <= 80, 'short enough for a 420px toast');
});

test('migration 20261123b: held, one block per project, five locales each, en equals the shipped default, translations are in the right script', () => {
  const sql = read('supabase/migrations/20261123b_labels_offline_notice.sql');
  assert.match(sql, /^-- NOT YET APPLIED TO ANY DATABASE\./, 'carries the not-applied header');
  const clean = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(clean, /,\s*on\s+conflict/i, 'a comma directly before "on conflict" is a SQL syntax error');
  assert.equal(clean.match(/\)\s*,?\s*\n?\s*\(\s*'/g)?.filter(x => !x.includes(',')).length ?? 0, 0, 'every pair of value rows is separated by a comma');
  const blocks = [...clean.matchAll(/insert into (lhq_labels|lhq_dev_labels) \(key, locale, value\) values([\s\S]*?)on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g)];
  assert.deepEqual(blocks.map(b => b[1]), ['lhq_labels', 'lhq_dev_labels'], 'PROD block then DEV block, no others');
  const SCRIPT: Record<string, RegExp> = { en: /^[\x20-\x7e]+$/, ko: /[\uac00-\ud7af]/, zh: /[\u4e00-\u9fff]/, ru: /[\u0400-\u04ff]/, ar: /[\u0600-\u06ff]/ };
  const seen: string[] = [];
  for (const b of blocks) {
    const rows = [...b[2].matchAll(/\('([A-Z_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)];
    assert.equal(rows.length, 5, `${b[1]}: five rows`);
    assert.equal(b[2].replace(/\('[A-Z_]+','[a-z]{2}','(?:[^']|'')*'\)/g, '').replace(/[\s,]/g, ''), '', `${b[1]}: nothing but well-formed rows`);
    assert.deepEqual(rows.map(r => r[2]), ['en', 'ko', 'zh', 'ru', 'ar'], `${b[1]}: locales`);
    for (const r of rows) {
      assert.equal(r[1], 'OFFLINE_NOTICE');
      assert.match(r[3], SCRIPT[r[2]], `${b[1]} ${r[2]} is written in its own script`);
      assert.ok(r[3].length > 5 && r[3].length <= 80, `${b[1]} ${r[2]} length`);
      assert.doesNotMatch(r[3], /claude|anthropic|openai|gpt|gemini|grok|xai/i);
    }
    assert.equal(rows[0][3], EN, `${b[1]}: en equals the shipped default`);
    seen.push(rows.map(r => r[3]).join('|'));
  }
  assert.equal(seen[0], seen[1], 'PROD and DEV blocks carry identical text');
});

/* ---------------- Part 3: placement and look, read from CSS ---------------- */
const CSS = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
type Rule = { sel: string; body: string; media: string };
const RULES: Rule[] = [];
function walk(start: number, end: number, media: string): void {
  let i = start;
  while (i < end) {
    const o = CSS.indexOf('{', i);
    if (o < 0 || o >= end) break;
    const pre = CSS.slice(i, o);
    const head = pre.slice(pre.lastIndexOf(';') + 1).trim();
    let d = 1, j = o + 1;
    while (j < end && d) { if (CSS[j] === '{') d++; else if (CSS[j] === '}') d--; j++; }
    const body = CSS.slice(o + 1, j - 1);
    if (head.startsWith('@media') || head.startsWith('@supports')) walk(o + 1, j - 1, head);
    else if (!head.startsWith('@')) RULES.push({ sel: head.replace(/\s+/g, ' '), body, media });
    i = j;
  }
}
walk(0, CSS.length, '');
function decl(sel: string, prop: string, media = ''): string | null {
  let out: string | null = null;
  const re = new RegExp('(?<![\\w-])' + prop + '\\s*:\\s*([^;}]+)', 'g');
  for (const r of RULES) {
    if (r.media !== (media ? '@media ' + media : '') || !r.sel.split(',').map(s => s.trim()).includes(sel)) continue;
    for (const m of r.body.matchAll(re)) out = m[1].trim();
  }
  return out;
}

test('the notice reuses the amber status toast, and that toast is a passive, top-centre, narrow overlay', () => {
  const src = read('components/OfflineNotice.tsx');
  assert.match(src, /className="st-save-toast conflict"/);
  assert.equal(decl('.st-save-toast', 'position'), 'fixed');
  assert.equal(decl('.st-save-toast', 'left'), '50%');
  assert.equal(decl('.st-save-toast', 'pointer-events'), 'none', 'taps pass through to the controls underneath');
  assert.equal(decl('.st-save-toast.conflict', 'pointer-events'), null, 'the amber variant does not turn pointer events back on');
  const maxW = decl('.st-save-toast', 'max-width');
  assert.equal(maxW, 'min(92vw, 420px)', 'never wider than 92% of the screen: no sideways scroll at 390');
  assert.equal(decl('.st-save-toast', 'animation')?.startsWith('stToastIn'), true);
  assert.ok(RULES.some(r => r.media.includes('prefers-reduced-motion') && r.body.includes('.st-save-toast') === false && r.sel === '.st-save-toast' && /animation:\s*none/.test(r.body)), 'reduced motion switches the entrance off');
});

test('stacking and offsets: below the Ask AI panel and modals, under the top bar at desktop and at phone width, below the announcement banner', () => {
  const z = Number(decl('.st-save-toast', 'z-index'));
  assert.ok(z > 1000, 'above page content and the bars (z 1000)');
  assert.ok(z < 9994, 'below the Ask AI panel (9994) and modals (10000)');
  const topDesktop = decl('.st-save-toast', 'top') ?? '';
  const topPhone = decl('.st-save-toast', 'top', '(max-width: 767px)') ?? '';
  assert.match(topDesktop, /var\(--banner-h/, 'clears the announcement banner');
  assert.match(topPhone, /var\(--banner-h/);
  assert.match(topPhone, /env\(safe-area-inset-top/, 'clears the notch on phones');
  // the bar heights the offsets must clear: terminal --appbar-h (the design in use) at desktop and at phone width
  const bar = (media: string): number => {
    const r = RULES.find(x => x.media === (media ? '@media ' + media : '') && x.sel === '[data-design="terminal"]' && /--appbar-h:/.test(x.body));
    assert.ok(r, 'terminal --appbar-h rule for ' + (media || 'desktop'));
    return Number(/--appbar-h:\s*([\d.]+)px/.exec(r!.body)![1]);
  };
  const barDesk = bar(''), barPhone = bar('(max-width: 767px)');
  const px = (s: string) => [...s.matchAll(/(\d+)px/g)].map(m => Number(m[1])).reduce((a, b) => a + b, 0);
  assert.ok(px(topDesktop) >= barDesk, `desktop offset ${px(topDesktop)}px must clear the ${barDesk}px bar`);
  assert.ok(px(topPhone) >= barPhone, `phone offset ${px(topPhone)}px must clear the ${barPhone}px bar`);
});

/* colour: the amber text on its tint, over each base surface, in all four themes */
function block(selectors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RULES) {
    if (r.media || !selectors.includes(r.sel)) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  }
  assert.ok(Object.keys(out).length > 5, 'token block: ' + selectors.join(' | '));
  return out;
}
const ROOT = block([':root']), LIGHT = block(['[data-theme="light"]']);
const T_DARK = block(['[data-design="terminal"]:not([data-theme="light"])']), T_LIGHT = block(['[data-design="terminal"][data-theme="light"]']);
const CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...ROOT }], ['current light', { ...ROOT, ...LIGHT }],
  ['terminal dark', { ...ROOT, ...T_DARK }], ['terminal light', { ...ROOT, ...LIGHT, ...T_LIGHT }],
];
function resolveVar(map: Record<string, string>, v: string, depth = 0): string {
  assert.ok(depth < 12, 'var chain too deep');
  const m = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/.exec(v.trim());
  if (!m) return v.trim();
  const next = map[m[1]] ?? m[2];
  assert.ok(next !== undefined, 'unresolved ' + m[1]);
  return resolveVar(map, next, depth + 1);
}
function parse(s: string, map?: Record<string, string>): number[] {
  const t = s.trim();
  const cm = /^color-mix\(in srgb,\s*(.+?)\s+([\d.]+)%\s*,\s*transparent\)$/.exec(t);
  if (cm) { assert.ok(map, 'color-mix needs a token map'); const c = parse(resolveVar(map!, cm[1]), map); return [c[0], c[1], c[2], c[3] * Number(cm[2]) / 100]; }
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [0, 2, 4].map(i => parseInt(m![1].slice(i, i + 2), 16)).concat(1);
  m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return [0, 1, 2].map(i => parseInt(m![1][i] + m![1][i], 16)).concat(1);
  const r = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  assert.ok(r, 'cannot parse ' + t);
  return [Number(r![1]), Number(r![2]), Number(r![3]), r![4] === undefined ? 1 : Number(r![4])];
}
const over = (f: number[], b: number[]) => [0, 1, 2].map(i => f[i] * f[3] + b[i] * (1 - f[3]));
const lum = (c: number[]) => { const l = c.slice(0, 3).map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }); return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2]; };
const ratio = (a: number[], b: number[]) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

test('amber notice text reaches 4.5:1 on its tint over every base surface, in all four themes', () => {
  assert.equal(decl('.st-save-toast.conflict', 'color'), 'var(--amber)');
  assert.equal(decl('.st-save-toast.conflict', 'background'), 'var(--amber-bg)');
  const bad: string[] = [];
  for (const [theme, map] of CONTEXTS) {
    for (const surf of ['bg0', 'bg1', 'bg2']) {
      const base = parse(resolveVar(map, `var(--${surf})`));
      const bg = over(parse(resolveVar(map, 'var(--amber-bg)'), map), base);
      const r = ratio(over(parse(resolveVar(map, 'var(--amber)')), bg), bg);
      if (process.env.DUMP) console.log(theme, surf, r.toFixed(2));
      if (r < 4.5) bad.push(`${theme} on ${surf}: ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(bad, []);
});
