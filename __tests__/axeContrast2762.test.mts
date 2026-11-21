/* QA: PR #2762 (held, v2026.11.24): the four axe serious contrast failures QA measured on production (#1185, 2026-11-20) are fixed with existing tokens.
 *
 * THE WRITTEN RULE (the owner's contrast rule and QA's axe numbers, not the PR's table): normal text needs 4.5:1 against the surface it is painted on, in BOTH themes, in the terminal design
 * that every screen uses (the PR's own table was computed on the ROOT tokens; the shipped palette is the [data-design="terminal"] block, so this reads THAT block):
 *   /liq light  .gex-meta > span  (the Max pain note)   was 2.3:1  (opacity 0.6 on --txt2)         -> must be a solid --txt2
 *   /liq light  .liq-src-bn       (BN badge)            was 1.57:1 (literal #f0a500 on its tint)    -> --amber
 *   /liq dark   .liqfeed-row-side-long ("LONG LIQ")     was 4.45:1 (--red on its tint)              -> --red-fg
 *   /arena dark the EMA card's SL / TP "Levels" caption was 4.49:1 (--txt3 on the 2 % white block)  -> --txt-dash
 *   C1  CONTROLS: the calculator reproduces QA's four measured numbers from the OLD values (4.45, 1.57, 4.49, 2.3), so a green below is not an artefact of my arithmetic
 *   S1  the four source edits: the rule colours by token, no literal hex / opacity left on those four elements, the tint backgrounds unchanged (the fix is the text, not the surface)
 *   R1  every shipped pair clears 4.5:1 in the terminal dark and light blocks, on every ground the element can sit on (--bg0, --bg1, --bg2), tint or overlay applied as the CSS paints it
 *   G1  the fix did not move the token it avoided: terminal --txt3 stays #7c828a (dark) / #5e6267 (light), because other surfaces depend on its value
 * WHAT THIS CANNOT PROVE: axe on the deployed page (the cells in qa/e2e/prod-1185-remeasure.spec.ts run on the build that carries it). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const CSS = read('app/globals.css'); const EMA = read('components/EMASignal.tsx'); const GEX = read('components/GexTable.tsx');

const hex = (h: string): [number, number, number] => { const m = /^#([0-9a-f]{6})$/i.exec(h.trim()); assert.ok(m, `not a 6-digit hex: ${h}`); const n = parseInt(m![1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
const lum = (c: [number, number, number]) => { const f = (v: number) => { const s = v / 255; return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
const ratio = (a: [number, number, number], b: [number, number, number]) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (rgb: [number, number, number], alpha: number, ground: [number, number, number]): [number, number, number] => [0, 1, 2].map((i) => Math.round(rgb[i] * alpha + ground[i] * (1 - alpha))) as [number, number, number];

/* the body of a top-level rule whose selector line is exactly `sel {` (brace matched) */
function block(sel: string): string {
  const at = CSS.indexOf(`\n${sel} {`); assert.ok(at >= 0, `rule not found: ${sel}`);
  let i = CSS.indexOf('{', at); let d = 0; const start = i;
  for (; i < CSS.length; i++) { if (CSS[i] === '{') d++; else if (CSS[i] === '}') { d--; if (d === 0) break; } }
  return CSS.slice(start + 1, i);
}
const DARK = block('[data-design="terminal"]:not([data-theme="light"])'); const LIGHT = block('[data-design="terminal"][data-theme="light"]');
function tok(b: string, name: string): string { const m = new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})`).exec(b); assert.ok(m, `--${name} is not a literal hex in that block`); return m![1].toLowerCase(); }
const rule = (re: RegExp, what: string): string => { const m = re.exec(CSS); assert.ok(m, `rule not found: ${what}`); return m![0]; };

const THEMES = { dark: DARK, light: LIGHT } as const;
const grounds = (b: string) => ['bg0', 'bg1', 'bg2'].map((n) => [n, hex(tok(b, n))] as const);

test('C1. controls: the calculator reproduces QA\'s four measured numbers from the OLD values', () => {
  const near = (v: number, want: number, tol = 0.03) => assert.ok(Math.abs(v - want) <= tol, `${v.toFixed(3)} vs QA ${want}`);
  const bg1d = hex(tok(DARK, 'bg1')); const bg1l = hex(tok(LIGHT, 'bg1')); const bg2l = hex(tok(LIGHT, 'bg2'));
  near(ratio(hex('#f0524d'), over([248, 113, 113], 0.12, bg1d)), 4.45);              /* LONG LIQ: --red on its tint, dark */
  near(ratio(hex('#f0a500'), over([240, 165, 0], 0.15, bg1l)), 1.57, 0.05);          /* BN badge literal, light */
  near(ratio(hex('#7c828a'), over([255, 255, 255], 0.02, bg1d)), 4.49);              /* Levels caption: --txt3 on the 2 % white block, dark */
  near(ratio(over(hex(tok(LIGHT, 'txt2')), 0.6, bg2l), bg2l), 2.3, 0.15);            /* Max pain note: opacity .6 on --txt2, light (QA fg #939596 on #e3e1dd) */
});

test('S1. the source edits: tokens, not literals; the tint surfaces are unchanged', () => {
  const long = rule(/\.liqfeed-row-side-long\s*\{[^}]*\}/, '.liqfeed-row-side-long');
  assert.match(long, /color:\s*var\(--red-fg\)/, 'LONG LIQ text is not --red-fg'); assert.match(long, /background:\s*rgba\(248,\s*113,\s*113,\s*0\.12\)/, 'LONG LIQ tint changed');
  const bn = rule(/\.liq-src-bn\s*\{[^}]*\}/, '.liq-src-bn');
  assert.match(bn, /color:\s*var\(--amber\)/, 'BN badge text is not --amber'); assert.ok(!/#f0a500/i.test(bn.replace(/rgba\([^)]*\)/g, '')), 'a literal #f0a500 is still the BN text colour'); assert.match(bn, /background:\s*rgba\(240,\s*165,\s*0,\s*0\.15\)/, 'BN tint changed');
  const sl = EMA.split('\n').filter((l) => l.includes('EMA_SIGNAL_LEVELS') && l.includes('<span')); assert.equal(sl.length, 1, 'the Levels caption span is not found exactly once');
  assert.match(sl[0], /color:\s*'var\(--txt-dash\)'/, 'the Levels caption is not --txt-dash'); assert.ok(!/--txt3/.test(sl[0]), 'the Levels caption still reads --txt3');
  assert.match(EMA, /background:\s*'rgba\(255,255,255,0\.02\)'/, 'the SL / TP block overlay changed (the ratios below assume 2 % white)');
  const gx = GEX.split('\n').filter((l) => l.includes('GEX_TABLE_MAX_PAIN_DESC')); assert.equal(gx.length, 1, 'the Max pain note span is not found exactly once');
  assert.ok(!/opacity/.test(gx[0]), 'the Max pain note still has an opacity'); assert.match(gx[0], /color:\s*'var\(--txt2\)'/, 'the Max pain note text is not --txt2');
});

test('R1. every shipped pair clears 4.5:1 in the terminal dark and light blocks, on every ground', () => {
  const rows: string[] = [];
  for (const [theme, b] of Object.entries(THEMES)) for (const [gn, g] of grounds(b)) {
    const pairs: Array<[string, [number, number, number], [number, number, number]]> = [
      ['LONG LIQ --red-fg on tint', hex(tok(b, 'red-fg')), over([248, 113, 113], 0.12, g)],
      ['BN badge --amber on tint', hex(tok(b, 'amber')), over([240, 165, 0], 0.15, g)],
      ['Max pain note --txt2 (solid)', hex(tok(b, 'txt2')), g],
      ['Levels caption --txt-dash on 2% white', hex(tok(b, 'txt-dash')), over([255, 255, 255], 0.02, g)],
    ];
    for (const [name, fg, bg] of pairs) { const r = ratio(fg, bg); rows.push(`${theme} ${gn} ${name}: ${r.toFixed(2)}`); assert.ok(r >= 4.5, `${theme} on ${gn}: ${name} is ${r.toFixed(2)}:1`); }
  }
  console.log(`[R1] ${rows.length} pairs, lowest ${Math.min(...rows.map((r) => Number(r.split(': ')[1]))).toFixed(2)}`);
});

test('G1. --txt3 was left alone (other surfaces depend on its value)', () => {
  assert.equal(tok(DARK, 'txt3'), '#7c828a'); assert.equal(tok(LIGHT, 'txt3'), '#5e6267');
});
