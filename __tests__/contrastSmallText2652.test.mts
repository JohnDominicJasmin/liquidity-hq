import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* PR #2652 - small text reaches 4.5:1 (WCAG 2.2 SC 1.4.3, normal text) and the
   Strategy panel reaches the 11px floor (--fs-micro: "the 11px floor ... don't
   shrink further"). Expected values come from the PR's written rule and from
   WCAG, not from what the CSS happens to hold.

   How it works, in plain words: every text colour and tint is READ from the
   files the PR changed (alpha values from the TSX, tints and colours from
   globals.css), resolved through the token blocks for all four themes the app
   can render in (current dark / light, terminal dark / light), blended over the
   surface the element really sits on, and measured with the WCAG relative
   luminance formula. Changing a tint or a token back makes the number fall and
   the test go red.

   Not covered (needs a real renderer): anything blended by the browser at run
   time that is not in the source (animations, backdrop effects), and wrapping
   at 390px. Axe on the deployed build stays the final word. */

const read = (p: string): string => readFileSync(new URL('../' + p, import.meta.url), 'utf8');
const CSS = read('app/globals.css').replace(/\/\*[\s\S]*?\*\//g, m => m.replace(/[^\n]/g, ' '));

/* ---------- a small CSS rule walker (comments already blanked) ---------- */
type Rule = { sel: string; body: string; media: string; line: number };
const RULES: Rule[] = [];
function walk(start: number, end: number, media: string): void {
  let i = start;
  while (i < end) {
    const o = CSS.indexOf('{', i);
    if (o < 0 || o >= end) break;
    const head = CSS.slice(i, o).slice(CSS.slice(i, o).lastIndexOf(';') + 1).trim();
    let d = 1, j = o + 1;
    while (j < end && d) { if (CSS[j] === '{') d++; else if (CSS[j] === '}') d--; j++; }
    const body = CSS.slice(o + 1, j - 1);
    const line = CSS.slice(0, o).split('\n').length;
    if (head.startsWith('@media') || head.startsWith('@supports')) walk(o + 1, j - 1, head);
    else if (!head.startsWith('@')) RULES.push({ sel: head.replace(/\s+/g, ' '), body, media, line });
    i = j;
  }
}
walk(0, CSS.length, '');

/** Last declaration of `prop` in the last un-media'd rule whose selector list contains `sel` exactly. */
function lastDecl(sel: string, prop: string): string {
  let out: string | null = null;
  const re = new RegExp('(?<![\\w-])' + prop.replace(/[-]/g, '\\-') + '\\s*:\\s*([^;}]+)', 'g');
  for (const r of RULES) {
    if (r.media) continue;
    if (!r.sel.split(',').map(s => s.trim()).includes(sel)) continue;
    for (const m of r.body.matchAll(re)) out = m[1].trim();
  }
  assert.ok(out !== null, `no un-media'd "${sel}" rule declares ${prop} in globals.css`);
  return out as string;
}
function hasDecl(sel: string, prop: string): boolean {
  const re = new RegExp('(?<![\\w-])' + prop.replace(/[-]/g, '\\-') + '\\s*:', 'g');
  return RULES.some(r => !r.media && r.sel.split(',').map(s => s.trim()).includes(sel) && re.test(r.body));
}

/* ---------- theme contexts, in cascade order ---------- */
function block(selectors: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of RULES) {
    if (r.media || !selectors.includes(r.sel)) continue;
    for (const m of r.body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[m[1]] = m[2].trim();
  }
  assert.ok(Object.keys(out).length > 5, `token block not found: ${selectors.join(' | ')}`);
  return out;
}
const ROOT = block([':root']);
const LIGHT = block(['[data-theme="light"]']);
const T_DARK = block(['[data-design="terminal"]:not([data-theme="light"])']);
const T_LIGHT = block(['[data-design="terminal"][data-theme="light"]']);
const CONTEXTS: Array<[string, Record<string, string>]> = [
  ['current dark', { ...ROOT }],
  ['current light', { ...ROOT, ...LIGHT }],
  ['terminal dark', { ...ROOT, ...T_DARK }],
  ['terminal light', { ...ROOT, ...LIGHT, ...T_LIGHT }],
];

function resolveVar(map: Record<string, string>, v: string, depth = 0): string {
  assert.ok(depth < 12, 'var() chain too deep: ' + v);
  const m = /^var\((--[\w-]+)(?:\s*,\s*(.+))?\)$/.exec(v.trim());
  if (!m) return v.trim();
  const next = map[m[1]] ?? m[2];
  assert.ok(next !== undefined, `unresolved token ${m[1]}`);
  return resolveVar(map, next, depth + 1);
}

/* ---------- colour maths (WCAG 2.x relative luminance) ---------- */
type Rgba = [number, number, number, number];
function parseColor(s: string): Rgba {
  const t = s.trim();
  let m = /^#([0-9a-f]{3,8})$/i.exec(t);
  if (m) {
    let h = m[1];
    if (h.length === 3) h = h.split('').map(c => c + c).join('');
    assert.ok(h.length === 6 || h.length === 8, 'bad hex ' + t);
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16), h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1];
  }
  m = /^rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)$/i.exec(t);
  assert.ok(m, 'cannot parse colour: ' + t);
  return [Number(m![1]), Number(m![2]), Number(m![3]), m![4] === undefined ? 1 : Number(m![4])];
}
function over(fg: Rgba, bg: [number, number, number]): [number, number, number] {
  const a = fg[3];
  return [fg[0] * a + bg[0] * (1 - a), fg[1] * a + bg[1] * (1 - a), fg[2] * a + bg[2] * (1 - a)];
}
function lum(c: number[]): number {
  const l = c.map(v => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); });
  return 0.2126 * l[0] + 0.7152 * l[1] + 0.0722 * l[2];
}
function ratio(a: number[], b: number[]): number {
  const x = lum(a), y = lum(b);
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
function colorIn(map: Record<string, string>, v: string): Rgba { return parseColor(resolveVar(map, v)); }
function surface(map: Record<string, string>, token: string): [number, number, number] {
  const c = colorIn(map, `var(--${token})`);
  assert.equal(c[3], 1, `--${token} must be opaque`);
  return [c[0], c[1], c[2]];
}
/** Text colour `fg` on a tint `tint` (either may carry alpha) painted over surface token `surf`. */
function measure(map: Record<string, string>, fg: string, tint: string | null, surf: string): number {
  const base = surface(map, surf);
  const bg = tint === null ? base : over(colorIn(map, tint), base);
  const text = over(colorIn(map, fg), bg);
  return ratio(text, bg);
}

/* ---------- the surfaces these elements sit on (premises, asserted) ---------- */
test('premise: the surfaces the measurements assume are the ones the source paints', () => {
  const brief = read('components/BriefingTerminal.tsx');
  assert.match(brief, /function TPanel[\s\S]{0,200}background:\s*'var\(--bg1\)'/, 'briefing tags sit on TPanel = --bg1');
  assert.equal(lastDecl('.ncard-grid', 'background'), 'var(--bg1)', 'news cards = --bg1');
  assert.equal(lastDecl('.liq-card', 'background'), 'var(--bg2)', '/liq section headers sit inside .liq-card = --bg2');
});

test('sanity: the ratio maths matches known WCAG values, and the PR\'s stated tokens are real', () => {
  assert.equal(Math.round(ratio([255, 255, 255], [0, 0, 0])), 21);
  const td = CONTEXTS[2][1], tl = CONTEXTS[3][1];
  assert.equal(resolveVar(td, 'var(--bg1)').toLowerCase(), '#141517');
  assert.equal(resolveVar(td, 'var(--red)').toLowerCase(), '#f0524d');
  assert.equal(resolveVar(td, 'var(--txt3)').toLowerCase(), '#7c828a');
  assert.equal(resolveVar(tl, 'var(--bg1)').toLowerCase(), '#ebe9e6');
});

/* ---------- pairs read from the changed source ---------- */
type Pair = { name: string; fg: string; tint: string | null; surf: string };

function colorLiterals(expr: string): string[] {
  return [...expr.matchAll(/'(rgba?\([^']*\)|var\(--[\w-]+\)|#[0-9a-fA-F]{3,8})'/g)].map(m => m[1]);
}

function newsPairs(): Pair[] {
  const src = read('app/(main)/news/page.tsx');
  const at = src.indexOf("const cfg = s === 'bullish'");
  assert.ok(at >= 0, 'SentimentBadge cfg not found');
  const slice = src.slice(at, at + 900);
  const found = [...slice.matchAll(/bg:\s*'(rgba\([^']+\))'[\s\S]*?color:\s*'(var\(--[\w-]+\))'/g)];
  assert.equal(found.length, 2, 'bullish + bearish');
  return [
    { name: '/news Bullish tag', tint: found[0][1], fg: found[0][2], surf: 'bg1' },
    { name: '/news Bearish tag', tint: found[1][1], fg: found[1][2], surf: 'bg1' },
  ];
}

function briefingPairs(): Pair[] {
  const src = read('components/BriefingTerminal.tsx');
  const out: Pair[] = [];
  const starts = [...src.matchAll(/className="mb-event-tag" style=\{\{/g)].map(m => m.index as number);
  assert.equal(starts.length, 3, 'three mb-event-tag blocks (economic, geo, whale)');
  const names: string[][] = [
    ['/briefing past event tag', '/briefing urgent (<2h) event tag', '/briefing later event tag'],
    ['/briefing geo crypto tag', '/briefing geo speech tag', '/briefing geo other tag'],
    ['/briefing whale BUY tag', '/briefing whale SELL tag'],
  ];
  starts.forEach((s, bi) => {
    const sliceEnd = src.indexOf('}}>', s);
    const body = src.slice(s, sliceEnd);
    const bg = /^\s*background:\s*([\s\S]*?),\s*\n\s*color:/m.exec(body);
    const col = /^\s*color:\s*(.+?),?\s*$/m.exec(body.slice(body.indexOf('color:')));
    assert.ok(bg && col, 'background/color not found in block ' + bi);
    const bgs = colorLiterals(bg![1]), cols = colorLiterals(col![1]);
    assert.equal(bgs.length, cols.length, `block ${bi}: ${bgs.length} backgrounds vs ${cols.length} colours`);
    assert.equal(bgs.length, names[bi].length, `block ${bi}: expected ${names[bi].length} variants`);
    bgs.forEach((b, k) => out.push({ name: names[bi][k], tint: b, fg: cols[k], surf: 'bg1' }));
  });
  return out;
}

function liqPairs(): Pair[] {
  // .liq-section-est has no colour of its own: it inherits the header's colour.
  return [
    { name: '/liq "Estimated" on the short header', fg: lastDecl('.liq-section-hdr-short', 'color'), tint: lastDecl('.liq-section-hdr-short', 'background'), surf: 'bg2' },
    { name: '/liq "Estimated" on the long header', fg: lastDecl('.liq-section-hdr-long', 'color'), tint: lastDecl('.liq-section-hdr-long', 'background'), surf: 'bg2' },
  ];
}

const AA = 4.5; // all of these are 11-13px regular/bold: small text, never "large"

function check(pairs: Pair[]): string[] {
  const bad: string[] = [];
  for (const [theme, map] of CONTEXTS) {
    for (const p of pairs) {
      const r = measure(map, p.fg, p.tint, p.surf);
      if (process.env.DUMP) console.log(`${theme.padEnd(14)} ${p.name.padEnd(40)} ${r.toFixed(2)}`);
      if (r < AA) bad.push(`${theme}: ${p.name} = ${r.toFixed(2)}:1`);
    }
  }
  return bad;
}

test('/news Bearish and Bullish tags reach 4.5:1 in all four themes', () => {
  assert.deepEqual(check(newsPairs()), []);
});

test('/briefing event tags (past, red, amber, geo, whale BUY/SELL) reach 4.5:1 in all four themes', () => {
  assert.deepEqual(check(briefingPairs()), []);
});

test('/liq "Estimated" label reaches 4.5:1 in all four themes, with no opacity dimming it', () => {
  assert.equal(hasDecl('.liq-section-est', 'opacity'), false, '.liq-section-est must not set opacity (dims the inherited colour)');
  assert.deepEqual(check(liqPairs()), []);
});

test('/news For-you caption: no opacity on the source list line, and --txt3 clears 4.5:1 on every base surface', () => {
  const src = read('app/(main)/news/page.tsx');
  const i = src.indexOf("{t('NEWS_SOURCE_LIST')}", src.indexOf('NEWS_FORYOU_EMPTY_BODY'));
  assert.ok(i > 0, 'For-you source list line not found');
  const opener = src.slice(src.lastIndexOf('<div', i), i);
  assert.doesNotMatch(opener, /opacity/, 'the For-you caption must not be dimmed with opacity');
  const bad: string[] = [];
  for (const [theme, map] of CONTEXTS) {
    for (const surf of ['bg0', 'bg1', 'bg2']) {
      const r = measure(map, 'var(--txt3)', null, surf);
      if (r < AA) bad.push(`${theme}: txt3 on ${surf} = ${r.toFixed(2)}:1`);
    }
  }
  assert.deepEqual(bad, []);
});

test('the PR\'s own stated numbers are true on the head (terminal dark and light, to 0.03)', () => {
  const td = CONTEXTS[2][1], tl = CONTEXTS[3][1];
  const near = (a: number, b: number, what: string) => assert.ok(Math.abs(a - b) < 0.03, `${what}: measured ${a.toFixed(2)}, PR says ${b}`);
  const n = newsPairs(), b = briefingPairs();
  const get = (ps: Pair[], name: string) => ps.find(p => p.name === name) as Pair;
  const m = (map: Record<string, string>, p: Pair) => measure(map, p.fg, p.tint, p.surf);
  near(m(td, get(n, '/news Bearish tag')), 4.73, 'Bearish dark');
  near(m(td, get(b, '/briefing urgent (<2h) event tag')), 4.73, 'RETAIL/red tag dark');
  near(m(td, get(b, '/briefing whale SELL tag')), 4.73, 'whale SELL dark');
  near(m(td, get(b, '/briefing past event tag')), 4.58, 'past tag dark');
  near(m(tl, get(b, '/briefing past event tag')), 4.8, 'past tag light');
});

/* ---------- Strategy panel: size floor and target size ---------- */
const FLOOR_PX = 11;
function px(v: string): number {
  const t = resolveVar(ROOT, v);
  let m = /^([\d.]+)px$/.exec(t);
  if (m) return Number(m[1]);
  m = /^([\d.]+)rem$/.exec(t);
  assert.ok(m, 'cannot read a size from: ' + v);
  return Number(m![1]) * 16; // no html font-size override exists in globals.css
}
const T = (cls: string) => `[data-design="terminal"] ${cls}`;

test('premise: --fs-micro is 11px and the root font size is not overridden', () => {
  assert.equal(px('var(--fs-micro)'), 11);
  assert.equal(RULES.some(r => !r.media && r.sel === 'html' && /(?<![\w-])font-size\s*:/.test(r.body)), false);
});

test('Strategy panel: the four rules the PR names (plan line, parameter row, parameter input, read-only note) are at the 11px floor', () => {
  for (const cls of ['.strat-aux', '.strat-prow', '.strat-pv', '.strat-ro']) {
    assert.ok(px(lastDecl(T(cls), 'font-size')) >= FLOOR_PX, `${cls} is ${lastDecl(T(cls), 'font-size')}`);
  }
});

test('Strategy panel: the on/off parameter checkbox is a real input and a 24x24 target (WCAG 2.5.8)', () => {
  const panel = read('components/StrategyPanel.tsx');
  assert.match(panel, /<input className="strat-pv" type="checkbox"/, 'the bool parameter is a strat-pv checkbox');
  const sel = T('.strat-pv[type="checkbox"]');
  assert.ok(px(lastDecl(sel, 'width')) >= 24, 'width ' + lastDecl(sel, 'width'));
  assert.ok(px(lastDecl(sel, 'height')) >= 24, 'height ' + lastDecl(sel, 'height'));
  // the row must be tall enough not to clip a 24px box
  assert.ok(px(lastDecl(T('.strat-prow'), 'height')) >= 24, 'row height ' + lastDecl(T('.strat-prow'), 'height'));
});

test('Strategy panel: EVERY text class StrategyPanel.tsx renders is at the 11px floor (the PR says the panel\'s smallest text reaches it)', () => {
  const panel = read('components/StrategyPanel.tsx');
  const used = new Set<string>();
  for (const m of panel.matchAll(/className=(?:"([^"]+)"|\{`([^`]+)`\})/g)) {
    for (const c of (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ').split(/\s+/)) if (/^strat-[a-z0-9-]+$/.test(c)) used.add(c);
  }
  assert.ok(used.size > 15, 'found the rendered strat-* classes: ' + used.size);
  const under: string[] = [];
  for (const c of [...used].sort()) {
    const sel = T('.' + c);
    if (!hasDecl(sel, 'font-size')) continue;
    const v = lastDecl(sel, 'font-size');
    if (px(v) < FLOOR_PX) under.push(`.${c} ${v}`);
  }
  assert.deepEqual(under, []);
});
