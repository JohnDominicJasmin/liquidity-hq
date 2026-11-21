/* QA: PR #2754 (held, v2026.11.24), #1185: /correlation served 492 KB because each of the 2,500 matrix cells carried ~170 bytes of inline style. The PR moves what is the same on every cell into CSS classes.
 *
 * THE WRITTEN RULE (the PR body): "What the page shows is unchanged." A blank cell (no shared history) and a diagonal cell carry a class and no colour of their own; a coloured cell carries only its background and colour; opacity and outline appear only while hovering, exactly as before.
 * HOW IT IS MEASURED: the className and style expressions are cut out of components/CorrelationTerminal.tsx and run for every cell kind x every hover state; the CSS cascade (app/globals.css: `.corr-cell`, the two variant classes, and the terminal design's `[data-design="terminal"] .corr-cell` radius) is applied under them; the result is compared with what the REMOVED inline style produced (reconstructed below from the old code, the one thing the rule says must not change).
 *   E1  EFFECTIVE STYLE UNCHANGED: for r = blank / diagonal / coloured (positive, negative, zero) x hover none / dimmed / in the cross / the exact cell, the effective background, colour, border-radius, opacity, outline, outline-offset, transition and cursor equal the old inline result (terminal design, which every page carries)
 *   E2  THE SAVING: with nothing hovered a blank or diagonal cell has NO style attribute at all, and a coloured cell has exactly background + colour (the old cell had eight properties)
 *   E3  the variant classes are chosen the right way round: a diagonal cell is diag even when its value is blank
 *   E4  the CSS facts E1 stands on: the base rule's transition is opacity-only (the old inline override and the new CSS agree), the terminal radius override exists, the blank / diagonal class colours are the very values cellBg / cellColor return for them
 * WHAT THIS CANNOT PROVE: the byte count (the PR estimates ~202 KB, measured on the deployed build by curl) and the pixels (the browser cells at 390 / 768 / 1280, light and dark). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (code: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const SRC = read('components/CorrelationTerminal.tsx'); const CSS = read('app/globals.css');

function cutFn(re: RegExp): string { const m = re.exec(SRC); assert.ok(m, `not found: ${re}`); let i = SRC.indexOf('{', m!.index + m![0].length - 1), d = 0; for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) break; } } return SRC.slice(m!.index, i + 1); }
/* the balanced `{ ... }` JSX attribute value that follows `name={` after the cell's `key={b}` */
function attr(name: string): string {
  const at = SRC.indexOf('key={b}'); assert.ok(at > 0, 'cell not found'); const a = SRC.indexOf(`${name}={`, at); assert.ok(a > at, `attribute ${name} not found`);
  let i = a + name.length + 1, d = 0; const start = i; for (; i < SRC.length; i++) { if (SRC[i] === '{') d++; else if (SRC[i] === '}') { d--; if (d === 0) break; } } return SRC.slice(start + 1, i);
}
const helpers = stripTypeScriptTypes(`const tintPct = (r: number) => Math.abs(r) * 50;\n${cutFn(/function cellBg\(/)}\n${cutFn(/function cellColor\(/)}`);
type Env = { diag: boolean; r: number | null; hovered: boolean | null; inCross: boolean | null; isExact: boolean | null };
const run = new Function(`${helpers}\nreturn (diag, r, hovered, inCross, isExact) => ({ cn: (${attr('className')}), st: (${attr('style')}), cellBg, cellColor });`)() as (...a: unknown[]) => { cn: string; st: Record<string, string> | undefined; cellBg: (r: number | null, d: boolean) => string; cellColor: (r: number | null, d: boolean) => string };

/* CSS facts, parsed from the file */
function decls(sel: string): Record<string, string> {
  const at = CSS.indexOf(`\n${sel}`); assert.ok(at >= 0, `rule not found: ${sel}`); const b = CSS.indexOf('{', at), e = CSS.indexOf('}', b); const out: Record<string, string> = {};
  for (const part of CSS.slice(b + 1, e).split(';')) { const k = part.indexOf(':'); if (k > 0) out[part.slice(0, k).trim()] = part.slice(k + 1).trim(); } return out;
}
const BASE = decls('.corr-cell '); const NUL = decls('.corr-cell-null'); const DIAG = decls('.corr-cell-diag'); const TERM = decls('[data-design="terminal"] .corr-cell ');
const camel = (k: string) => k.replace(/-([a-z])/g, (_m, c) => c.toUpperCase());
const PROPS = ['background', 'color', 'border-radius', 'opacity', 'outline', 'outline-offset', 'transition', 'cursor'] as const;

function effectiveNew(e: Env): Record<string, string | undefined> {
  const { cn, st } = run(e.diag, e.r, e.hovered, e.inCross, e.isExact); const eff: Record<string, string | undefined> = {};
  const apply = (d: Record<string, string>) => { for (const p of PROPS) if (d[p] !== undefined) eff[p] = d[p]; };
  const cls = cn.split(/\s+/); if (cls.includes('corr-cell')) apply(BASE); if (cls.includes('corr-cell-null')) apply(NUL); if (cls.includes('corr-cell-diag')) apply(DIAG); if (cls.includes('corr-cell')) apply(TERM);
  for (const [k, v] of Object.entries(st ?? {})) { const p = k.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase()); if ((PROPS as readonly string[]).includes(p)) eff[p] = String(v); }
  if (eff.opacity === undefined) eff.opacity = '1'; return eff;
}
/* what the REMOVED inline style produced (components/CorrelationTerminal.tsx on main before #2754) */
function effectiveOld(e: Env): Record<string, string | undefined> {
  const { cellBg, cellColor } = run(e.diag, e.r, e.hovered, e.inCross, e.isExact);
  return { background: cellBg(e.r, e.diag), color: cellColor(e.r, e.diag), 'border-radius': '0', opacity: e.hovered && !e.inCross ? '0.25' : '1', outline: e.isExact ? '1.5px solid var(--accent)' : undefined, 'outline-offset': e.isExact ? '-1px' : undefined, transition: 'opacity 0.1s', cursor: e.diag ? 'default' : 'crosshair' };
}
const HOVERS: Array<[string, Pick<Env, 'hovered' | 'inCross' | 'isExact'>]> = [['none', { hovered: null, inCross: null, isExact: null }], ['dimmed', { hovered: true, inCross: false, isExact: false }], ['in the cross', { hovered: true, inCross: true, isExact: false }], ['the exact cell', { hovered: true, inCross: true, isExact: true }]];
const CELLS: Array<[string, boolean, number | null]> = [['blank', false, null], ['diagonal (value 1)', true, 1], ['diagonal (blank)', true, null], ['positive', false, 0.42], ['negative', false, -0.31], ['zero', false, 0]];

test('E1. the effective style of every cell kind in every hover state equals the removed inline style', () => {
  let n = 0;
  for (const [cn, diag, r] of CELLS) for (const [hn, h] of HOVERS) {
    const e: Env = { diag, r, ...h }; const a = effectiveNew(e), b = effectiveOld(e); n++;
    for (const p of PROPS) assert.equal(a[p], b[p], `${cn} / hover ${hn}: ${p} is ${a[p]} (was ${b[p]})`);
  }
  console.log(`[E1] ${n} cell x hover cases x ${PROPS.length} properties`);
});

test('E2. the saving: no style attribute on a blank or diagonal cell at rest; a coloured cell carries exactly background + colour', () => {
  for (const [cn, diag, r] of CELLS) {
    const { st } = run(diag, r, null, null, null);
    if (diag || r === null) assert.equal(st, undefined, `${cn}: still carries an inline style: ${JSON.stringify(st)}`);
    else assert.deepEqual(Object.keys(st ?? {}).sort(), ['background', 'color'], `${cn}: inline properties ${JSON.stringify(st)}`);
  }
});

test('E3. a diagonal cell is diag even when its value is blank; a blank off-diagonal cell is null; a coloured cell gets neither variant', () => {
  assert.match(run(true, null, null, null, null).cn, /corr-cell-diag/); assert.doesNotMatch(run(true, null, null, null, null).cn, /corr-cell-null/);
  assert.match(run(false, null, null, null, null).cn, /corr-cell-null/); assert.doesNotMatch(run(false, 0.4, null, null, null).cn, /corr-cell-(null|diag)/);
});

test('E4. the CSS facts E1 stands on', () => {
  assert.equal(BASE.transition, 'opacity 0.1s', 'the base transition must be opacity-only (the old inline override)'); assert.equal(BASE.cursor, 'crosshair'); assert.equal(DIAG.cursor, 'default'); assert.equal(TERM['border-radius'], '0', 'the terminal design must keep the cells square (the old inline radius 0)');
  const { cellBg, cellColor } = run(false, null, null, null, null);
  assert.equal(NUL.background, cellBg(null, false)); assert.equal(NUL.color, cellColor(null, false)); assert.equal(DIAG.background, cellBg(1, true)); assert.equal(DIAG.color, cellColor(1, true));
  assert.ok(CSS.indexOf('.corr-cell-diag') > CSS.indexOf('.corr-cell '), 'the diagonal class must come after the base rule so its cursor wins at equal specificity');
});
