/* #2409: overlay labels are boxes in their role colour; the WAIT call box lists the watched levels; the Market Read says how many signals agree.
 *   B1  solidTint (SLICED from KLineProChart and run, with the page background stubbed): an 8% tint of the ink over the background as an opaque rgb(), hex and rgb()/rgba() inks parse, an unparseable ink falls back to the alpha tint, never throws
 *   B2  the label box style: stroke_fill, 1 px border, same-colour text, and the stacking step (15 px, trigger 16 px) is at least the box height (10 px text + 2*2 padding + 2*1 border = 16 with line spacing) so two close labels cannot overlap
 *   B3  role colours: accent for watch/confirm, amber for wrong-if (invalid), neutral for reference
 *   B4  the WAIT "Watching:" list (SLICED from StrategyCallBox and run): only on a wait verdict, only watch and confirm levels (never wrong-if or reference), lowest price first, at most four, none -> empty (so no line)
 *   B5  the Market Read stops asking whether it is a good time to trade: the five keys say "how many signals agree"; no English default still says "best setup", "before you place a trade" or "good time to trade"; the Watching key has an English default and is registered
 * Migration rows (ko/zh/ru/ar, PROD = DEV) are covered by labelMigrationsHeld. WHAT IT CANNOT PROVE: how the boxes look on the canvas (klinecharts text-figure options: the PR says CI-only so far), light theme, 390 px, or overlap in a real chart: the browser cells. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';

const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const chart = read('components/KLineProChart.tsx'), box = read('components/StrategyCallBox.tsx'), en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;

const a = chart.indexOf('const solidTint = '); assert.ok(a > 0, 'CONTROL: solidTint not found'); const b = chart.indexOf('\n        };', a) + '\n        };'.length;
/* the slice is OUR OWN checked-in source, never input; the page background and the alpha helper are stubbed */
const solidTint = new Function('resolveCssColor', 'withAlpha', `${stripTypeScriptTypes(chart.slice(a, b))}\nreturn solidTint;`)((c: string) => (c === 'var(--bg1)' ? '#0b0e14' : c), (css: string, al: number) => `ALPHA(${css},${al})`) as (ink: string, a: number) => string;

test('B1. solidTint: 8% of the ink over the background, opaque; hex and rgb inks parse; unparseable falls back and never throws', () => {
  assert.equal(solidTint('#ffffff', 0.08), 'rgb(' + [0, 1, 2].map((k) => Math.round(255 * 0.08 + [11, 14, 20][k] * 0.92)).join(', ') + ')');
  assert.equal(solidTint('rgb(255, 255, 255)', 0.08), solidTint('#ffffff', 0.08)); assert.equal(solidTint('rgba(255,255,255,0.4)', 0.08), solidTint('#ffffff', 0.08), 'rgba alpha must not change the tint');
  assert.equal(solidTint('#0b0e14', 0.08), 'rgb(11, 14, 20)', 'ink equal to the ground is the ground');
  assert.equal(solidTint('hsl(10 50% 50%)', 0.08), 'ALPHA(hsl(10 50% 50%),0.08)'); assert.doesNotThrow(() => solidTint('', 0.08));
  assert.match(solidTint('#ff0000', 0.08), /^rgb\(\d+, \d+, \d+\)$/);
});
test('B2. the label is a stroke_fill box with a 1 px same-ink border, and the stacking step is not smaller than the box', () => {
  const m = chart.match(/const labelStyles = \(ink: string\) => \(\{([^}]*)\}\);/); assert.ok(m, 'labelStyles not found'); const s = m![1];
  for (const frag of ["style: 'stroke_fill'", 'color: ink', 'size: 10', 'borderSize: 1', 'paddingTop: 2', 'paddingBottom: 2', 'backgroundColor: solidTint(ink, 0.08)', 'borderColor: withAlpha(ink, 0.55)']) assert.ok(s.includes(frag), `the label box lost: ${frag}`);
  const boxH = 10 + 2 + 2 + 2 * 1; const step = Number(/lift \+= (\d+);/.exec(chart)![1]), trigger = Number(/Math\.abs\(oy - c\.y\) < (\d+)\) lift/.exec(chart)![1]);
  assert.ok(step >= boxH - 1 && trigger >= step, `stack step ${step} / trigger ${trigger} vs box ${boxH}: two close labels would overlap`);
  assert.equal(chart.split("styles: labelStyles(ink)").length - 1, 2, 'both label figures (level line label and the end label) must use the box style');
});
test('B3. role colours: accent for watch/confirm, amber for wrong-if, neutral for reference', () => {
  assert.ok(chart.includes("resolveCssColor(role === 'invalid' ? 'var(--amber)' : role === 'ref' ? 'var(--txt2)' : 'var(--accent)')"), 'the role-to-colour mapping changed');
});
test('B4. the WAIT Watching list: wait only, watch+confirm only, lowest first, at most four, none -> empty', () => {
  const at = box.indexOf('const watched = '); assert.ok(at > 0, 'CONTROL: watched not found'); const src = box.slice(at, box.indexOf(';\n', at) + 1);
  const watched = new Function('r', `${stripTypeScriptTypes(src)}\nreturn watched;`) as (r: unknown) => { price: number; role: string }[];
  const lv = (price: number, role: string) => ({ price, role, labelKey: 'K' });
  const lvls = [lv(5, 'watch'), lv(1, 'confirm'), lv(9, 'invalid'), lv(3, 'ref'), lv(2, 'watch'), lv(4, 'confirm'), lv(8, 'watch'), lv(0.5, 'invalid')];
  assert.deepEqual(watched({ verdict: 'wait', overlay: { levels: lvls } }).map((l) => l.price), [1, 2, 4, 5], 'not (watch+confirm, lowest first, max 4)');
  for (const v of ['buy', 'sell']) assert.deepEqual(watched({ verdict: v, overlay: { levels: lvls } }), [], `a ${v} call lists watched levels`);
  assert.deepEqual(watched({ verdict: 'wait', overlay: { levels: [lv(9, 'invalid'), lv(3, 'ref')] } }), [], 'only wrong-if / reference levels must give no line');
  assert.deepEqual(watched({ verdict: 'wait', overlay: undefined }), []); assert.deepEqual(watched(null), []);
  assert.ok(box.includes('{watched.length > 0 && (') && box.includes("data-testid=\"strategy-call-watching\"") && box.includes("{t('STRAT_WATCHING')}: "), 'the line is not gated on having levels or lost its label');
});
test('B5. the Market Read says how many signals agree; no default still promises a best setup or asks about trading; the Watching key is registered', () => {
  assert.equal(en.MARKET_READ_EYEBROW_Q, ' · how many signals agree'); assert.equal(en.MARKET_READ_SCALE_GOOD, '≥ 70 most agree'); assert.equal(en.MARKET_READ_GOOD_TICK_TITLE, 'Signals agree ≥70');
  assert.match(en.MARKET_READ_TIP, /how many signals agree/i); assert.match(en.MARKET_READ_TIP, /A description, not advice/);
  assert.equal(en.DASHBOARD_HINT_BODY, 'Your at-a-glance market read - overall conditions and the signals worth a look.');
  const bad = Object.entries(en).filter(([k, v]) => /^(MARKET_READ_|DASHBOARD_HINT_BODY)/.test(k) && /best setup|before you place a trade|good time to trade|is now a good time/i.test(v)).map(([k, v]) => `${k}: ${v}`); assert.deepEqual(bad, []);
  assert.equal(en.STRAT_WATCHING, 'Watching'); assert.ok(read('lib/labelKeys.ts').includes("'STRAT_WATCHING'"), 'STRAT_WATCHING is not registered');
});
