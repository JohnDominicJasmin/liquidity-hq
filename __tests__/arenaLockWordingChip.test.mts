/* #1609 (#1612): the lock line on a locked coin says "available in Pro", and no setup chip shows on a coin the viewer's plan locks.
 *
 * WHAT THIS PINS (pure code, no browser): `gateSignal` marks a signal `planPending` only while the plan is loading for a coin off the Free list; the English default of
 * ARENA_COIN_LOCK_LINE and all ten rows of the label migration (five languages, live block and commented dev block) carry the approved wording and the {coin} placeholder; and
 * the chart's chip guard is the one line `signalLock === 'free' || planPending === true`, which does not hide the chip from signed-out visitors, Pro or unlocked coins.
 *
 * WHAT IT CANNOT PROVE (the verdict says so): that the chip is gone on screen. The chip needs price near a level with two or more touches and a squeeze score of 50 or more,
 * which a test cannot arrange; the page-level check on qa counts the chip on the real chart. Nor does it prove the migration is applied (it is not), or that the machine
 * translations in ko, zh, ru, ar read well. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { gateSignal, type SignalPlan } from '../lib/signalCoinGate.ts';
import type { StrategySignal } from '../lib/useEMAStrategy.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').split(/\r?\n/).join('\n');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const SIG = (over: Partial<StrategySignal> = {}): StrategySignal => ({
  verdict: 'TRENDING LONG', phase: 'Trend up', conditions: [], ema9_4h: 1, ema20_4h: 1, ema50_4h: 1, sma200_1d: 1, volMA20: 1, lastVol: 1, priceInValueZone: true, sl: 1, tp: 2,
  loading: false, error: null, signalTimestamp: 5, signalAnchorPrice: 9, signalDir: 'long', signalLongs: [], signalShorts: [], pendingSetup: null, signalLock: null, lockedMarkers: [],
  counterTrend: false, atrLast: 1, ema50Slope: 0, chopIndex: 1, chopRegime: null, reversalWarnings: [], recentStats: null, weakEdge: false, verdictChangedBySelection: false, ...over,
} as unknown as StrategySignal);

test('W1. gateSignal sets planPending only while the plan is loading for a coin off the Free list; never for Free, trial, signed out, Pro, unknown, or a coin on the list', () => {
  for (const coin of ['xrp', 'hype', 'doge']) assert.equal(gateSignal(SIG(), 'pending', coin).planPending, true, `pending ${coin}`);
  for (const coin of ['btc', 'eth', 'sol']) assert.ok(!gateSignal(SIG(), 'pending', coin).planPending, `pending ${coin} is on the Free list`);
  for (const plan of ['free', 'trial', 'signed_out', 'pro'] as SignalPlan[]) for (const coin of ['xrp', 'btc']) assert.ok(!gateSignal(SIG(), plan, coin).planPending, `${plan} ${coin}`);
  assert.ok(!gateSignal(SIG(), null, 'xrp').planPending, 'an unknown plan must not set it');
  // what the chip reads: Free and trial on a locked coin are signalLock 'free'; signed out is 'signed_out'; pending has no lock
  assert.equal(gateSignal(SIG(), 'free', 'xrp').signalLock, 'free'); assert.equal(gateSignal(SIG(), 'trial', 'xrp').signalLock, 'free');
  assert.equal(gateSignal(SIG(), 'signed_out', 'xrp').signalLock, 'signed_out'); assert.equal(gateSignal(SIG(), 'pending', 'xrp').signalLock, null);
});

test('W2. the lock line carries the approved wording in the English default and in all ten migration rows (five languages, live block and commented dev block)', () => {
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  const en = defaults.ARENA_COIN_LOCK_LINE;
  assert.equal(en, 'Buy/Sell signals, Quick Research and Deep Research for {coin} are available in Pro. Free includes BTC, ETH and SOL.');
  assert.ok(!/Pro only/i.test(en));
  const sql = read('supabase/migrations/20261020a_labels_arena_coin_lock.sql');
  const rows = [...sql.matchAll(/^(--\s*)?\('ARENA_COIN_LOCK_LINE','([a-z-]+)','((?:[^']|'')*)'\)/gm)];
  assert.equal(rows.length, 10, `expected 10 rows (5 languages x live and dev block), found ${rows.length}`);
  for (const lang of ['en', 'ar', 'ko', 'ru', 'zh']) {
    const mine = rows.filter((r) => r[2] === lang);
    assert.equal(mine.length, 2, `${lang}: one live row and one commented dev row`);
    assert.equal(mine.filter((r) => !r[1]).length, 1, `${lang}: exactly one live row`);
    assert.equal(mine[0][3], mine[1][3], `${lang}: the live and dev rows differ`);
    assert.ok(mine[0][3].includes('{coin}'), `${lang}: the {coin} placeholder is missing`);
    assert.ok(/BTC/.test(mine[0][3]) && /ETH/.test(mine[0][3]) && /SOL/.test(mine[0][3]), `${lang}: the Free list is not named`);
  }
  assert.equal(rows.find((r) => r[2] === 'en' && !r[1])![3], en, 'the English migration row differs from the English default');
});

test('W3. source: the chart hides the setup chip for exactly "signalLock free or planPending", and the guard does not mention signed out, Pro or a coin list', () => {
  const src = stripTsComments(read('components/KLineProChart.tsx'));
  const guard = src.match(/const setupChipHidden\s*=\s*([^;]+);/);
  assert.ok(guard, 'the guard moved: re-derive this pin');
  assert.equal(guard![1].replace(/\s+/g, ' ').trim(), "emaSignal?.signalLock === 'free' || emaSignal?.planPending === true");
  assert.ok(/if \(setupChipHidden\) return null;/.test(src), 'the guard is not applied to the chip');
  // only the Arena renders the chart, so the chip cannot show elsewhere with an ungated signal
  for (const f of ['app/arena/page.tsx']) assert.ok(/<KLineProChart[^>]*emaSignal=\{emaSignal\}/.test(read(f)), `${f}: the chart is not given the gated signal`);
});
