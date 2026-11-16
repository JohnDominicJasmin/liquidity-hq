/* #2457: the AI prompts and the research/briefing copy DESCRIBE conditions; they do not forecast or tell the reader what to do (owner: veto any row of the OLD -> NEW table). Each rule is asserted as the new wording present AND the old wording absent.
 *   P1  the briefing prompt: describes the data, no forecast, no instruction; no "opinionated", "best setup", "what to do", "check news"; says what to do about a missing reading and an unavailable calendar; the data has no release results
 *   P2  the just-released event line no longer says "check news for actual print"
 *   P3  the macro prompt (lib/macroContext.ts, the #2457 macro anchor): no position sizing, no advice to increase/hold/reduce; it DESCRIBES conditions and past tendency, never a forecast
 *   P4  the thesis-check prompt: no recommendation section, no "hold, reduce or exit" ask, says there is no live data and to answer "cannot tell"; an OLDER stored check that still has a RECOMMENDATION section still parses
 *   L1  yen descriptions and the four correlation bands are statements: no imperative, no "rotate", "reduce leverage", "trade BTC or wait", "get BTC direction right"; the correlation description carries {avg}
 *   D1  the existing AiDisclaimer sits under Strategy Research, Pine, SMC Snapshot, Token Unlock (backtest page: 4) and Thesis Check, Shadow Account, Behavioral Bias (journal: 3); Pine shows the unverified note
 * WHAT IT CANNOT PROVE: what the model answers to the new prompts (no billed call). Copy-by-wording only: a reworded forecast that avoids the listed phrases would pass the absence cells. The positive cells keep the intent anchored. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel: string) => readFileSync(new URL(`../${rel}`, import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const en = JSON.parse(read('lib/labelDefaults.en.json')) as Record<string, string>;
const BRIEF = read('app/api/briefing/route.ts'), THESIS = read('app/api/thesis-check/route.ts'), MACRO = read('lib/macroContext.ts');
const none = (src: string, words: RegExp, what: string) => assert.equal(words.test(src), false, `${what}: still says ${words.exec(src)?.[0]}`);

test('P1. the briefing prompt describes the data: no forecast, no instruction, no "opinionated", "best setup", "what to do"', () => {
  assert.ok(BRIEF.includes('You describe the market conditions in the data provided. You do not forecast price and you do not tell the reader what to do.'), 'the describe-only opening changed');
  for (const need of ['Do not name a best setup, do not say what to buy, sell or avoid, and do not predict direction or price targets', 'The data has no results for data releases that just came out; do not state or guess them', 'If a reading is missing (shown as ? or N/A), say it is missing', 'if the data says the calendar is unavailable, or lists no events, say that']) assert.ok(BRIEF.includes(need), `the rule is gone: ${need}`);
  none(BRIEF, /opinionated|single best setup|what to do, what to avoid|solo retail|no hedging/i, 'the briefing prompt');
});
test('P2. a just-released event is no longer sent to the news for its result', () => {
  const bt = read('components/BriefingTerminal.tsx');
  assert.ok(bt.includes('the result is not in this data') || BRIEF.includes('the result is not in this data'), 'the replacement wording is gone');
  none(bt + BRIEF, /check news for actual print/, 'the released-event line');
});
test('P3. THE #2457 MACRO ANCHOR: the macro prompt describes conditions and past tendency; it does not ask for position sizing or tell the reader to increase, hold or reduce', () => {
  assert.ok(MACRO.includes('DESCRIBE conditions; never tell the reader what to do with positions.'), 'the describe-only instruction is gone');
  assert.ok(MACRO.includes('stated as a past tendency and not as a forecast'), 'the past-tendency framing is gone');
  assert.ok(MACRO.includes('Do NOT advise increasing, holding or reducing exposure or position size, and do not tell the reader to buy, sell or wait.'), 'the no-advice rule is gone');
  none(MACRO, /Position sizing implication|Expected BTC behavior in this macro regime/, 'the macro prompt');
});
test('P4. the thesis-check prompt has no recommendation ask and says there is no live data; an older stored RECOMMENDATION section still parses', () => {
  assert.ok(THESIS.includes('You have no live price or market data here.') && THESIS.includes('say "cannot tell" where you cannot judge an assumption without current data. Do not tell the trader to hold, reduce or exit.'), 'the no-live-data / cannot-tell rule is gone');
  none(THESIS, /RECOMMENDATION:|Should the trader hold, reduce exposure, or exit|Using your current knowledge/, 'the thesis prompt');
  const tj = read('components/TradeJournal.tsx');
  const sections = /THESIS_CHECK_SECTIONS[^=]*=\s*\[([\s\S]*?)\n\];/.exec(tj)?.[1] ?? '';
  assert.ok(sections.length > 20, 'CONTROL: the thesis sections list was not found');
  assert.equal(sections.includes("'RECOMMENDATION'"), false, 'the result still shows a RECOMMENDATION section');
  assert.ok(tj.includes("'RECOMMENDATION"), 'an older stored check with a RECOMMENDATION section no longer parses (its text would run into the previous section)');
});
test('L1. yen descriptions and the correlation bands are statements: no imperatives or advice; the correlation text carries the average', () => {
  const adv = /reduce leverage|rotate|trade BTC or wait|get BTC direction right|selective alt plays|watch for boj|can trigger btc liquidations|no independent alt edge/i;
  for (const k of ['BRIEFING_YEN_DANGER_DESC', 'BRIEFING_YEN_WARNING_DESC', 'BRIEFING_YEN_SAFE_DESC']) { assert.ok(en[k], `${k} has no text`); assert.doesNotMatch(en[k], adv, `${k}: ${en[k]}`); assert.match(en[k], /USD\/JPY/); }
  for (const b of ['ALT_SEASON', 'MIXED', 'BTC_LEADING', 'LOCKSTEP']) {
    const d = en[`CORRELATION_ALT_SIG_${b}_DESC`], l = en[`CORRELATION_ALT_SIG_${b}_LABEL`];
    assert.match(d, /\{avg\}/, `${b}: no {avg}`); assert.doesNotMatch(d + ' ' + l, adv, `${b}: ${l} / ${d}`);
    assert.doesNotMatch(l, /season|lockstep|leading/i, `${b}: the label still names a regime the data cannot back: ${l}`);
  }
  assert.equal(en.BRIEFING_YEN_SAFE_DESC, 'USD/JPY is below 158.');
});
test('D1. the existing disclaimer sits under the seven AI tool results (backtest page 4, journal 3) and Pine shows the unverified note', () => {
  const bp = read('app/(main)/backtest/page.tsx');
  assert.equal((bp.match(/<AiDisclaimer/g) ?? []).length, 4, 'one of Strategy Research / Pine / SMC Snapshot / Token Unlock lost its disclaimer (or gained a stray one)');
  assert.equal((read('components/TradeJournal.tsx').match(/<AiDisclaimer/g) ?? []).length, 3, 'one of Thesis Check / Shadow Account / Behavioral Bias lost its disclaimer');
  assert.ok(bp.includes("t('BACKTEST_PINE_UNVERIFIED_NOTE')") && /Unverified AI-generated script\./.test(en.BACKTEST_PINE_UNVERIFIED_NOTE), 'the Pine unverified note is gone');
  assert.ok(read('components/AiDisclaimer.tsx').length > 50, 'CONTROL: the disclaimer component moved');
});
