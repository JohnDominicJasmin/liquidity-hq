import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';

/* PR #2649 - accessibility: menus, regions, names, target sizes, reduced motion (tracker #1185).
   Expected values come from the PR's written claims, WCAG 2.2 (SC 2.5.8 target size 24x24, SC 4.1.3 status messages,
   SC 2.3.3 / prefers-reduced-motion) and this repo's own written a11y rule (qa/e2e/a11y-auth.spec.ts U5: "a live region
   only announces a change if it EXISTED before the change"), not from what the code happens to do.

   Three kinds of test:
     - RUN: the real component is compiled by the TypeScript compiler and executed against a tiny stand-in for React's
       hooks, a fake document and fake elements (LanguageSwitcher keyboard behaviour; the chart tabindex fix).
     - SOURCE: the markup the PR says it added is read back from the file (role, aria-*, tabIndex, ids, label keys).
     - CSS: sizes and the reduced-motion rule are read from app/globals.css.
   Not covered (needs a browser or a screen reader, on GitHub CI): that the focus ring is visible on each new tab stop,
   that nothing clips at 390px in ru, and what a screen reader actually announces. */

const read = (p: string): string => readFileSync(new URL('../' + p, import.meta.url), 'utf8').replaceAll('\r\n', '\n');
const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof import('typescript');

/* ====================== tiny component runtime (no DOM in node) ====================== */
type Node_ = { type: unknown; props: Record<string, unknown> };
function walkTree(n: unknown, fn: (x: Node_) => void): void {
  if (n === null || n === undefined || typeof n !== 'object') return;
  if (Array.isArray(n)) { n.forEach(c => walkTree(c, fn)); return; }
  const el = n as Node_;
  if (el.props) { fn(el); walkTree(el.props.children, fn); }
}
function findAll(tree: unknown, pred: (x: Node_) => boolean): Node_[] {
  const out: Node_[] = [];
  walkTree(tree, x => { if (pred(x)) out.push(x); });
  return out;
}
const hasClass = (n: Node_, c: string): boolean => typeof n.props.className === 'string' && n.props.className.split(/\s+/).includes(c);

function runtime(file: string, props: Record<string, unknown>, shims: Record<string, unknown> = {}) {
  const docListeners = new Map<string, Set<(e: unknown) => void>>();
  const doc = {
    addEventListener(t: string, f: (e: unknown) => void) { if (!docListeners.has(t)) docListeners.set(t, new Set()); docListeners.get(t)!.add(f); },
    removeEventListener(t: string, f: (e: unknown) => void) { docListeners.get(t)?.delete(f); },
  };
  const focused: string[] = [];
  const state: unknown[] = [];
  const refs: Array<{ current: unknown }> = [];
  const effects: Array<{ deps?: unknown[]; cleanup?: () => void } | undefined> = [];
  let pending: Array<() => void> = [];
  let hi = 0, ri = 0, ei = 0;
  let tree: unknown = null;

  const react = {
    useState(init: unknown) {
      const i = hi++;
      if (!(i in state)) state[i] = init;
      const set = (v: unknown) => { state[i] = typeof v === 'function' ? (v as (p: unknown) => unknown)(state[i]) : v; rerender(); };
      return [state[i], set];
    },
    useRef(init?: unknown) { const i = ri++; if (!refs[i]) refs[i] = { current: init ?? null }; return refs[i]; },
    useEffect(cb: () => (() => void) | void, deps?: unknown[]) {
      const i = ei++;
      const prev = effects[i];
      const changed = !prev || !deps || !prev.deps || deps.length !== prev.deps.length || deps.some((d, k) => !Object.is(d, prev.deps![k]));
      if (changed) pending.push(() => { prev?.cleanup?.(); const c = cb(); effects[i] = { deps, cleanup: typeof c === 'function' ? c : undefined }; });
    },
  };
  const jsx = (type: unknown, p: Record<string, unknown>) => ({ type, props: p });
  const all: Record<string, unknown> = {
    react,
    'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    'next/link': { default: 'Link' },
    ...shims,
  };
  const js = ts.transpileModule(read(file), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2020 },
  }).outputText;
  const mod: { exports: { default?: (p: Record<string, unknown>) => unknown } } = { exports: {} };
  const req = (n: string) => { assert.ok(n in all, `${file} imports an unexpected module: ${n}`); return all[n]; };
  new Function('require', 'module', 'exports', 'document', js)(req, mod, mod.exports, doc);
  const Comp = mod.exports.default as (p: Record<string, unknown>) => unknown;
  assert.equal(typeof Comp, 'function');

  function makeEl(node: Node_): unknown {
    const sub = (): Node_[] => findAll(node.props.children, () => true);
    return {
      contains: (t: unknown) => t === node || sub().some(s => s === t),
      querySelector: (sel: string) => {
        const cls = sel.replace(/^\./, '');
        const hit = [node, ...sub()].find(s => hasClass(s, cls));
        return hit ? { focus: () => focused.push(cls) } : null;
      },
    };
  }
  function renderOnce() {
    hi = 0; ri = 0; ei = 0;
    tree = Comp(props);
    walkTree(tree, n => { const r = n.props.ref as { current: unknown } | undefined; if (r && typeof r === 'object' && 'current' in r) r.current = makeEl(n); });
  }
  function flush() { const p = pending; pending = []; p.forEach(f => f()); }
  function rerender() { renderOnce(); flush(); }
  return {
    mount() { renderOnce(); flush(); },
    tree: () => tree,
    focused,
    listeners: (t: string) => docListeners.get(t)?.size ?? 0,
    fire(t: string, ev: unknown) { [...(docListeners.get(t) ?? [])].forEach(f => f(ev)); },
    click(cls: string) {
      const n = findAll(tree, x => hasClass(x, cls))[0];
      assert.ok(n, `no element with class ${cls}`);
      (n.props.onClick as () => void)();
    },
    unmount() { effects.forEach(e => e?.cleanup?.()); },
    outside: { not: 'in the component' } as unknown,
  };
}

/* ====================== 1. Language menus ====================== */
test('landing language menu: opens, marks only the current language aria-current, closes on Escape and puts focus back on its button', () => {
  const r = runtime('components/LanguageSwitcher.tsx', { locale: 'ko' });
  r.mount();
  const btn = () => findAll(r.tree(), n => hasClass(n, 'lp-lang-btn'))[0];
  assert.equal(btn().props['aria-expanded'], false);
  assert.equal(r.listeners('keydown'), 0, 'no key listener while the menu is closed (it must not steal Escape from the rest of the page)');

  r.click('lp-lang-btn');
  assert.equal(btn().props['aria-expanded'], true);
  const links = findAll(r.tree(), n => n.type === 'Link');
  assert.ok(links.length >= 3, 'menu items rendered');
  const current = links.filter(l => l.props['aria-current'] === 'true');
  assert.equal(current.length, 1, 'exactly one item is current');
  assert.equal(current[0].props.href, '/ko', 'the current one is the visitor\'s language');
  assert.ok(links.filter(l => l !== current[0]).every(l => l.props['aria-current'] === undefined), 'no other item carries aria-current');
  assert.equal(r.listeners('keydown'), 1, 'key listener only while open');

  r.fire('keydown', { key: 'ArrowDown' });
  assert.equal(btn().props['aria-expanded'], true, 'other keys do not close it');
  assert.deepEqual(r.focused, [], 'and do not move focus');

  r.fire('keydown', { key: 'Escape' });
  assert.equal(btn().props['aria-expanded'], false, 'Escape closes');
  assert.deepEqual(r.focused, ['lp-lang-btn'], 'and focus goes back to the button that opened the menu');
  assert.equal(r.listeners('keydown'), 0, 'listener removed once closed');
});

test('landing language menu: a click outside closes it without moving focus; unmount leaves no listeners', () => {
  const r = runtime('components/LanguageSwitcher.tsx', { locale: 'en' });
  r.mount();
  r.click('lp-lang-btn');
  assert.equal(findAll(r.tree(), n => n.type === 'Link').length > 0, true);
  r.fire('mousedown', { target: r.outside });
  assert.equal(findAll(r.tree(), n => n.type === 'Link').length, 0, 'menu closed by the outside click');
  assert.deepEqual(r.focused, [], 'outside click does not pull focus back');
  r.click('lp-lang-btn');
  r.unmount();
  assert.equal(r.listeners('keydown'), 0);
  assert.equal(r.listeners('mousedown'), 0);
});

test('app language menu: current language is aria-current, the button keeps a labelled name and aria-expanded, Escape still returns focus', () => {
  const src = read('components/LanguageNavSwitcher.tsx');
  assert.match(src, /aria-current=\{locale === l \? 'true' : undefined\}/);
  assert.match(src, /aria-label=\{t\('A11Y_CHANGE_LANGUAGE'\)\}\s+aria-expanded=\{open\}/);
  assert.match(src, /e\.key === 'Escape'\) \{ setOpen\(false\); wrapRef\.current\?\.querySelector<HTMLElement>\('\.lang-nav-btn'\)\?\.focus\(\)/);
});

/* ====================== 2. Ask AI panel and launcher ====================== */
function walkFiles(dir: string, out: string[] = []): string[] {
  const root = new URL('../' + dir + '/', import.meta.url);
  for (const name of readdirSync(root)) {
    const p = dir + '/' + name;
    if (statSync(new URL('../' + p, import.meta.url)).isDirectory()) walkFiles(p, out);
    else if (/\.tsx$/.test(name)) out.push(p);
  }
  return out;
}
test('Ask AI: the panel is a region named from the "Ask AI" label, the launcher reports expanded and points at it, the id is unique', () => {
  const src = read('components/GrokChat.tsx');
  const at = src.indexOf('aria-controls="gchat-panel"');
  assert.ok(at > 0, 'launcher has aria-controls');
  const launcher = src.slice(src.lastIndexOf('<button', at), src.indexOf('>', at));
  assert.match(launcher, /aria-expanded=\{open\}/, 'launcher exposes expanded/collapsed');
  assert.match(launcher, /aria-label=\{t\('CHAT_OPEN_AI_CHAT'\)\}/, 'launcher keeps its own name');
  const idAt = src.indexOf('id="gchat-panel"');
  assert.ok(idAt > 0);
  const panel = src.slice(src.lastIndexOf('<div', idAt), src.indexOf('>', src.indexOf('aria-hidden', idAt)));
  assert.match(panel, /role="region"/);
  assert.match(panel, /aria-label=\{t\('GROK_FAB_LABEL'\)\}/);
  assert.match(panel, /inert=\{!open\}/, 'still inert while closed (a hidden region must not be reachable)');
  assert.match(panel, /aria-hidden=\{!open\}/);
  assert.match(panel, /data-testid="grok-panel"/);
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  assert.equal(defaults.GROK_FAB_LABEL, 'Ask AI', 'the region is named "Ask AI" as the PR says');
  assert.doesNotMatch(defaults.GROK_FAB_LABEL + defaults.CHAT_OPEN_AI_CHAT, /claude|anthropic|openai|gpt|gemini|grok|xai/i, 'the product UI never names the AI vendor or model');
  let ids = 0, controls = 0;
  for (const f of [...walkFiles('components'), ...walkFiles('app')]) {
    const s = read(f);
    ids += s.match(/\bid="gchat-panel"/g)?.length ?? 0;
    controls += s.match(/aria-controls="gchat-panel"/g)?.length ?? 0;
  }
  assert.equal(ids, 1, 'one element carries id="gchat-panel"');
  assert.equal(controls, 1, 'one launcher points at it');
});

/* ====================== 3. /reset-password ====================== */
test('/reset-password: both password fields are marked invalid and described by the error; PasswordField wires aria-invalid and aria-describedby', () => {
  const page = read('app/(main)/reset-password/page.tsx');
  assert.equal(page.match(/invalid=\{!!error\}/g)?.length, 2, 'both fields');
  assert.equal(page.match(/describedBy="reset-error"/g)?.length, 2, 'both fields point at the error');
  assert.equal(page.match(/id="reset-error"/g)?.length, 1, 'the error element carries that id exactly once');
  assert.match(page, /id="reset-error"[^>]*role="alert"/, 'the error is an alert');
  const field = read('components/PasswordField.tsx');
  assert.match(field, /aria-invalid=\{invalid \|\| undefined\}/);
  assert.match(field, /aria-describedby=\{invalid \? describedBy : undefined\}/, 'describedby only while invalid, so it never points at nothing');
});

/* The repo's own rule (qa/e2e/a11y-auth.spec.ts U5, written after the 2026-08-06.4 release): role="alert" on an element that is
   created together with its text announces nothing. /login (magic-link and password) and /forgot-password render the container
   unconditionally and let CSS `.login-error:empty` collapse it. /reset-password is the one auth form that does not. */
const CONDITIONAL_LIVE = /\{[^{}]*&&\s*<div[^>]*\b(?:role="alert"|id="reset-error")/;
test('control: the pattern detector fires on a conditionally mounted alert and not on an always-mounted one', () => {
  assert.match('{error && <div className="login-error" id="x" role="alert">{error}</div>}', CONDITIONAL_LIVE);
  assert.doesNotMatch('<div className="login-error" id="x" role="alert">{error}</div>', CONDITIONAL_LIVE);
  for (const f of ['app/(main)/login/page.tsx', 'app/(main)/forgot-password/page.tsx']) {
    assert.doesNotMatch(read(f), CONDITIONAL_LIVE, `${f} renders its alert container unconditionally (the reference pattern)`);
  }
});
test('/reset-password: the error alert container exists BEFORE the error does (SC 4.1.3; repo rule U5), like /login and /forgot-password', () => {
  const page = read('app/(main)/reset-password/page.tsx');
  assert.equal(CONDITIONAL_LIVE.test(page), false, 'the error alert is mounted together with its text ({error && <div ... role="alert">}), so a screen reader has no change to announce');
  assert.match(page, /<div className="login-error" id="reset-error"[^>]*role="alert"[^>]*>\{error\}<\/div>/, 'an always-mounted container whose content is {error}');
  assert.match(read('app/globals.css'), /\.login-error:empty\s*\{/, 'and CSS collapses it while empty');
});

/* ====================== 4. Target sizes (WCAG 2.5.8, 24x24 CSS px) ====================== */
const CSS = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));
type Rule = { sel: string; body: string; media: string; idx: number };
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
    else if (!head.startsWith('@')) RULES.push({ sel: head.replace(/\s+/g, ' '), body, media, idx: RULES.length });
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
const px = (v: string | null): number => { const m = /^([\d.]+)px$/.exec((v ?? '').trim()); assert.ok(m, 'not a px value: ' + v); return Number(m![1]); };
const PHONE = '(max-width: 760px)';

test('phones: the news ticker bar, its text line and both buttons are at least 24x24 (was 19), and the page already reserves room for it', () => {
  assert.ok(px(decl('.news-ticker', 'height', PHONE)) >= 24, 'bar height');
  assert.ok(px(decl('.ticker-close', 'height', PHONE)) >= 24, 'button height');
  assert.ok(px(decl('.ticker-close', 'width', PHONE)) >= 24, 'button width');
  assert.ok(px(decl('.ticker-close', 'min-width')) >= 24, 'base min-width');
  assert.ok(px(decl('.ticker-content span', 'line-height', PHONE)) <= px(decl('.news-ticker', 'height', PHONE)), 'text line fits the bar');
  const reserve = /\.app-content\s*\{[^}]*padding:\s*calc\(.*?\+\s*(\d+)px\s*\+\s*var\(--banner-h\)\)/.exec(CSS);
  assert.ok(reserve, '.app-content top padding reserve found');
  assert.ok(Number(reserve![1]) >= px(decl('.news-ticker', 'height', PHONE)), `the ${reserve![1]}px the page reserves covers the bar, so nothing moves`);
});

test('/help: the FAQ link is at least 24x24', () => {
  const help = read('app/(main)/help/page.tsx');
  const at = help.indexOf('<Link href="/faq"');
  assert.ok(at > 0);
  const tag = help.slice(at, help.indexOf('>', at));
  assert.match(tag, /minHeight: 24/);
  assert.match(tag, /minWidth: 24/);
});

/* Beyond the PR's own claim (it says "phones"), same WCAG rule: the bar is `overflow: hidden`, so a 24px button inside a bar that is
   shorter is cut to the bar's height and its hit area is smaller than 24px. */
/* KNOWN GAP, PM WAIVED 2026-11-19 for this release ("#2649 ticker 22 vs 24 px above 760: WAIVED"): the PR claims phones only, and the phone rule is pinned above. Kept as a todo so the gap stays visible (it reports as todo, it does not fail) until the base rule is 24px. */
test('ticker buttons are not clipped by a shorter bar at any width (the bar is overflow:hidden)', { todo: 'PM waived for the release: base .news-ticker is 22px, .ticker-close 24px, clipped on desktop and at 761-767px' }, () => {
  assert.match(decl('.news-ticker', 'overflow') ?? '', /hidden/);
  const bar = px(decl('.news-ticker', 'height'));
  const btn = px(decl('.ticker-close', 'height'));
  assert.ok(bar >= btn, `base .news-ticker is ${bar}px tall but its buttons are ${btn}px: the buttons are clipped to ${bar}px outside the phone rule (desktop, and 761-767px)`);
});

/* ====================== 5. Chart: no positive tabindex ====================== */
test('Arena chart: klinecharts sets tabindex=1 exactly once, on init, and the component initialises exactly once (premise of the fix)', () => {
  const lib = readFileSync(new URL('../node_modules/klinecharts/dist/index.esm.js', import.meta.url), 'utf8');
  assert.equal(lib.match(/tabIndex = 1\b/g)?.length, 1, 'one place gives the chart element a positive tabindex');
  assert.equal(lib.match(/tabIndex/g)?.length, 1, 'and nothing sets it again later');
  const src = read('components/KLineProChart.tsx');
  assert.equal(src.match(/= kc\.init\(/g)?.length, 1, 'one init site');
});
test('Arena chart: after init, every positive tabindex inside the chart container becomes 0 and 0/-1 are left alone', () => {
  const src = read('components/KLineProChart.tsx');
  const initAt = src.indexOf('const chart = kc.init(containerRef.current);');
  assert.ok(initAt > 0);
  const m = /for \(const el of \[containerRef\.current[\s\S]*?\n\s*\}\n/.exec(src.slice(initAt));
  assert.ok(m, 'the tabindex loop sits right after init');
  assert.ok(m!.index < 700, 'and within a few lines of it, before any chart use');
  const js = ts.transpileModule(`export function run(containerRef: any) {\n${m![0]}\n}`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  const mod: { exports: { run?: (c: unknown) => void } } = { exports: {} };
  new Function('module', 'exports', js)(mod, mod.exports);
  const el = (v: string | null) => { const a: Record<string, string> = v === null ? {} : { tabindex: v }; return { getAttribute: (k: string) => a[k] ?? null, setAttribute: (k: string, x: string) => { a[k] = x; }, a }; };
  const inner = [el('1'), el('0'), el('-1'), el('3'), el('2')];
  const top = el('1');
  const container = { ...top, querySelectorAll: (sel: string) => { assert.equal(sel, '[tabindex]'); return inner; } };
  mod.exports.run!({ current: container });
  assert.deepEqual(inner.map(e => e.a.tabindex), ['0', '0', '-1', '0', '0'], 'positive -> 0, zero and negative untouched');
  assert.equal(container.a.tabindex, '0', 'the container itself too');
});

/* ====================== 6. prefers-reduced-motion on the dashboard glow ====================== */
test('/dashboard urgency glow: reduced motion turns the pulse off for both levels, and nothing re-enables it afterwards', () => {
  const pulses = RULES.filter(r => /animation:[^;]*rpm-glow-pulse/.test(r.body) && !r.media);
  assert.equal(pulses.length, 2, 'extreme and high both pulse');
  const guard = RULES.find(r => r.media.includes('prefers-reduced-motion: reduce') && r.sel.includes('data-rpm-level="extreme"'));
  assert.ok(guard, 'a reduced-motion rule for the glow exists');
  const sels = guard!.sel.split(',').map(s => s.trim());
  assert.ok(sels.includes('body[data-rpm-level="extreme"]::before') && sels.includes('body[data-rpm-level="high"]::before'), 'covers both levels');
  assert.match(guard!.body, /animation:\s*none/);
  assert.ok(guard!.idx > Math.max(...pulses.map(p => p.idx)), 'comes after the rules that start the pulse, so it wins the cascade');
  const later = RULES.filter(r => r.idx > guard!.idx && /data-rpm-level/.test(r.sel) && /animation/.test(r.body));
  assert.deepEqual(later.map(r => r.sel), [], 'no later rule brings an animation back');
});

/* ====================== 7. Focusable, named regions ====================== */
const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const keysSrc = read('lib/labelKeys.ts');
function opener(file: string, marker: string, span = 700): string {
  const src = read(file);
  const at = src.indexOf(marker);
  assert.ok(at >= 0, `${file}: ${marker} not found`);
  return src.slice(Math.max(0, src.lastIndexOf('<', at)), at + span);
}
test('landing ticker, /funding table and /correlation matrix scroll areas are keyboard-focusable regions with a name', () => {
  const cases: Array<[string, string, RegExp]> = [
    ['components/LandingTicker.tsx', 'className="lpt-ticker"', /aria-label=\{words\.region\}/],
    ['components/FundingTerminal.tsx', 'className="frh-list-scroll"', /aria-label=\{t\('FUNDING_PAGE_TITLE'\)\}/],
    ['components/CorrelationTerminal.tsx', 'className="corr-grid-wrap"', /aria-label=\{t\('CORRELATION_MATRIX_LABEL'\)\}/],
  ];
  for (const [file, marker, name] of cases) {
    const o = opener(file, marker, 420);
    assert.match(o, /role="region"/, `${file}: role=region`);
    assert.match(o, /tabIndex=\{0\}/, `${file}: tabIndex 0 (not positive)`);
    assert.match(o, name, `${file}: named`);
  }
  for (const k of ['FUNDING_PAGE_TITLE', 'CORRELATION_MATRIX_LABEL']) {
    assert.equal(keysSrc.match(new RegExp(`'${k}'`, 'g'))?.length, 1, k + ' is a real label key');
    assert.ok(defaults[k] && defaults[k].trim().length > 3, k + ' has an English default (else the region is named by its key)');
  }
});
test('landing dictionary: every language has ticker.region, in its own script, and the type requires it', () => {
  const src = read('lib/i18n/dictionaries.ts');
  assert.match(src, /ticker: \{ loading: string; unavailable: string; failedNote: string; noneNote: string; region: string \}/);
  const names = [...src.matchAll(/export const (\w+): LandingDict = \{/g)].map(m => m[1]);
  assert.ok(names.length >= 5, 'dictionaries found: ' + names.join(','));
  const SCRIPT: Record<string, RegExp> = { en: /^[\x20-\x7e]+$/, ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/ };
  for (const n of names) {
    const start = src.indexOf(`export const ${n}: LandingDict = {`);
    const t = /ticker: \{[^}]*region: '([^']+)'[^}]*\}/.exec(src.slice(start, start + 1500));
    assert.ok(t, `${n}: ticker.region missing`);
    assert.ok(t![1].length >= 4 && t![1].length <= 40, `${n}: sensible length`);
    if (SCRIPT[n]) assert.match(t![1], SCRIPT[n], `${n}: written in its own script`);
    assert.doesNotMatch(t![1], /claude|anthropic|openai|gpt|gemini|grok|xai/i);
  }
  assert.match(src, /ticker: \{[^}]*region: 'Live prices'/, 'English reads "Live prices"');
});

/* ====================== 8. Accessible names through labels ====================== */
const NEW_KEYS: Record<string, [string, string]> = {
  // key: [English the name had when hard-coded (so English users and any test that finds it by name see no change), the component that now uses it]
  A11Y_DISMISS_ANNOUNCEMENT: ['Dismiss announcement', 'components/AnnouncementBanner.tsx'],
  A11Y_REMOVE_ENTRY: ['Remove entry', 'components/DcaCalc.tsx'],
  A11Y_DISMISS_ALERT: ['Dismiss alert', 'components/DashboardTerminal.tsx'],
  A11Y_CHANGE_LANGUAGE: ['Change language', 'components/LanguageNavSwitcher.tsx'],
  A11Y_TICKER_HIDE: ['Hide news until a newer alert', 'components/NewsTicker.tsx'],
  A11Y_TICKER_PAUSE: ['Pause scrolling headlines', 'components/NewsTicker.tsx'],
  A11Y_TICKER_RESUME: ['Resume scrolling headlines', 'components/NewsTicker.tsx'],
  A11Y_NAV_MENU: ['Navigation menu', 'components/NavDrawer.tsx'],
  A11Y_ACCOUNT_MENU: ['Account menu', 'components/TerminalNav.tsx'],
  A11Y_EDIT_PARAMS_FOR: ['Edit parameters for', 'components/StrategyPanel.tsx'],
  A11Y_DELETE_TRADE: ['Delete trade', 'components/TradeJournal.tsx'],
  A11Y_DELETE_RULE: ['Delete rule', 'components/TradeJournal.tsx'],
};
const REUSED: Record<string, [string, string]> = {
  PRICES_COL_COIN: ['Coin', 'components/LiqTerminal.tsx'],
  FUNDING_CLEAR_SEARCH_ARIA: ['Clear search', 'components/NavDrawer.tsx'],
  /* the install prompt's dismiss name was SETTINGS_SAVE_DISMISS_ARIA here; #2646 gave it its own key, PWA_INSTALL_DISMISS (pinned below), so it left this list. */
  PWA_INSTALL_DISMISS: ['Dismiss', 'components/PWAInstallPrompt.tsx'],
  CHAT_CLOSE: ['Close', 'components/UsageModal.tsx'],
};
test('12 new name keys: declared once, English default equals the old hard-coded name, and the component that should use it does', () => {
  for (const [k, [en, file]] of Object.entries(NEW_KEYS)) {
    assert.equal(keysSrc.match(new RegExp(`'${k}'`, 'g'))?.length, 1, `${k} declared once in LABEL_KEYS`);
    assert.equal(defaults[k], en, `${k} English default`);
    assert.match(read(file), new RegExp(`aria-label=\\{[^}]*t\\('${k}'\\)`), `${file} names its control with ${k}`);
  }
  assert.equal(Object.keys(NEW_KEYS).length, 12);
});
test('4 reused keys: they exist and read the same English as the hard-coded names they replace', () => {
  for (const [k, [en, file]] of Object.entries(REUSED)) {
    assert.equal(keysSrc.match(new RegExp(`'${k}'`, 'g'))?.length, 1, `${k} is a real key`);
    assert.equal(defaults[k], en, `${k} English`);
    assert.match(read(file), new RegExp(`aria-label=\\{t\\('${k}'\\)\\}`), `${file} uses ${k}`);
  }
});
test('every component that now calls t() for these names has t from useLabels in scope (a missing one prints the raw key as the name)', () => {
  const files = new Set([...Object.values(NEW_KEYS), ...Object.values(REUSED)].map(v => v[1]));
  for (const f of files) {
    const src = read(f);
    assert.match(src, /useLabels\(\)/, `${f} calls useLabels()`);
    assert.match(src, /(?:const|let)\s*\{[^}]*\bt\b[^}]*\}\s*=\s*useLabels\(\)/, `${f} takes t from useLabels()`);
  }
  // the banner function that holds the alert-dismiss name defines its own t
  const dash = read('components/DashboardTerminal.tsx');
  const fn = dash.slice(dash.indexOf('function TCascadeAlertBanner'), dash.indexOf("t('A11Y_DISMISS_ALERT')"));
  assert.match(fn, /useLabels\(\)/, 'TCascadeAlertBanner has t in scope');
});

/* ====================== 9. Migration 20261123c ====================== */
test('migration 20261123c: held, PROD and DEV blocks, 12 keys x 5 locales each, en equals the shipped default, own script, identical blocks', () => {
  const sql = read('supabase/migrations/20261123c_labels_a11y_names.sql');
  assert.match(sql, /^-- NOT YET APPLIED TO ANY DATABASE\./);
  const clean = sql.replace(/--[^\n]*/g, '');
  assert.doesNotMatch(clean, /,\s*on\s+conflict/i, 'comma before "on conflict" is a SQL error');
  const blocks = [...clean.matchAll(/insert into (lhq_labels|lhq_dev_labels) \(key, locale, value\) values([\s\S]*?)on conflict \(key, locale\) do update set value = excluded\.value, updated_at = now\(\);/g)];
  assert.deepEqual(blocks.map(b => b[1]), ['lhq_labels', 'lhq_dev_labels']);
  const SCRIPT: Record<string, RegExp> = { en: /^[\x20-\x7e]+$/, ko: /[가-힯]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/ };
  const sig: string[] = [];
  for (const b of blocks) {
    const rows = [...b[2].matchAll(/\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\)/g)];
    assert.equal(b[2].replace(/\('[A-Z0-9_]+','[a-z]{2}','(?:[^']|'')*'\)/g, '').replace(/[\s,]/g, ''), '', `${b[1]}: only well-formed rows`);
    assert.equal(rows.length, 60, `${b[1]}: 12 x 5 rows`);
    const seen = new Set<string>();
    for (const r of rows) {
      const id = r[1] + '/' + r[2];
      assert.ok(!seen.has(id), `${b[1]}: duplicate ${id}`);
      seen.add(id);
      assert.ok(r[1] in NEW_KEYS, `${b[1]}: unexpected key ${r[1]}`);
      assert.ok(r[3].length >= 3 && r[3].length <= 60, `${id} length`);
      assert.match(r[3], SCRIPT[r[2]], `${b[1]} ${id} is written in its own script`);
      assert.doesNotMatch(r[3], /claude|anthropic|openai|gpt|gemini|grok|xai/i);
      if (r[2] === 'en') assert.equal(r[3], defaults[r[1]], `${id} equals the shipped default`);
    }
    for (const k of Object.keys(NEW_KEYS)) for (const l of ['en', 'ko', 'zh', 'ru', 'ar']) assert.ok(seen.has(k + '/' + l), `${b[1]}: missing ${k}/${l}`);
    sig.push(rows.map(r => r.slice(1).join('|')).join('\n'));
  }
  assert.equal(sig[0], sig[1], 'PROD and DEV blocks are identical');
});
