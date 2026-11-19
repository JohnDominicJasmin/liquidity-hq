/* QA: the Draw Structure position box keeps its Target / Entry / Stop labels apart. PR #2654, #1263 L104 (QA finding on staging shots at 390 px).
 * THE WRITTEN RULE (the PR body + #1263 L103/L104 + the 2026-11-18 rule it must not break): at 390 px the labels are the short forms T / E / S, no two labels share a place on the screen; a Target or Stop label sits at least 14 px from the entry line,
 * pushed away from it; and (PM/QA 2026-11-18) ONLY A LEVEL OUTSIDE THE PANE is pinned to the pane edge with the full value and an arrow toward it.
 * HOW IT IS MEASURED. The real overlay code is cut out of components/KLineProChart.tsx (the positionBox createPointFigures), compiled with the TypeScript compiler and RUN on chosen entry / target / stop pixel positions; every text it would draw is turned
 * into a rectangle (10 px high; WIDTH IS AN ESTIMATE: 6 px per character for 10 px bold text). Pairs of rectangles that overlap are overprinted labels. There is no canvas here: how it really looks is a browser cell on GitHub CI.
 *   P1  390 px, entry mid-pane, every stop/target distance from 1 to 130 px, BUY and SELL: no two of T / E / S / R:R overlap (this is what the PR fixes; it is RED on the base commit, see P8)
 *   P2  the 14 px rule: a Target / Stop label's anchor is at least 14 px from the entry line, on the side away from it
 *   P3  the short forms: T / E / S below 460 px; the full "Target ... / Entry ... / Stop ..." text at 460 px and above
 *   P4  1280 px, entry mid-chart (box 420 px wide): no two labels overlap at any distance
 *   P5  AN ARROW MEANS "THE LEVEL IS OFF THE PANE": a Target or Stop whose own level is inside the pane never gets the up / down arrow (a label pushed past the pane edge by the 14 px rule must not turn into "...  ↓")
 *   P6  entry near the pane edge at 390 (box low or high in the pane), tight stop / target: still no two labels overlap, for every case where the level's own label was NOT already pinned to the edge before the PR (pinned labels beside the entry are an older behaviour, not judged here)
 *   P8  CONTROL: with the 14 px rule switched off (APART_PX = 0) in a scratch compile, P1's check finds the overprint; so P1 can go red
 * NOT COVERED: the Channel top / bottom tags (another overlay, untouched by the PR, so QA's "Entry overlaps the Channel top tag" is NOT addressed), the caption at the bottom-left, text widths, and how the canvas really draws. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';

const SRC = readFileSync(new URL('../components/KLineProChart.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');

interface Fig { type: string; attrs: { x?: number; y?: number; text?: string; align?: string; baseline?: string }; styles?: { color?: string } }
type Pt = { x: number; y: number };
type Overlay = (a: { overlay: { extendData: Record<string, unknown> }; coordinates: Pt[]; bounding: { width: number; height: number } }) => Fig[];

function compile(mutate?: (s: string) => string): Overlay {
  const a = SRC.indexOf("name: 'positionBox', totalStep: 3,"); assert.ok(a > 0, 'CONTROL: the positionBox overlay was not found');
  const c = SRC.indexOf('createPointFigures:', a), r = SRC.indexOf('return out;', c), end = SRC.indexOf('\n          },', r);
  assert.ok(c > a && r > c && end > r, 'CONTROL: the end of the positionBox function was not found');
  let fn = SRC.slice(c + 'createPointFigures:'.length, end + '\n          }'.length);
  if (mutate) { const m = mutate(fn); assert.notEqual(m, fn, 'CONTROL: the mutation changed nothing'); fn = m; }
  const js = ts.transpileModule(`const f = ${fn};`, { compilerOptions: { target: ts.ScriptTarget.ES2020 } }).outputText;
  return new Function('resolveCssColor', 'withAlpha', `${js}\nreturn f;`)((v: string) => v, (v: string) => v) as Overlay;
}
const real = compile();

const CHAR_W = 6, LINE_H = 10;
const TEXTS = { hasTarget: true, targetText: 'Target $64,000.00 (+2.00%)', entryText: 'Entry $62,720.00', stopText: 'Stop $62,000.00 (-1.15%)', rrText: 'R:R 2.8', caption: 'Levels from the Channel strategy, not a prediction.' };
interface Lab { role: 'T' | 'E' | 'S' | 'R' | 'C'; text: string; x0: number; x1: number; y0: number; y1: number; anchorY: number }
function layout(fn: Overlay, W: number, H: number, e: Pt, t: Pt | null, s: Pt): Lab[] {
  const figs = fn({ overlay: { extendData: { ...TEXTS, hasTarget: t !== null, rrText: t !== null ? TEXTS.rrText : '' } }, coordinates: [e, t ?? e, s], bounding: { width: W, height: H } });
  const out: Lab[] = [];
  for (const f of figs.filter((x) => x.type === 'text')) {
    const { x = 0, y = 0, text = '', align, baseline } = f.attrs, w = text.length * CHAR_W;
    const x0 = align === 'right' ? x - w : align === 'center' ? x - w / 2 : x, y0 = baseline === 'top' ? y : baseline === 'bottom' ? y - LINE_H : y - LINE_H / 2;
    const color = f.styles?.color, role = color === 'var(--green)' ? 'T' : color === 'var(--red)' ? 'S' : text.startsWith('R:R') ? 'R' : text.startsWith('Levels') ? 'C' : 'E';
    out.push({ role, text, x0, x1: x0 + w, y0, y1: y0 + LINE_H, anchorY: y });
  }
  return out;
}
const overlap = (a: Lab, b: Lab) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
function collisions(labs: Lab[]): string[] {
  const own = labs.filter((l) => l.role !== 'C'), bad: string[] = [];
  for (let i = 0; i < own.length; i++) for (let j = i + 1; j < own.length; j++) if (overlap(own[i], own[j])) bad.push(`${own[i].role}"${own[i].text.slice(0, 14)}" over ${own[j].role}"${own[j].text.slice(0, 14)}"`);
  return bad;
}
/* BUY: target above the entry (smaller y), stop below. SELL: the mirror. */
function scene(dir: 'BUY' | 'SELL', ey: number, x: number, dStop: number, dTarget: number | null): { e: Pt; t: Pt | null; s: Pt } {
  const k = dir === 'BUY' ? 1 : -1;
  return { e: { x, y: ey }, s: { x, y: ey + k * dStop }, t: dTarget == null ? null : { x, y: ey - k * dTarget } };
}
const STOPS = [1, 2, 4, 6, 8, 10, 12, 14, 16, 20, 30, 65, 130], TARGETS: Array<number | null> = [null, 1, 3, 6, 12, 14, 20, 30, 65, 130];
function sweep(fn: Overlay, W: number, H: number, ey: number, x: number, filter: (l: Lab[], sc: ReturnType<typeof scene>) => string[]): string[] {
  const bad: string[] = [];
  for (const dir of ['BUY', 'SELL'] as const) for (const ds of STOPS) for (const dt of TARGETS) {
    const sc = scene(dir, ey, x, ds, dt);
    const off = [sc.s.y, sc.t?.y ?? ey].some((y) => y < 0 || y > H);   // a level off the pane is pinned to the edge by design (2026-11-18): not this test
    if (off) continue;
    for (const b of filter(layout(fn, W, H, sc.e, sc.t, sc.s), sc)) bad.push(`${dir} stop ${ds}px target ${dt ?? 'none'}: ${b}`);
  }
  return bad;
}

test('P1. 390 px, entry mid-pane: T / E / S / R:R never overlap, for every stop and target distance', () => {
  for (const H of [300, 420]) assert.deepEqual(sweep(real, 366, H, Math.round(H / 2), 286, (l) => collisions(l)), []);
});
test('P2. a Target or Stop label sits at least 14 px from the entry line, on the side away from it', () => {
  const bad: string[] = [];
  for (const dir of ['BUY', 'SELL'] as const) for (const ds of STOPS) for (const dt of TARGETS) {
    const sc = scene(dir, 150, 286, ds, dt), labs = layout(real, 366, 300, sc.e, sc.t, sc.s);
    for (const [role, lvl] of [['T', sc.t], ['S', sc.s]] as const) {
      const lab = labs.find((l) => l.role === role); if (!lab || !lvl) continue;
      const away = Math.sign(lvl.y - sc.e.y) || 1;
      if (Math.abs(lab.anchorY - sc.e.y) < 14 - 1e-9 || Math.sign(lab.anchorY - sc.e.y) !== away) bad.push(`${dir} ${role} level ${lvl.y - sc.e.y}px away: label anchor ${lab.anchorY - sc.e.y}px from the entry`);
    }
  }
  assert.deepEqual(bad, []);
});
test('P3. short forms T / E / S below 460 px; the full text from 460 px', () => {
  const sc = scene('BUY', 150, 286, 40, 80);
  const narrow = layout(real, 366, 300, sc.e, sc.t, sc.s).filter((l) => l.role !== 'C' && l.role !== 'R').map((l) => l.text).sort();
  assert.deepEqual(narrow, ['E', 'S', 'T']);
  const wideW = layout(real, 459, 300, sc.e, sc.t, sc.s).filter((l) => l.role === 'E')[0].text; assert.equal(wideW, 'E', '459 px is still narrow');
  const wide = layout(real, 460, 300, sc.e, sc.t, sc.s);
  assert.match(wide.find((l) => l.role === 'T')!.text, /^Target /); assert.match(wide.find((l) => l.role === 'E')!.text, /^Entry /); assert.match(wide.find((l) => l.role === 'S')!.text, /^Stop /);
});
test('P4. 1280 px, entry mid-chart (a 420 px box): no two labels overlap at any distance', () => {
  assert.deepEqual(sweep(real, 1200, 500, 250, 600, (l) => collisions(l)), []);
});
test('P5. an arrow only for a level that is off the pane: a label pushed past the pane edge by the 14 px rule is not an off-pane level', () => {
  const bad: string[] = [];
  for (const dir of ['BUY', 'SELL'] as const) for (const ey of [12, 18, 24, 276, 282, 288]) for (const ds of [1, 2, 4, 6, 8]) for (const dt of [null, 1, 3, 6]) {
    const sc = scene(dir, ey, 286, ds, dt), H = 300;
    const inside = (y: number) => y >= 10 && y <= H - 10;   // the pin margin: the code itself only pins a label that would sit within 10 px of the edge
    for (const lab of layout(real, 366, H, sc.e, sc.t, sc.s)) {
      const lvl = lab.role === 'T' ? sc.t : lab.role === 'S' ? sc.s : null;
      if (lvl && inside(lvl.y) && /[↑↓]/.test(lab.text)) bad.push(`${dir} entry y${ey} ${lab.role} level y${lvl.y} is ON the pane but the label reads "${lab.text}"`);
    }
  }
  assert.deepEqual(bad, []);
});
test('P6. 390 px, entry near the pane edge: still no two labels overlap wherever the level was not already pinned before the PR', () => {
  const H = 300, pinnedBefore = (sc: ReturnType<typeof scene>) => [sc.t ? (sc.t.y < sc.e.y ? sc.t.y + 3 : sc.t.y - 3) : 100, sc.s.y > sc.e.y ? sc.s.y - 3 : sc.s.y + 3].some((y) => y < 10 || y > H - 10);
  const bad: string[] = [];
  for (const ey of [24, 276]) bad.push(...sweep(real, 366, H, ey, 286, (l, sc) => (pinnedBefore(sc) ? [] : collisions(l))).map((b) => `entry y${ey}: ${b}`));
  assert.deepEqual(bad, []);
});
test('P8. CONTROL: with the 14 px rule switched off, P1\'s check finds the overprint (so P1 can go red)', () => {
  const off = compile((s) => s.replace('const APART_PX = 14;', 'const APART_PX = 0;'));
  assert.ok(sweep(off, 366, 300, 150, 286, (l) => collisions(l)).length > 0, 'CONTROL: no overprint found without the rule, so P1 proves nothing');
  assert.ok(sweep(real, 366, 300, 150, 286, (l) => collisions(l)).length === 0, 'the real code still overprints');
});
