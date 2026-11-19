import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { signedUsd } from '../lib/numberFormat.ts';

/* #2630 (#1651 L117) THE BRIEFING'S BTC ETF FLOW IS NEVER SHOWN, OR SENT TO THE AI, WITHOUT THE DAY IT BELONGS TO. Rule from the PR text: the card needs BOTH the figure and its date (the figure and the dated days parse separately, so the figure can be set with the date absent);
 * a dated figure still reads "Latest: <day>" beside it; the AI briefing line says N/A unless the dated row is known. The two expressions are sliced out of components/BriefingTerminal.tsx and RUN on a table; the source is read, not imported (a client component).
 *   E1 the card's condition   E2 the AI line   E3 the "Latest: <day>" label stays beside the figure   E4 the Ask-AI chat path (outside this PR: recorded so it is a known gap, not a surprise) */
const src = readFileSync(new URL('../components/BriefingTerminal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const lines = src.split('\n');
const only = (pred: (l: string) => boolean, what: string) => { const hits = lines.filter(pred); assert.equal(hits.length, 1, `CONTROL: expected exactly one ${what}, found ${hits.length}`); return hits[0].trim(); };

const condLine = only((l) => /^\s*\{etfFlow != null &&/.test(l) && l.trimEnd().endsWith('&& ('), 'ETF card condition line');
const cond = condLine.slice(1, condLine.lastIndexOf(' && ('));
const showCard = new Function('etfFlow', 'etfDate', `return Boolean(${cond});`) as (f: number | null, d: string | null) => boolean;

const aiLine = only((l) => l.trim().startsWith('`BTC ETF Flow (latest settled US session'), 'AI prompt line').replace(/,$/, '');
const aiText = new Function('store', 'signedUsd', `return ${aiLine};`) as (s: { etfNetFlow: number | null; etfFlowDays?: Array<{ date?: string }> | null }, f: typeof signedUsd) => string;

test('E1. the card shows only with BOTH the figure and its date (0 is a figure)', () => {
  assert.equal(showCard(123, '2026-11-13'), true); assert.equal(showCard(-45.6, '2026-11-13'), true); assert.equal(showCard(0, '2026-11-13'), true, 'a flow of exactly 0 is a figure, not a missing one');
  assert.equal(showCard(123, null), false, 'an UNDATED figure must not be drawn'); assert.equal(showCard(null, '2026-11-13'), false, 'a date with no figure draws nothing'); assert.equal(showCard(null, null), false);
});
test('E2. the AI briefing line: the figure only with the dated row; N/A otherwise; the date is named when known', () => {
  const dated = aiText({ etfNetFlow: 123, etfFlowDays: [{ date: '2026-11-13' }] }, signedUsd); assert.equal(dated, `BTC ETF Flow (latest settled US session 2026-11-13): ${signedUsd(123, 'M', 0)}`); assert.ok(/\+\$123M/.test(dated), dated);
  for (const [name, s] of [['no days at all', { etfNetFlow: 123, etfFlowDays: null }], ['empty days', { etfNetFlow: 123, etfFlowDays: [] }], ['a row without a date', { etfNetFlow: 123, etfFlowDays: [{}] }], ['undefined days', { etfNetFlow: 123 }]] as const) {
    const out = aiText(s as never, signedUsd); assert.ok(out.endsWith(': N/A'), `${name}: an undated figure reached the AI line: ${out}`); assert.ok(!/\$123/.test(out), `${name}: the figure leaked: ${out}`);
  }
  assert.ok(aiText({ etfNetFlow: null, etfFlowDays: [{ date: '2026-11-13' }] }, signedUsd).endsWith(': N/A'), 'no figure is N/A even with a date');
  assert.ok(aiText({ etfNetFlow: 0, etfFlowDays: [{ date: '2026-11-13' }] }, signedUsd).includes(signedUsd(0, 'M', 0)), 'a flow of 0 is a figure');
});
test('E3. a dated figure still reads "Latest: <day>" beside the label, built from the date, through BRIEFING_ETF_LATEST', () => {
  const label = only((l) => l.includes("t('BRIEFING_ETF_LATEST'"), 'latest label line'); assert.ok(/etfDate \? ` · \$\{t\('BRIEFING_ETF_LATEST', \{ date: fmtEtfDate\(etfDate\) \}\)\}` : ''/.test(label), label);
  const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>; assert.equal(en.BRIEFING_ETF_LATEST, 'Latest: {date}');
  const fmt = src.slice(src.indexOf('const fmtEtfDate'), src.indexOf('const etfColor')); assert.ok(/timeZone: 'UTC'/.test(fmt), 'the day is formatted in UTC (a day label must not shift with the reader\'s zone)');
});
test('E4. KNOWN GAP, recorded (not part of #2630): the Ask-AI chat sends the same ETF figure undated', () => {
  const chat = readFileSync(new URL('../lib/chatPrompt.ts', import.meta.url), 'utf8'); const l = chat.split('\n').find((x) => x.includes("ln('BTC ETF flow'")) ?? '';
  assert.ok(l.length > 0, 'CONTROL: the chat prompt line moved'); assert.equal(/date|asOf|latest/i.test(l), false, 'if this fails the chat line now carries a date: delete this cell and pin the dated form instead');
});
