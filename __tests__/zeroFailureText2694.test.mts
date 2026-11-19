import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/* #2694 (from QA's node probe of the signed-out matrix on qa 816e5aa, #1185): three more places that printed a dash or a failure word. Written rule (PR body): the dashboard's BTC LONG/SHORT block is LEFT OUT when the split cannot be had (it printed its label over "Unavailable"); an Arena EMA condition row with no verdict shows NO mark (it showed a bare "-") but keeps its column width so the rows do not shift; the blurred Pro rows of the Multi-timeframe card show the sharp timeframe and a blurred bar only (mtfAlignmentNoDash2576 D4b).
 *   K1 the condition mark on a truth table   K2 the long/short block hidden and empty when unavailable, drawn when there is a split   K3 the blurred rows (see D4b) hide the value and the bias badge only for a locked row
 * NOT covered (browser cells after deploy): the layout of the dashboard column when the block is hidden. */
const rd = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '');
const must = (s: string, re: RegExp, what: string) => { const m = re.exec(s); assert.ok(m, `CONTROL: ${what} not found`); return m![1]; };
const ev = (expr: string, v: Record<string, unknown>) => new Function(...Object.keys(v), `return (${expr});`)(...Object.values(v));

test('K1. the EMA condition mark: tick, cross, warning, and NOTHING when undetermined (never a dash); the mark keeps its width', () => {
  const src = rd('components/EMASignal.tsx'); const expr = must(src.replace(/\/\/[^\n]*/g, ''), /const icon = (warn \? '!' : pass === true \? '✓' : pass === false \? '✗' : '');/, 'icon expression');
  for (const [warn, pass, want] of [[true, true, '!'], [true, null, '!'], [false, true, '✓'], [false, false, '✗'], [false, null, ''], [false, undefined, '']] as const) assert.equal(ev(expr, { warn, pass }), want, JSON.stringify({ warn, pass }));
  assert.equal(/\? '-'|'-'\s*;/.test(expr), false, 'a dash is the fallback again');
  assert.match(code(src), /color: col, flexShrink: 0, minWidth: 10 \}\}>\{icon\}<\/span>/, 'the mark lost its minimum width: rows with no mark would shift the text left');
});
test('K2. the dashboard long/short block: hidden (display none, no content, no "Unavailable") when unavailable; drawn when there is a split', () => {
  const src = rd('components/MarketConditionsWidget.tsx'), c = code(src);
  const style = must(c, /<div style=\{(longShort === 'unavailable' \? \{ display: 'none' \} : \{ marginTop: 12, paddingTop: 10, borderTop: '0\.5px solid var\(--bdr\)' \})\}>/, 'block style');
  assert.deepEqual(ev(style, { longShort: 'unavailable' }), { display: 'none' }); assert.deepEqual(ev(style, { longShort: { long: 60, short: 40 } }), { marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--bdr)' }); assert.deepEqual(ev(style, { longShort: null }), { marginTop: 12, paddingTop: 10, borderTop: '0.5px solid var(--bdr)' }, 'a split still loading keeps its space (the skeleton)');
  assert.match(c, /\{longShort === 'unavailable' \? null : longShort \? \(\(\) => \{/, 'the unavailable branch must render nothing'); assert.equal(c.includes("t('STATE_UNAVAILABLE')"), false, 'the word Unavailable is drawn in this widget again');
});
test('K3. a locked MTF row hides its value and its bias badge, an unlocked row keeps them', () => {
  const c = code(rd('components/MultiTFAlignment.tsx')); assert.match(c, /\{locked \? '' : formatRsi\(rsi\)\}/, 'the locked row shows its value again'); assert.match(c, /\{!locked && <BiasBadge bias=\{bias\} \/>\}/, 'the locked row shows its bias badge again');
});
