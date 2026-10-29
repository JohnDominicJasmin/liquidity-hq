/* The Strategy chips and the chart share ONE source of truth for the overlay layers (#1543, fixed by #1544).
 *
 * THE BUG. On qa 6e47589 (Free, BTC 1h) the panel read "FREE · 0 of 1 used" with no chip pressed while the chart held the EMA
 * ribbon x4, S/R x4, GEX x2 and the VOL and RSI panes. Chip state came from the saved selection, the chart drew those layers from
 * their own props and its own toolbar state, so the two could never agree. PM's rule for the fix: the chart's actual overlay state
 * is the truth and the chips mirror it; the EMA ribbon and GEX are "always on" and take no slot; the S/R and Liq chips and the
 * chart toolbar buttons are one switch; the RSI chip says "pane always on"; the counter counts only slotted chips.
 *
 * WHAT THIS PINS, and how. Two parts, kept apart on purpose:
 *   BEHAVIOUR (OS1-OS4): lib/strategyRegistry.ts is pure, so overlayStates() and slottedIds() are called directly.
 *   STRUCTURE (OS5-OS9): the wiring between the Arena page, the chart and the panel is JSX inside components with no DOM test
 *   library here, so it is pinned by source anchors. The rendered proof is QA's matrix on #1544 (chip x plan x action, reading
 *   the chart instance). A structural pin shows the wiring is still one source; it does not show the chart draws.
 *
 * Mutations run when this was written (each turned the named test red): a second local showSR state back in the chart -> OS5;
 * the panel handed a hand-built overlays object -> OS6; the counter counting every selected id -> OS8; a fifth overlay entry
 * without a state -> OS1; EMA ribbon made toggleable -> OS2. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { INDICATORS, LIMITS, isOverlayId, overlayStates, slottedIds, indicatorLimit } from '../lib/strategyRegistry.ts';
import { appPath } from './_appPath.mts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const code = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const PAGE = code(read(appPath('app/arena/page.tsx')));
const CHART = code(read('components/KLineProChart.tsx'));
const PANEL = code(read('components/StrategyPanel.tsx'));
const anchorOnce = (src: string, needle: string, label: string) => {
  const n = src.split(needle).length - 1;
  assert.equal(n, 1, `${label}: anchor occurs ${n} time(s), expected exactly 1 - re-read the current source`);
  return src.indexOf(needle);
};

/* ── behaviour ─────────────────────────────────────────────────────────────────────────────────────────── */

test('OS1. every overlay-backed registry entry has a state, so no layer can be drawn without a chip state to mirror it', () => {
  const overlays = INDICATORS.filter((i) => i.source === 'overlay').map((i) => i.id).sort();
  assert.equal(overlays.length >= 4, true, `CONTROL: expected at least the four known overlays, found ${overlays.join(',')}`);
  const keys = Object.keys(overlayStates({ showSR: true, showLiq: true, hasLiq: true, hasGex: true })).sort();
  assert.deepEqual(keys, overlays, 'overlayStates() and the registry disagree about which entries are overlays');
  for (const id of overlays) assert.equal(isOverlayId(id), true, `${id} is an overlay in the registry but isOverlayId() says no`);
});

test('OS2. overlayStates: the ribbon is always on; S/R and Liq follow their switch; GEX and Liq say "none" when there is nothing to draw', () => {
  const s = (o: Partial<Parameters<typeof overlayStates>[0]>) => overlayStates({ showSR: true, showLiq: true, hasLiq: true, hasGex: true, ...o });
  assert.equal(s({}).EMA_RIBBON, 'always');
  assert.equal(s({ showSR: false, showLiq: false }).EMA_RIBBON, 'always', 'the ribbon must not depend on any switch');
  assert.equal(s({}).SR, 'on'); assert.equal(s({ showSR: false }).SR, 'off');
  assert.equal(s({}).LIQ_CLUSTERS, 'on'); assert.equal(s({ showLiq: false }).LIQ_CLUSTERS, 'off');
  assert.equal(s({ hasLiq: false }).LIQ_CLUSTERS, 'none', 'a layer with no clusters must read "none", not "on"');
  assert.equal(s({ hasLiq: false, showLiq: false }).LIQ_CLUSTERS, 'none');
  assert.equal(s({}).GEX, 'always'); assert.equal(s({ hasGex: false }).GEX, 'none');
  assert.equal(s({ showSR: false, showLiq: false }).GEX, 'always', 'GEX has no switch');
});

test('OS3. slottedIds drops exactly the overlays, so the counter and the cap never count a layer', () => {
  const all = INDICATORS.map((i) => i.id);
  const slotted = slottedIds(all);
  const overlays = INDICATORS.filter((i) => i.source === 'overlay').map((i) => i.id);
  assert.equal(slotted.length, all.length - overlays.length);
  for (const id of overlays) assert.equal(slotted.includes(id), false, `${id} takes a slot`);
  assert.deepEqual(slottedIds(['EMA_RIBBON', 'SR', 'RSI', 'GEX', 'SMA']), ['RSI', 'SMA']);
  assert.deepEqual(slottedIds([]), []);
});

test('OS4. the plan caps are Free 1 and Pro 3, and a chip selection of overlays alone can never fill them', () => {
  assert.equal(LIMITS.free, 1); assert.equal(LIMITS.pro, 3);
  assert.equal(indicatorLimit(false), 1); assert.equal(indicatorLimit(true), 3);
  assert.equal(slottedIds(['EMA_RIBBON', 'SR', 'LIQ_CLUSTERS', 'GEX']).length, 0, 'four overlays used a slot');
});

/* ── structure ─────────────────────────────────────────────────────────────────────────────────────────── */

test('OS5. the S/R and Liq switches live in ONE place (the Arena page); the chart takes them as props and keeps no state of its own', () => {
  anchorOnce(PAGE, 'const [showSR, setShowSRState]   = useState(true);', 'the Arena page owns showSR');
  anchorOnce(PAGE, 'const [showLiq, setShowLiqState] = useState(true);', 'the Arena page owns showLiq');
  assert.equal(/const \[\s*show(?:SR|Liq)\w*\s*,\s*set\w+\s*\]\s*=\s*useState/.test(CHART), false, 'the chart has its own S/R or Liq on/off state again (any name starting showSR or showLiq)');
  anchorOnce(CHART, 'showSR:        boolean;', 'the chart takes showSR as a prop');
  anchorOnce(CHART, 'onShowSRChange:  (next: boolean) => void;', 'the chart reports a S/R change upward');
  anchorOnce(CHART, 'showLiq:       boolean;', 'the chart takes showLiq as a prop');
  anchorOnce(CHART, 'onShowLiqChange: (next: boolean) => void;', 'the chart reports a Liq change upward');
});

test('OS6. the panel is given overlays derived by overlayStates() from the same showSR and showLiq the chart receives, never a hand-built object', () => {
  const at = anchorOnce(PAGE, '<StrategyPanel overlays={overlayStates({ showSR, showLiq,', 'the panel is fed overlayStates(showSR, showLiq, ...)');
  assert.ok(at > 0);
  assert.match(PAGE, /<KLineProChart [^>]*\bshowSR=\{showSR\}/, 'the chart is not handed the page\'s showSR');
  assert.match(PAGE, /<KLineProChart [^>]*\bshowLiq=\{showLiq\}/, 'the chart is not handed the page\'s showLiq');
  assert.equal(/overlays=\{\{/.test(PAGE), false, 'a hand-built overlays object is passed to the panel');
});

test('OS7. the chart draws S/R and Liq from the switch it was given, and its toolbar buttons flip that same switch', () => {
  anchorOnce(CHART, 'if (!showSR || !srLevels.length) return;', 'S/R is drawn only when showSR is on');
  anchorOnce(CHART, 'if (!showLiq || !liqClusters?.length) return;', 'Liq is drawn only when showLiq is on');
  anchorOnce(CHART, 'onClick={() => onShowSRChange(!showSR)}', 'the S/R toolbar button flips showSR');
  anchorOnce(CHART, 'onClick={() => onShowLiqChange(!showLiq)}', 'the Liq toolbar button flips showLiq');
});

test('OS8. the panel counts only slotted chips and enforces the cap in one place', () => {
  anchorOnce(PANEL, 'const used = slottedIds(selected).length;', 'the counter counts slotted chips only');
  anchorOnce(PANEL, 'if (slottedIds([id]).length > 0 && slottedIds(prev).length >= limit) return prev;', 'the cap is enforced in nextSelection');
});

test('OS9. an overlay chip is on exactly when the chart is drawing it; "always" chips are fixed and tagged; RSI says its pane is always on', () => {
  anchorOnce(PANEL, "const on = isOverlay ? (ovState === 'always' || ovState === 'on') : pos >= 0;", 'an overlay chip mirrors the overlay state');
  anchorOnce(PANEL, "const fixedOn = ovState === 'always';", 'always-on overlays are fixed');
  assert.match(PANEL, /\{fixedOn && <span className="strat-chip-tag" aria-hidden="true">always on<\/span>\}/, 'the "always on" tag is gone');
  assert.match(PANEL, /\{entry\.id === 'RSI' && <span className="strat-chip-tag" aria-hidden="true">pane always on<\/span>\}/, 'the RSI "pane always on" tag is gone');
  assert.match(PANEL, /fixedOn \? 'Always shown on the chart'/, 'the always-on tooltip is gone');
});
