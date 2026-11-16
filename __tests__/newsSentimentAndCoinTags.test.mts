/* #2448: the news page's sentiment badge and coin tags read context, not just keywords; a tab left open drops stale alerts.
 *   B1-B5  getBtcSentiment, the REAL function SLICED out of app/(main)/news/page.tsx (its keyword lists and regexes with it) and run: the false reads are gone, the true ones stay
 *   C1-C3  lib/classify.getCoinsInHeadline, REAL code: ordinary words no longer tag coins; a crypto context word or the exact upper-case ticker still does
 *   A1     NewsProvider drops alerts older than 6 hours every 5 minutes (source anchors; it is an effect in a provider)
 * Both directions are asserted everywhere: a fix that stopped reading real news would pass the false-read cells alone.
 * The slice is OUR OWN checked-in source, never input. WHAT IT CANNOT PROVE: the badge rendering or the page's Coin Buzz totals. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import * as nodeModule from 'node:module';
import { getCoinsInHeadline } from '../lib/classify.ts';

/* Cast rather than a named import: stripTypeScriptTypes is experimental and this repo's @types/node does not declare it (TS2305), though it exists at runtime (same pattern as libStrippable.test.mts). */
const stripTypeScriptTypes = (nodeModule as unknown as { stripTypeScriptTypes: (source: string) => string }).stripTypeScriptTypes;
const PAGE = readFileSync(new URL('../app/(main)/news/page.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const a = PAGE.indexOf('type BtcSentiment ='); assert.ok(a > 0, 'CONTROL: the sentiment helpers were not found');
const fnStart = PAGE.indexOf('function getBtcSentiment(', a); assert.ok(fnStart > a, 'CONTROL: getBtcSentiment not found');
const end = PAGE.indexOf('\n}\n', fnStart) + 3;
const code = PAGE.slice(a, end);
const sentiment = new Function(`return (() => {\n${stripTypeScriptTypes(`${code}\nexport {};`).replace(/export \{\};?/, '')}\nreturn getBtcSentiment;\n})();`)() as (h: string) => 'bullish' | 'bearish' | 'neutral';

test('B1. THE DEFECT: a negated approval or launch reads Bearish ("ETF not approved"), and an approval still reads Bullish', () => {
  for (const h of ['ETF not approved', 'SEC denied the ETF approval', 'Regulator rejects spot launch', 'Firm delays launch of the fund', 'Exchange blocks the launch of the token', 'Fund postponed its ETF approval', 'Listing goes ahead without approval']) assert.equal(sentiment(h), 'bearish', `"${h}"`);
  for (const h of ['SEC approved the ETF', 'ETF approval expected to boost adoption', 'Fund announces launch of new ETF']) assert.equal(sentiment(h), 'bullish', `"${h}" lost its bullish read`);
});
test('B2. a lawsuit / charges / case / probe that is DROPPED, dismissed, ended, settled or won is not bearish; a live one still is', () => {
  for (const h of ['SEC drops lawsuit against Coinbase', 'Judge dismisses charges against founder', 'Exchange settles the case', 'Regulators end investigation into the fund', 'Firm wins lawsuit over listing']) assert.equal(sentiment(h), 'neutral', `"${h}" reads ${sentiment(h)}`);
  for (const h of ['SEC files lawsuit against exchange', 'Founder faces fraud charges', 'Hack and lawsuit hit the exchange']) assert.equal(sentiment(h), 'bearish', `"${h}" lost its bearish read`);
});
test('B3. "record" is only bullish as record high / record inflow / record buy: "record outflows" is neutral', () => {
  assert.equal(sentiment('Fund sees record outflows'), 'neutral'); assert.equal(sentiment('Bitcoin hits a record high'), 'bullish'); assert.equal(sentiment('ETFs log record inflows'), 'bullish'); assert.equal(sentiment('Whale makes a record buy'), 'bullish');
});
test('B4. "risk" alone is not bearish ("risk-on rally" is bullish), risk-off still is; "fall" is a whole word ("fallout" is neutral, "prices fall" is bearish)', () => {
  assert.equal(sentiment('Markets enter a risk-on rally'), 'bullish'); assert.equal(sentiment('Traders go risk-off'), 'bearish');
  assert.equal(sentiment('Fallout from the vote'), 'neutral'); assert.equal(sentiment('Prices fall sharply'), 'bearish'); assert.equal(sentiment('Bitcoin fell overnight'), 'bearish');
});
test('B5. the unchanged basics: crash / hack are bearish, rally / surge are bullish, no keyword is neutral', () => {
  assert.equal(sentiment('Exchange hack drains funds'), 'bearish'); assert.equal(sentiment('Market crash deepens'), 'bearish');
  assert.equal(sentiment('Bitcoin rally extends'), 'bullish'); assert.equal(sentiment('Weekly recap of the committee'), 'neutral');
});

test('C1. THE DEFECT: ordinary words no longer tag coins (yield curve, optimism about rates, regulatory sandbox, jupiter, render, stacks, tron, stellar, cosmos, rune)', () => {
  const cases: [string, string][] = [['Yield curve inverts as rates hold', 'CRV'], ['Optimism about rates grows', 'OP'], ['A regulatory sandbox opens for banks', 'SAND'], ['Jupiter probe sends new photos', 'JUP'], ['Studio will render the film', 'RENDER'], ['Home builder stacks inventory', 'STX'], ['Stellar earnings beat estimates', 'XLM'], ['Cosmos of retail investors', 'ATOM'], ['Tron of the market', 'TRX']];
  for (const [h, sym] of cases) assert.equal(getCoinsInHeadline(h).includes(sym), false, `"${h}" tagged ${sym}: ${getCoinsInHeadline(h).join(',')}`);
});
test('C2. with a crypto context word the coin IS tagged (Curve DAO token in a DeFi rally -> CRV)', () => {
  assert.ok(getCoinsInHeadline('Curve DAO token jumps in DeFi rally').includes('CRV'), 'a real Curve headline lost its tag');
  assert.ok(getCoinsInHeadline('Optimism layer 2 sees record on-chain activity').includes('OP'));
});
test('C3. the exact upper-case ticker still tags without a context word, and unambiguous coins are untouched', () => {
  assert.ok(getCoinsInHeadline('XLM surges 20%').includes('XLM')); assert.ok(getCoinsInHeadline('TRX volume spikes').includes('TRX'));
  assert.ok(getCoinsInHeadline('Bitcoin and Ethereum slide').includes('BTC')); assert.ok(getCoinsInHeadline('Bitcoin and Ethereum slide').includes('ETH'));
});

const NP = readFileSync(new URL('../components/NewsProvider.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n').replace(/\/\*[\s\S]*?\*\//g, '');
test('A1. NewsProvider trims alerts older than 6 hours every 5 minutes, only re-rendering when something is stale, and cleans its timer', () => {
  assert.ok(NP.includes('const cutoff = Math.floor(Date.now() / 1000) - 6 * 3600;'), 'the 6 hour cutoff changed');
  assert.ok(NP.includes('setAlerts(prev => (prev.some(a => a.ts < cutoff) ? prev.filter(a => a.ts >= cutoff) : prev));'), 'the trim is not guarded or filters the wrong way (a new array on every tick re-renders the whole news tree)');
  assert.ok(NP.includes('}, 5 * 60_000);') && NP.includes('return () => clearInterval(id);'), 'the 5 minute interval or its cleanup changed');
});

/* #2448 follow-up (f8e7db35, found by QA): the negation rule also reads a negation AFTER the approval / launch word. Both directions: the passive negations are Bearish and real approvals stay Bullish. */
test('B6. passive negations (a negation AFTER the word) read Bearish: Launch delayed again / ETF approval denied / ETF launch postponed / approval withheld / launch cancelled', () => {
  for (const h of ['Launch delayed again', 'ETF approval denied', 'ETF launch postponed', 'SEC approval withheld for the fund', 'Token launch cancelled', 'Fund launch is suspended pending review', 'Approval halted by the regulator']) assert.equal(sentiment(h), 'bearish', `"${h}" reads ${sentiment(h)}`);
});
test('B7. and a real approval or launch is still Bullish even when other words sit nearby (approved after delays, launch of the fund approved, ETF launch goes ahead)', () => {
  for (const h of ['ETF approved after delays', 'Launch of the new fund approved by the SEC', 'ETF launch goes ahead as planned', 'Approval granted for the spot fund', 'Launch approved by the SEC']) assert.equal(sentiment(h), 'bullish', `"${h}" lost its bullish read: ${sentiment(h)}`);
});
