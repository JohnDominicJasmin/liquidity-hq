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
const ORDER = ['liq_sweep_mss', 'ny_open_breakout', 'ema_stack', 'supply_demand', 'bb_squeeze', 'vwap_reclaim', 'rsi_divergence', 'channel'];

test('M1a. the strategies are the eight, in the owner\'s order, with unique ids and unique name keys', () => {
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

test('M3a. the call box reserves ONE height for its CHANGING part (the .strat-call-dyn section) at every width, holds the loading / unavailable / verdict / reason / levels parts inside it, and carries every test id the browser cells read', () => {
  /* RE-ANCHORED for the compact panel (#2500): the reserve is verdict (one line) + a reason clamped to ONE line + ONE levels line, a single calc() at every width. The old per-width bands (193 / 134 / 155 px) are gone, with their floor assertions. */
  const s = read('components/StrategyCallBox.tsx');
  const open = s.indexOf('className="strat-call-dyn"'); assert.ok(open > 0, 'the changing part is no longer in a .strat-call-dyn section');
  const close = s.indexOf("<div style={{ display: 'flex', alignItems: open"); assert.ok(close > open, 'the description row (one line, Expand / Collapse) is no longer after the changing part');
  const note = s.indexOf('data-testid="strategy-call-note"'); assert.ok(note > close, 'the Signals note is not AFTER the description row (#2366: call, description, note)');
  const dyn = s.slice(open, close);
  for (const id of ['strategy-call-loading', 'strategy-call-unavailable', 'strategy-call-verdict', 'strategy-call-reason', 'strategy-call-invalidation', 'strategy-call-watching']) assert.ok(dyn.includes(`data-testid="${id}"`), `${id} is outside the reserved section`);
  for (const id of ['strategy-call-box', 'strategy-call-desc', 'strategy-call-desc-toggle', 'strategy-call-note']) assert.ok(s.includes(`data-testid="${id}"`), `missing ${id}`);
  assert.equal(/data-testid="strategy-call-(desc|desc-toggle|note)"/.test(dyn), false, 'the description, its toggle or the note is inside the reserved section');
  assert.equal(s.includes('data-testid="strategy-call-name"'), false, 'the duplicate name heading is back (#2366: the menu already says which strategy)');
  assert.ok(/<p className=\{open \? undefined : 'strat-call-levels'\}/.test(dyn), 'the wrong-if / watching levels are not ONE always-visible line (strat-call-levels)');
  assert.ok(/className=\{open \? undefined : 'strat-call-reason-clamp'\}/.test(dyn), 'the reason is not clamped while closed');
  const css = read('app/globals.css');
  assert.ok(/:root\s*\{\s*--strat-call-dyn:\s*calc\(var\(--fs-label\) \* 1\.3 \+ 4px \+ var\(--fs-label\) \* 1\.4 \+ 4px \+ var\(--fs-caption\) \* 1\.35\)/.test(css), 'the reserve formula is not verdict (fs-label*1.3) + 4px + one reason line (fs-label*1.4) + 4px + levels line (fs-caption*1.35); the one reserve value (--strat-call-dyn) is gone from globals.css: the call arriving can push the panels again');
  assert.ok(/^\.strat-call-dyn\s*\{\s*min-height:\s*var\(--strat-call-dyn\)/m.test(css), 'the call block no longer reserves --strat-call-dyn');
  assert.equal(/@media[^{]*\{\s*\.strat-call-dyn\s*\{\s*min-height/.test(css), false, 'a per-width min-height for the call block is back: the reserve must be ONE value at every width');
  assert.ok(/\.strat-call-reason-clamp\s*\{[^}]*-webkit-line-clamp:\s*1/.test(css), 'the reason is no longer clamped to ONE line (the reserve assumes it: verdict + 1 reason line + levels line)');
  assert.ok(/\.strat-call-levels\s*\{[^}]*white-space:\s*nowrap[^}]*text-overflow:\s*ellipsis/.test(css), 'the levels line is no longer one ellipsized line');
  assert.ok(/html\[data-strat="1"\]\s+\.strat-call-host\s*\{\s*min-height:\s*calc\([^)]*var\(--strat-call-dyn\)/.test(css), 'the cached-strategy host reserve no longer builds on --strat-call-dyn');
  /* THE REAL HEIGHT IS GATED IN A BROWSER: qa/e2e/strategy-panel-compact.spec.ts (panel height at a 288 and 360 rail) and qa/e2e/cls-arena-gate.spec.ts. Here only the rules' existence is pinned. */
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
