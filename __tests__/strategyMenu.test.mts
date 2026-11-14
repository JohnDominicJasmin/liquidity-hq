import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { STRATEGIES } from '../lib/strategies/index.ts';
import { STRATEGY_SETS, AUTO_SET_ID, CUSTOM_SET_ID, SELECTABLE_INDICATOR_IDS } from '../lib/strategyRegistry.ts';

/* #2358 (one strategy menu, owner decision 2026-11-14 option A): QA's unit cells on the DATA behind the menu.
 * WHAT THIS PINS: the menu is "Let the read choose", the seven strategies in the owner's order, "Custom", with the three old presets gone and no duplicate id or name key; every strategy's chip map lists only
 * chips that actually draw (SELECTABLE_INDICATOR_IDS), and ONLY Bollinger squeeze maps to a chip (BOLL); the panel builds its options from exactly those lists; the call box reserves its height and has every
 * test id the browser cells use; the old Strategy card (component, test ids, import) is gone from the app.
 * WHAT IT CANNOT PROVE: what the page shows (qa/e2e/strategy-menu.spec.ts), the CLS number (the probe on deployed qa). */

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const ORDER = ['liq_sweep_mss', 'ny_open_breakout', 'ema_stack', 'supply_demand', 'bb_squeeze', 'vwap_reclaim', 'rsi_divergence'];

test('M1a. the strategies are the seven, in the owner\'s order, with unique ids and unique name keys', () => {
  assert.deepEqual(STRATEGIES.map((s) => s.id), ORDER);
  assert.equal(new Set(STRATEGIES.map((s) => s.id)).size, ORDER.length); assert.equal(new Set(STRATEGIES.map((s) => s.nameKey)).size, ORDER.length);
  for (const s of STRATEGIES) assert.match(s.nameKey, /^STRAT_[A-Z0-9_]+_NAME$/, `${s.id}: the name is a label key, never literal text`);
});

test('M1b. the sets list holds only "Let the read choose" and "Custom"; the three old presets are gone', () => {
  assert.deepEqual(STRATEGY_SETS.map((s) => [s.id, s.label]), [[AUTO_SET_ID, 'Let the read choose'], [CUSTOM_SET_ID, 'Custom']]);
  const src = read('lib/strategyRegistry.ts'); for (const old of ['Liquidity Sweep', 'Trend Follow', 'Mean Reversion']) assert.equal(new RegExp(`label:\\s*'${old}'`).test(src), false, `the old preset "${old}" is still a set`);
});

test('M1c. the panel builds the menu as: Let the read choose, the strategies in STRATEGIES order, Custom (nothing else)', () => {
  const s = read('components/StrategyPanel.tsx'); const i1 = s.indexOf('STRATEGY_SETS.filter(s => s.id === AUTO_SET_ID)'); const i2 = s.indexOf('STRATEGIES.map(s =>'); const i3 = s.indexOf('STRATEGY_SETS.filter(s => s.id === CUSTOM_SET_ID)');
  assert.ok(i1 > 0 && i2 > i1 && i3 > i2, 'the order in the panel is not auto, strategies, custom');
  assert.match(s, /data-testid="strategy-set-select"/); const sel = s.slice(s.indexOf('data-testid="strategy-set-select"'), s.indexOf('</select>', s.indexOf('data-testid="strategy-set-select"'))); assert.equal((sel.match(/<option /g) || []).length, 3, 'a hand-written option crept into the menu');
});

test('M2a. chip map: every chip a strategy turns on is a chip that DRAWS, and only Bollinger squeeze turns one on (BOLL)', () => {
  const ids = new Set<string>(SELECTABLE_INDICATOR_IDS);
  for (const s of STRATEGIES) { for (const c of s.chips) assert.ok(ids.has(c), `${s.id} maps to ${c}, which is not a selectable chip`); }
  assert.deepEqual(STRATEGIES.filter((s) => s.chips.length > 0).map((s) => [s.id, [...s.chips]]), [['bb_squeeze', ['BOLL']]]);
});

test('M3a. the call box reserves the height of its CHANGING part (the .strat-call-dyn section), holds the loading / unavailable / verdict parts inside it, and carries every test id the browser cells read', () => {
  const s = read('components/StrategyCallBox.tsx');
  const open = s.indexOf('className="strat-call-dyn"'); assert.ok(open > 0, 'the changing part is no longer in a .strat-call-dyn section');
  const close = s.indexOf('<p data-testid="strategy-call-note"'); assert.ok(close > open, 'the signals-not-predictions line moved inside the changing part');
  const dyn = s.slice(open, close);
  for (const id of ['strategy-call-loading', 'strategy-call-unavailable', 'strategy-call-verdict', 'strategy-call-reason', 'strategy-call-invalidation']) assert.ok(dyn.includes(`data-testid="${id}"`), `${id} is outside the reserved section`);
  for (const id of ['strategy-call-box', 'strategy-call-name', 'strategy-call-desc', 'strategy-call-note']) assert.ok(s.includes(`data-testid="${id}"`), `missing ${id}`);
  assert.equal(/data-testid="strategy-call-(name|desc)"/.test(dyn), false, 'the static name or description is inside the reserved section');
  const css = read('app/globals.css');
  const wide = /^\.strat-call-dyn\s*\{\s*min-height:\s*(\d+)px/m.exec(css); assert.ok(wide, 'the wide-screen reserve is gone from globals.css: the call arriving can push the panels again'); assert.ok(Number(wide![1]) >= 150, `the wide reserve is only ${wide![1]}px`);
  const mid = /@media\s*\(max-width:\s*(?:9\d\d|10\d\d)px\)\s*\{\s*\.strat-call-dyn\s*\{\s*min-height:\s*(\d+)px/.exec(css); assert.ok(mid && Number(mid[1]) >= 100, 'the tablet-width reserve (the band where the arena workspace is one column) is missing or tiny');
  const phone = /@media\s*\(max-width:\s*640px\)\s*\{\s*\.strat-call-dyn\s*\{\s*min-height:\s*(\d+)px/.exec(css); assert.ok(phone && Number(phone[1]) >= 100, 'the phone reserve is missing or tiny');
  /* THE REAL HEIGHTS ARE GATED BY qa/e2e/strategy-call-height.spec.ts (it fails when a reserve is smaller than the tallest possible call at that width); here only the rules' existence and a floor are pinned. */
  assert.ok(/state\.error \?/.test(s) && /STRAT_UNAVAILABLE/.test(s), 'a failed read must show the unavailable state');
});

test('M8. the old Strategy card is gone: no component file, no test id, no import anywhere in app/, components/ or lib/', () => {
  assert.throws(() => readFileSync(new URL('../components/ArenaStrategyCard.tsx', import.meta.url)), 'ArenaStrategyCard.tsx still exists');
  const hits: string[] = [];
  const walk = (dir: string) => { for (const n of readdirSync(dir)) { if (n === 'node_modules' || n === '.next' || n.startsWith('.')) continue; const p = join(dir, n); if (statSync(p).isDirectory()) walk(p); else if (/\.(tsx?|jsx?|mts|css)$/.test(n)) { const t = readFileSync(p, 'utf8'); if (/ArenaStrategyCard|arena-strategy-card|arena-strategy-select/.test(t)) hits.push(p.split('\\').join('/')); } } };
  for (const d of ['app', 'components', 'lib', 'hooks']) { try { walk(d); } catch { /* absent */ } }
  assert.deepEqual(hits, [], 'the old card is still referenced');
});

test('M5a. an unknown stored id is never trusted: the page sets the strategy only when findStrategy knows it', () => {
  const s = read('app/(main)/arena/page.tsx'); assert.match(s, /if \(findStrategy\(settings\.arena_strategy\)\) setArenaStrategyState\(settings\.arena_strategy\);/);
});
