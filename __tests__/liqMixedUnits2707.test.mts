/* QA: PR #2707, a coin whose liquidation feed comes in MIXED UNITS shows and quotes no liquidation levels (PM ruling B, 2026-11-20, data-integrity rule).
 *
 * THE WRITTEN RULE (PM + Dev's PR): the liquidation rows keep each event's price RAW, in the contract unit of the venue that reported it, and the clusters mix both venues. Where Bybit and Binance list the coin with a DIFFERENT multiplier (sats 10000x / 1000x; tag, toshi, turbo 1000x / per-token)
 * one cluster list holds two scales, so for exactly those coins: no chart Liq layer, no strategy liquidation levels, the Liq chip off with the reason, and the AI read is told "not used", never given mixed prices. Every other coin is untouched.
 *   L1  liqUnitsMixed on a written table (sats tag toshi turbo true; pepe bonk mog floki cat btc eth sol an unknown id false), and the whole universe: exactly those four, each with two venue symbols whose denominations differ
 *   L2  formatClustersForPrompt: a mixed coin returns the "not used" line whatever the buckets hold; pepe with the same kind of buckets still returns its clusters; an empty ordinary feed still says "Not available"
 *   L3  THE AI PROMPT'S RAID GUARD (#1631 B: "no data, no raid"): for a mixed coin the Quick and Combined prompts carry the order "a raid cannot be judged: write RAID_SETUP: NONE", exactly as they do for an empty feed; clusters present for pepe does not
 *   L4  the Arena page: the chart's cluster list is empty for a mixed coin (and the strategies read their liquidation levels from it), the panel receives the flag
 *   L5  the panel: the Liq chip is unavailable for the flag, titled with the new label, and a one-line note under the chips carries the same label
 *   L7  the second site of the same keying (applyResultChecks): a raid written anyway for a mixed coin is dropped, as for an empty feed; kept with clusters
 *   L6  the label: registered, the English default equals the migration's en rows, held migration: PROD block == DEV block (5 locales, once each, only the two label tables, an upsert), nothing newer writes the key, each locale in its own script, no vendor, no advice
 * WHAT THIS CANNOT PROVE: the chip and the note on screen, or the chart with no Liq layer for these coins (the browser run after promotion). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { liqUnitsMixed, venueSymbols, symbolDenominationFactor, UNIVERSE_COINS } from '../lib/coins.ts';
import { formatClustersForPrompt } from '../lib/liqClusters.ts';
import { buildCombinedPrompt, buildQuickPrompt } from '../lib/grok.ts';
import type { GrokContext, ChartData } from '../lib/grok.ts';
import { LABEL_KEYS } from '../lib/labelKeys.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const MIXED = ['sats', 'tag', 'toshi', 'turbo'];

test('L1. liqUnitsMixed: the written table and the universe sweep', () => {
  for (const c of MIXED) assert.equal(liqUnitsMixed(c), true, c);
  for (const c of ['pepe', 'bonk', 'mog', 'floki', 'cat', 'btc', 'eth', 'sol', 'doge', 'zzz_unknown']) assert.equal(liqUnitsMixed(c), false, c);
  const found = (UNIVERSE_COINS as string[]).filter((c) => liqUnitsMixed(c));
  console.log(`[L1] mixed-unit coins in the universe: ${found.join(' ')}`);
  assert.deepEqual([...found].sort(), [...MIXED].sort(), 'the set of mixed-unit coins is not exactly the four the PR names');
  for (const c of found) { const v = venueSymbols(c); assert.ok(v.bybit && v.binance, `${c} needs both venues`); assert.notEqual(symbolDenominationFactor(v.bybit!), symbolDenominationFactor(v.binance!), `${c}: the two venues quote the same unit`); }
  /* the control the other way: every coin listed on both venues WITH the same denomination is not mixed */
  const same = (UNIVERSE_COINS as string[]).filter((c) => { const v = venueSymbols(c); return v.bybit && v.binance && symbolDenominationFactor(v.bybit) === symbolDenominationFactor(v.binance); });
  assert.ok(same.length > 100 && same.every((c) => !liqUnitsMixed(c)), 'control: coins on both venues with one unit are not flagged');
});

const bucket = (coin: string, price: number) => ({ coin, price, total: 1_500_000, longUsd: 1_000_000, shortUsd: 500_000 });

test('L2. formatClustersForPrompt: mixed coins are "not used", others unchanged', () => {
  for (const c of MIXED) { const s = formatClustersForPrompt([bucket(c, 4.2), bucket(c, 4.3)], c); assert.match(s, /^Not used for this coin/, c); assert.doesNotMatch(s, /\$\d/, `${c}: a price leaked into the line`); }
  assert.match(formatClustersForPrompt([bucket('pepe', 3.8)], 'pepe'), /\$3\.8 \$1\.5M longs/);
  assert.equal(formatClustersForPrompt([], 'btc'), 'Not available');
});

/* ── L3: the prompt's raid guard ───────────────────────────────────── */
function ctx(overrides: Partial<GrokContext>): GrokContext {
  return new Proxy({ ...overrides } as Record<string, unknown>, { get: (t, k) => (k in t ? t[k as string] : `<${String(k)}>`), has: () => true }) as unknown as GrokContext;
}
const CHART: ChartData = { tf: '1h', rsi: 50, recent20: 'flat', lastClose: 4.2, hi: 4.4, lo: 4.1, ema9: 4.2, sma200: 4.0 };
const NO_RAID = /a raid cannot be judged: write RAID_SETUP: NONE, RAID_TARGET: N\/A, RAID_TRIGGER: N\/A/;

test('L3. the AI prompt orders RAID_SETUP: NONE for a mixed coin, as it does for an empty feed (and not when clusters exist)', () => {
  const empty = formatClustersForPrompt([], 'btc'); for (const build of [buildCombinedPrompt, buildQuickPrompt]) assert.match(build(ctx({ coin: 'BTC/USDT', liqLevels: empty }), CHART), NO_RAID, 'control: an empty feed must carry the guard');
  const withClusters = formatClustersForPrompt([bucket('pepe', 3.8)], 'pepe'); for (const build of [buildCombinedPrompt, buildQuickPrompt]) assert.doesNotMatch(build(ctx({ coin: 'PEPE/USDT', liqLevels: withClusters }), CHART), NO_RAID, 'control: clusters present must not carry the guard');
  const bad: string[] = [];
  for (const c of MIXED) for (const [name, build] of [['Combined', buildCombinedPrompt], ['Quick', buildQuickPrompt]] as const) {
    const liq = formatClustersForPrompt([bucket(c, 4.2)], c); const p = build(ctx({ coin: `${c.toUpperCase()}/USDT`, liqLevels: liq }), CHART);
    if (!NO_RAID.test(p)) bad.push(`${c} ${name}: liqLevels "${liq}" -> the prompt has no "no raid" order`);
  }
  assert.deepEqual(bad, [], 'the "no data, no raid" guard (#1631 B) is keyed on the line starting "Not available"; a mixed coin\'s line starts differently, so the model is left free to invent a raid');
});

/* ── L4 / L5: the wiring ───────────────────────────────────────────── */
test('L4. the Arena page empties the cluster list for a mixed coin and hands the panel the flag', () => {
  const page = read('app/(main)/arena/page.tsx');
  assert.match(page, /\(liqUnitsMixed\(selectedCoin\) \? \[\] : topClustersForCoin\(liqClusters, selectedCoin\)\)/);
  assert.match(page, /const strategyLiqLevels = useMemo\(\(\) => \(chartLiqClusters \?\? \[\]\)\.map\(c => c\.price\), \[chartLiqClusters\]\)/, 'the strategies must read their liquidation levels from the (emptied) chart list');
  assert.match(page, /<StrategyPanel overlays=\{overlayStates\([\s\S]{0,4000}?\bliqMixedUnits=\{liqUnitsMixed\(selectedCoin\)\}/, 'the StrategyPanel element does not receive liqMixedUnits={liqUnitsMixed(selectedCoin)} (prop order is free)');
  assert.match(page, /formatClustersForPrompt\(liqClusters, selectedCoin\)/, 'the AI context line goes through the formatter that refuses mixed coins');
});
test('L5. the panel: Liq chip unavailable with the label as its title, and the one-line note', () => {
  const p = read('components/StrategyPanel.tsx');
  assert.match(p, /liqMixedUnits\?: boolean;/); assert.match(p, /unavailable=\{liqMixedUnits \|\| \(layer\('LIQ_CLUSTERS'\) === 'none' && !layersLocked\)\}/);
  assert.match(p, /unavailableTitle=\{liqMixedUnits \? t\('STRATEGY_PANEL_LIQ_MIXED_UNITS'\)/); assert.match(p, /\{liqMixedUnits && <div className="strat-note"[^>]*>\{t\('STRATEGY_PANEL_LIQ_MIXED_UNITS'\)\}<\/div>\}/);
  assert.match(p, /title=\{unavailable \? \(unavailableTitle \?\? t\('STRATEGY_PANEL_LAYER_UNAVAILABLE'\)\) : undefined\}/, 'the chip title falls back to the old text for every other unavailable chip');
});

/* ── L6: the label and its held migration ──────────────────────────── */
const KEY = 'STRATEGY_PANEL_LIQ_MIXED_UNITS'; const LOCS = ['en', 'ko', 'zh', 'ru', 'ar'];
const dir = new URL('../supabase/migrations/', import.meta.url); const FILE = '20261127b_labels_liq_mixed_units.sql'; const sql = readFileSync(new URL(FILE, dir), 'utf8').replace(/\r\n/g, '\n');
type Row = { key: string; locale: string; value: string };
function block(table: string): Row[] {
  const m = new RegExp(`insert into ${table} \\(key, locale, value\\) values\\n([\\s\\S]*?)\\non conflict \\(key, locale\\) do update set value = excluded\\.value, updated_at = now\\(\\);`).exec(sql);
  assert.ok(m, `no upsert block for ${table}`);
  return [...m![1].matchAll(/^\('([A-Z0-9_]+)','([a-z]{2})','((?:[^']|'')*)'\),?$/gm)].map((r) => ({ key: r[1], locale: r[2], value: r[3].replace(/''/g, "'") }));
}
test('L6. the label is registered, equals its migration, the migration is a held two-block upsert and the newest row', () => {
  const defaults = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
  assert.ok((LABEL_KEYS as readonly string[]).includes(KEY), 'the key is not in LABEL_KEYS'); assert.ok(defaults[KEY], 'no English default');
  assert.match(sql, /NOT YET APPLIED TO ANY DATABASE/); const prod = block('lhq_labels'), dev = block('lhq_dev_labels');
  assert.deepEqual(prod, dev, 'the PROD and DEV blocks must be the same rows'); assert.equal(prod.length, 5); assert.deepEqual(prod.map((r) => r.locale), LOCS); assert.ok(prod.every((r) => r.key === KEY));
  assert.equal(prod[0].value, defaults[KEY], 'the English row equals the shipped default');
  const tables = [...sql.matchAll(/insert into (\w+)/g)].map((m) => m[1]); assert.deepEqual([...new Set(tables)].sort(), ['lhq_dev_labels', 'lhq_labels']);
  const script: Record<string, RegExp> = { ko: /[가-힣]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/, ar: /[؀-ۿ]/ };
  for (const r of prod.slice(1)) { assert.match(r.value, script[r.locale], `${r.locale} is not in its own script`); assert.doesNotMatch(r.value, /[A-Za-z]{4,}/, `${r.locale} carries Latin words`); }
  assert.doesNotMatch(prod.map((r) => r.value).join(' '), /Grok|xAI|OpenAI|Claude|Anthropic|GPT/i, 'a vendor is named');
  assert.doesNotMatch(defaults[KEY], /should|will|expect|likely|avoid|watch for/i, 'advice or forecast wording');
  const later = readdirSync(dir).filter((f) => f > FILE && f.endsWith('.sql') && read(`supabase/migrations/${f}`).includes(KEY));
  assert.deepEqual(later, [], `a later migration rewrites ${KEY}: ${later.join(', ')}`);
});

/* ── L7: the same keying at the SECOND site (lib/grok.ts applyResultChecks: a raid the model wrote anyway is dropped when the prompt carried no cluster data) ───── */
test('L7. a raid the model writes for a mixed coin is dropped like one written with an empty feed; with real clusters it is kept', async () => {
  const { parseCombinedRead, applyResultChecks } = await import('../lib/grok.ts');
  const ANSWER = ['SIGNAL: FLAT', 'CONFIDENCE: 50', 'SIDES: EMA9 ABOVE | SMA200 ABOVE | VWAP BELOW', 'REASONING: r', 'RAID_SETUP: SHORT SQUEEZE', 'RAID_TARGET: $4.30', 'RAID_TRIGGER: A break and hold above $4.25 on the 15m.'].join('\n');
  const answer = (liqLevels: string, coin: string) => { const prompt = buildCombinedPrompt(ctx({ coin, liqLevels }), CHART); const parsed = parseCombinedRead(ANSWER, '1h', 'NY')!; return applyResultChecks(parsed, prompt); };
  const kept = answer(formatClustersForPrompt([bucket('pepe', 3.8)], 'pepe'), 'PEPE/USDT');
  assert.equal(kept.raidSetup, 'SHORT SQUEEZE', 'control: with clusters the raid must be kept'); assert.ok(!kept.checks.includes('raid dropped: no liquidation cluster data'));
  const empty = answer(formatClustersForPrompt([], 'btc'), 'BTC/USDT'); assert.equal(empty.raidSetup, null, 'control: an empty feed drops the raid'); assert.ok(empty.checks.includes('raid dropped: no liquidation cluster data'));
  for (const c of MIXED) {
    const r = answer(formatClustersForPrompt([bucket(c, 4.2)], c), `${c.toUpperCase()}/USDT`);
    assert.equal(r.raidSetup, null, `${c}: a raid survived on a mixed-unit feed`); assert.equal(r.raidTarget, null); assert.equal(r.raidTrigger, null); assert.ok(r.checks.includes('raid dropped: no liquidation cluster data'), `${c}: ${JSON.stringify(r.checks)}`);
  }
});
