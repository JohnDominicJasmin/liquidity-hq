/* #2452: the setup / funding / squeeze copy states a FACT about positioning instead of predicting or instructing (PM-approved OLD -> NEW table, owner may veto any row). Checked by wording on the shipped English defaults, and on the code
 * that carries the same words outside the label table. Each rule is the new wording present AND the old wording absent; the product names "Squeeze Scanner" / "squeeze score" stay.
 *   W1   no setup / funding / signal label (DASH_SIDEBAR_SIG_*, MARKETS_SIGNAL_*, COIN_MARKET_SNAPSHOT_*, SETUP_WORD_*, DASH_EDGE_SETUP_*, SETUP_SCANNER_*, FUNDING_SIG_*) contains a prediction or an instruction (dump, pump, ripe, whales, go long/short, avoid, reduce, likely, consider, overleveraged, liquidation risk, squeeze setup)
 *   W2   rows 1-3: the sidebar / Markets signals carry the funding figure ({pct}) and say who pays; the coin snapshot says who pays whom
 *   W3   row 4: the setup words and card are Long-heavy / Short-heavy; the card has the funding and share detail keys with their placeholders
 *   W4   row 5-7: the tip says it describes positioning and the taker window is 2 hours; the scanner legend and multi-timeframe legend state facts
 *   W5   row 8 (REAL classifyFunding): the notes state who is paying, with no direction call ("Go SHORT", "whales", "bullish bias")
 *   W6   row 9/f: the funding page tiers are funding-band facts with the numeric band in the label and the action line
 *   W7   row 10/d/e (Telegram): squeeze alert titles read "<side>-heavy positioning - Score N/100"; the sentiment and Fear & Greed alerts have no Action line and no "tighten stops" / "reducing position size"; the RSI and CVD alerts keep theirs (a different alert class, stated in the PR)
 *   W8   the Market Read KEEPS its own "Longs overcrowded" wording on its own key (it shared the sidebar key, which now carries {pct})
 *   W9   row a: the landing hero setup words (all five languages) are the new wording and the old "Short squeeze ↑" / "Long liquidation risk ↓" are gone from the dictionaries
 *   W10  rows b, c: the landing scanner description has no "high-conviction"; the AI prompt line says it describes positioning and is not a forecast
 * The migration (en/ko/zh/ru rows, placeholders, PROD = DEV, keys registered) is covered by labelMigrationsHeld.test.mts. WHAT IT CANNOT PROVE: ko/zh/ru/ar wording quality (AI-drafted, not native-reviewed), or the rendering. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { classifyFunding } from '../lib/marketStore.ts';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const GROUPS = /^(DASH_SIDEBAR_SIG_|MARKETS_SIGNAL_|COIN_MARKET_SNAPSHOT_FR_|SETUP_WORD_|DASH_EDGE_SETUP_|SETUP_SCANNER_|FUNDING_SIG_)/;
const PREDICT = /\b(dump|dumps|pump|pumps|ripe|whales?|go (long|short)|avoid|reduce|likely|consider|overleveraged|liquidation risk|squeeze setup|flush)\b/i;

test('W1. no setup / funding / signal label predicts or instructs (the old texts said dump, pump, ripe, whales, Go SHORT, Avoid new longs, Reduce long exposure)', () => {
  const keys = Object.keys(en).filter((k) => GROUPS.test(k)); assert.ok(keys.length > 80, `CONTROL: only ${keys.length} keys matched the groups`);
  const bad = keys.filter((k) => PREDICT.test(en[k])).map((k) => `${k}: ${en[k]}`);
  assert.deepEqual(bad, [], 'a label still predicts or instructs');
  const overcrowded = keys.filter((k) => /overcrowded|squeezed/i.test(en[k])).map((k) => `${k}: ${en[k]}`);
  assert.deepEqual(overcrowded, [], 'a label outside the short "crowd" tags still says overcrowded / squeezed');
});
test('W2. sidebar and Markets signals carry the funding figure and say who pays; the coin snapshot says who pays whom', () => {
  assert.equal(en.DASH_SIDEBAR_SIG_LONGS_OVERCROWDED, 'Funding {pct}: longs paying'); assert.equal(en.DASH_SIDEBAR_SIG_SHORTS_SQUEEZED, 'Funding {pct}: shorts paying');
  assert.equal(en.MARKETS_SIGNAL_LONGS_OVERCROWDED, 'Funding {pct}: longs paying'); assert.equal(en.MARKETS_SIGNAL_SHORTS_SQUEEZED, 'Funding {pct}: shorts paying');
  assert.equal(en.COIN_MARKET_SNAPSHOT_FR_LONGS_OVERCROWDED, 'Longs paying shorts'); assert.equal(en.COIN_MARKET_SNAPSHOT_FR_SHORTS_OVERCROWDED, 'Shorts paying longs');
  const dash = read('components/DashboardTerminal.tsx'), mk = read('components/MarketsTerminal.tsx');
  assert.ok(/DASH_SIDEBAR_SIG_LONGS_OVERCROWDED'[^)]*pct/.test(dash) && /DASH_SIDEBAR_SIG_SHORTS_SQUEEZED'[^)]*pct/.test(dash), 'the sidebar does not pass the funding figure to its signal');
  assert.ok(/MARKETS_SIGNAL_LONGS_OVERCROWDED[^)]*pct|key: 'MARKETS_SIGNAL_LONGS_OVERCROWDED'/.test(mk), 'Markets lost its signal key');
});
test('W3. the setup words and card are Long-heavy / Short-heavy with the funding and share detail', () => {
  assert.equal(en.DASH_EDGE_SETUP_SHORT_SQ, '▲ Short-heavy'); assert.equal(en.DASH_EDGE_SETUP_LONG_LIQ, '▼ Long-heavy');
  assert.equal(en.DASH_EDGE_SETUP_DETAIL_FUNDING, 'Funding {pct}'); assert.equal(en.DASH_EDGE_SETUP_DETAIL_LONG_SHARE, 'long share {pct}% ({venue}, accounts, 1h)'); assert.equal(en.DASH_EDGE_SETUP_DETAIL_SHORT_SHARE, 'short share {pct}% ({venue}, accounts, 1h)');   /* #2521: the share names its venue, population and window */
  assert.equal(en.SETUP_WORD_FLUSH, 'Long-heavy'); assert.equal(en.SETUP_WORD_SQUEEZE, 'Short-heavy');
  assert.ok(read('components/DashboardTerminal.tsx').includes('DASH_EDGE_SETUP_DETAIL_FUNDING'), 'the card does not show its detail line');
});
test('W4. the tip says it describes positioning and names the 2-hour taker window; the scanner and multi-timeframe legends state facts', () => {
  assert.match(en.DASH_EDGE_SETUP_TIP, /2 hours/); assert.match(en.DASH_EDGE_SETUP_TIP, /taker/i);
  const legend = Object.keys(en).filter((k) => /^SETUP_SCANNER_LEGEND_/.test(k)).map((k) => en[k]).join(' | '); assert.ok(legend.length > 80, 'CONTROL: no scanner legend keys');
  assert.match(legend, /Long-heavy/); assert.match(legend, /Short-heavy/); assert.match(legend, /2 h/);
  const all = Object.entries(en).filter(([k]) => k !== 'ARENA_SCANNER_FOOTER_EXPLAINER').map(([, v]) => v).join('\n');
  assert.equal(/↑ Squeeze = shorts overcrowded|↓ Flush = longs overcrowded|bounce likely|drop likely|Whales incentivised/i.test(all), false, 'an old multi-timeframe or scanner legend text is still shipped');
});
/* #2452 leftovers, decided by PM and folded in by Dev (d3201a3f): found by QA, now real pins. */
test('W4b. the Arena scanner footer states the two sides as positioning: "Funding rate + long/short ratio · ↑ Short-heavy · ↓ Long-heavy"', () => {
  assert.equal(en.ARENA_SCANNER_FOOTER_EXPLAINER, 'Funding rate + long/short ratio · ↑ Short-heavy · ↓ Long-heavy');
  assert.doesNotMatch(en.ARENA_SCANNER_FOOTER_EXPLAINER, /Squeeze|Flush|overcrowded/);
});
test('W1b. the coin snapshot OI sub-label states the flow, not a prediction: "OI up, price down · new shorts opening"', () => {
  assert.equal(en.COIN_MARKET_SNAPSHOT_OI_STRONG_DOWN_SUB, 'OI up, price down · new shorts opening'); assert.doesNotMatch(en.COIN_MARKET_SNAPSHOT_OI_STRONG_DOWN_SUB, /dump/i);
});
test('W6b. the funding page\'s two extreme short tags say who pays, like the rest of the page ("Longs paying" / "Shorts paying"); the milder tags are unchanged', () => {
  assert.equal(en.FUNDING_SIG_LONGS_OVERCROWDED_CROWD, 'Longs paying heavily'); assert.equal(en.FUNDING_SIG_SHORTS_OVERCROWDED_CROWD, 'Shorts paying heavily');
  for (const k of Object.keys(en).filter((x) => /^FUNDING_SIG_.*_CROWD$/.test(x))) assert.doesNotMatch(en[k], /overcrowded/i, `${k}: ${en[k]}`);
});
test('W5. REAL classifyFunding: the notes state who is paying, with no direction call', () => {
  const notes = [0.001, 0.0002, -0.0005, -0.0001, 0].map((r) => classifyFunding(r).note);
  assert.deepEqual(notes, ['Longs are paying shorts at a high rate.', 'Longs are paying shorts.', 'Shorts are paying longs at a high rate.', 'Shorts are paying longs.', 'Funding is near zero: neither side is paying a premium.']);
  for (const n of notes) assert.doesNotMatch(n, /whales?|go (long|short)|bullish|bearish|trade with caution|dump|squeeze up|overleveraged/i, n);
});
test('W6. the funding page tiers are band facts: the label carries the numeric band, the action line says the band per 8 hours', () => {
  assert.equal(en.FUNDING_SIG_LONGS_OVERCROWDED_LABEL, 'Longs paying - funding +0.05% or more'); assert.equal(en.FUNDING_SIG_SHORTS_OVERCROWDED_LABEL, 'Shorts paying - funding -0.03% or less');
  assert.equal(en.FUNDING_SIG_BALANCED_LABEL, 'Neutral - funding near zero'); assert.equal(en.FUNDING_SIG_LONGS_HEAVY_LABEL, 'Longs paying - funding +0.02% to +0.05%'); assert.equal(en.FUNDING_SIG_SHORTS_CROWDED_LABEL, 'Shorts paying - funding -0.01% to -0.03%');
  for (const t of ['LONGS_OVERCROWDED', 'LONGS_HEAVY', 'LONGS_DOMINANT', 'SLIGHT_LONG', 'BALANCED', 'SHORTS_DOMINANT', 'SHORTS_CROWDED', 'SHORTS_OVERCROWDED']) {
    assert.match(en[`FUNDING_SIG_${t}_ACTION`], /^Funding (is|between)/, `${t}: the action line is not a band fact: ${en[`FUNDING_SIG_${t}_ACTION`]}`);
    assert.match(en[`FUNDING_SIG_${t}_HINT`], /paying|Near|baseline|zero/i, `${t}: hint ${en[`FUNDING_SIG_${t}_HINT`]}`);
  }
});
test('W7. Telegram: squeeze alert titles state positioning; sentiment and Fear & Greed alerts have no Action line, tighten-stops or reduce-position advice; the RSI and CVD alerts keep their own Action lines', () => {
  const s = read('app/api/telegram/alert/route.ts').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');   // comments are not sent to anyone
  assert.match(s, /Short-heavy positioning - Score/); assert.match(s, /Long-heavy positioning - Score/); assert.match(s, /longs paying shorts/);
  assert.equal(/Short Squeeze Building|Long Flush Building|Longs overcrowded|price likely (dumps|pumps)|Tighten stops on longs|Consider tightening stops|reducing position size|long flush risk elevated|contrarian reversal zone/i.test(s), false, 'an old squeeze / sentiment alert wording is still sent');
  assert.ok(/Positioning is long-heavy\./.test(s) && /Positioning is short-heavy\./.test(s), 'the new positioning lines are gone');
  assert.ok((s.match(/Action:/g) ?? []).length >= 2, 'the RSI / CVD alerts lost their Action lines (the PR leaves them untouched)');
});
test('W8. the Market Read keeps its own "Longs overcrowded" wording on its own key', () => {
  assert.equal(en.MARKET_READ_TXT_LONGS_OVERCROWDED, 'Longs overcrowded'); assert.ok(read('lib/marketReadText.ts').includes('MARKET_READ_TXT_LONGS_OVERCROWDED'), 'the Market Read still reads the sidebar key (it would now print "Funding {pct}: longs paying" with no figure)');
});
test('W9. the landing hero setup words are the new wording in every shipped language and the old ones are gone from the dictionaries', () => {
  const d = read('lib/i18n/dictionaries.ts');
  assert.equal(/Short squeeze ↑|Long liquidation risk ↓/.test(d), false, 'an old landing setup word is still in the dictionaries');
  for (const w of ['Short-heavy', 'Long-heavy', '숏 우세', '롱 우세', '空头偏重', '多头偏重', 'Перекос в шорты', 'Перекос в лонги', 'غلبة مراكز البيع', 'غلبة مراكز الشراء']) assert.ok(d.includes(w), `the landing dictionaries lost: ${w}`);
});
test('W10. the landing scanner description has no "high-conviction", and the AI prompt line describes positioning and is not a forecast', () => {
  const all = Object.values(en).join('\n') + read('lib/i18n/dictionaries.ts'); assert.equal(/high-conviction squeeze setup/i.test(all), false, 'the landing scanner description still promises a high-conviction setup');
  assert.ok(/line up/.test(all), 'the new landing scanner description is gone');
  const g = read('lib/grok.ts'); assert.ok(g.includes('It describes positioning; it is not a forecast.'), 'the AI prompt line lost its not-a-forecast statement'); assert.equal(/whales incentivised|High Long Liq Risk/i.test(g), false, 'the old scanner prompt line is back');
});
