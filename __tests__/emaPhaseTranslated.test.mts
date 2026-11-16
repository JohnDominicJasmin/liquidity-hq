/* #2410: the EMA card's phase line and counter-trend row are shown in the reader's language; the engine's English string (the AI prompt and Telegram read it) is unchanged.
 *   E1  REAL judgeRibbon driven over every ribbon/price/daily-200 state (x 3 timeframes labels): every phase it can write is translatable (phaseI18n is not null) and the key's English default reproduces the engine sentence EXACTLY (round trip), incl. the {tf} param and the counter-trend suffix
 *   E2  the selected-indicator downgrade sentences written in useEMAStrategy.ts each map to a key whose English default is that exact sentence
 *   E3  an unknown phase returns null (the card falls back to the English as written: never blank), and the counter-trend flag is split off and translated on its own
 *   E4  the counter-trend row detail keys: the four English defaults equal what the engine writes for above/below x long/short, and the card shows detailKey only for the warning row
 * WHAT IT CANNOT PROVE: ko/zh/ru/ar wording quality and the card's rendering in a longer language (browser cell). */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { judgeRibbon } from '../lib/strategyCore.ts';
import { phaseI18n } from '../lib/emaPhaseI18n.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const render = (phase: string) => { const p = phaseI18n(phase); if (!p) return null; const body = en[p.key].replace(/\{(\w+)\}/g, (_, k) => p.params?.[k] ?? `{${k}}`); return p.counterSuffix ? `${body} - ${en.EMA_PHASE_COUNTER_SUFFIX}` : body; };

test('E1. REAL judgeRibbon: every phase it writes translates, and the English default reproduces it exactly', () => {
  const seen = new Set<string>(); const bad: string[] = [];
  for (const [ribbonBull, ribbonBear] of [[true, false], [false, true], [false, false]] as const)
    for (const have200D of [true, false]) for (const above200D of [true, false])
      for (const [price, inVZoneLong, inVZoneShort] of [[110, false, false], [100, true, true], [95, false, false], [85, false, false], [105, false, false]] as const)
        for (const tfLabel of ['5m', '1h', '4h']) {
          const j = judgeRibbon({ ribbonBull, ribbonBear, have200D, above200D, price, ema9: 100, ema20: 98, ema50: 90, inVZoneLong, inVZoneShort, tfLabel });
          seen.add(j.phase); const r = render(j.phase);
          if (r !== j.phase) bad.push(`${JSON.stringify(j.phase)} -> ${JSON.stringify(r)}`);
        }
  assert.ok(seen.size >= 12, `CONTROL: only ${seen.size} distinct phases produced`);
  assert.ok([...seen].some((p) => p.endsWith('counter-trend vs the daily 200 SMA')), 'CONTROL: no counter-trend phase produced');
  assert.ok([...seen].some((p) => /^Daily (above|below) 200 SMA but/.test(p)), 'CONTROL: no daily-vs-ribbon phase produced');
  assert.deepEqual([...new Set(bad)], []);
});
test('E2. the selected-indicator downgrade phases in useEMAStrategy each map to a key whose English default is that exact sentence', () => {
  const src = read('lib/useEMAStrategy.ts'); const phases = [...src.matchAll(/phase\s*=\s*'([^']+)'/g)].map((m) => m[1]).filter((p) => p.startsWith('Selected '));
  assert.equal(phases.length, 8, `CONTROL: expected 8 downgrade sentences, found ${phases.length}`);
  for (const p of phases) assert.equal(render(p), p, `no translation (or a different English default) for: ${p}`);
  assert.equal(render('No clear setup'), 'No clear setup'); assert.equal(render('Loading…'), 'Loading…');
});
test('E3. an unknown phase falls back to null (English as written); the counter-trend flag is split off and translated on its own', () => {
  assert.equal(phaseI18n('A sentence the engine gained later'), null);
  const c = phaseI18n('In Value Zone - price pulled back to 20 EMA, entry eligible - counter-trend vs the daily 200 SMA');
  assert.deepEqual([c?.key, c?.counterSuffix], ['EMA_PHASE_VALUE_ZONE_LONG', true]);
  const d = phaseI18n('Daily above 200 SMA but 4h ribbon not bullish - wait for EMA alignment'); assert.deepEqual([d?.key, d?.params], ['EMA_PHASE_DAILY_ABOVE_RIBBON_NOT_BULL', { tf: '4h' }]);
  assert.equal(phaseI18n('In Value Zone - price pulled back to 20 EMA, entry eligible x'), null, 'a near-match must not translate (exact-match only)');
});
test('E4. the counter-trend row detail keys equal the engine sentence for above/below x long/short, and the card shows detailKey only on the warning row', () => {
  const src = read('lib/useEMAStrategy.ts');
  assert.ok(src.includes("Counter-trend: price is ${above200D ? 'above' : 'below'} the daily 200 SMA, so this ${judged.setupDir === 'short' ? 'short' : 'long'} is against the daily trend."), 'the engine detail template changed: the four keys must follow');
  for (const [k, side, dir] of [['EMA_DETAIL_CT_ABOVE_SHORT', 'above', 'short'], ['EMA_DETAIL_CT_ABOVE_LONG', 'above', 'long'], ['EMA_DETAIL_CT_BELOW_SHORT', 'below', 'short'], ['EMA_DETAIL_CT_BELOW_LONG', 'below', 'long']] as const)
    assert.equal(en[k], `Counter-trend: price is ${side} the daily 200 SMA, so this ${dir} is against the daily trend.`, k);
  assert.ok(read('components/EMASignal.tsx').includes('{warn ? (c.detailKey ? t(c.detailKey) : c.detail) : condLabel(c.label)}'), 'the card no longer shows the translated detail on the warning row');
});
