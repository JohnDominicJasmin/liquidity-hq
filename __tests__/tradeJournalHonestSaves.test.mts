/* #2427: the journal tells the truth about saves and numbers.
 *   J1  editing the exit price recomputes R, PnL and result with the SAME formulas closeTrade uses; a hand-typed PnL and a hand-changed result are kept; clearing the exit clears R
 *   J2  a failed close / edit / new trade keeps the form open and says so (data-testid journal-save-failed); only a confirmed write closes the form
 *   J3  the stats say which trades they cover when the 200-trade cap is reached
 *
 * J1 RUNS THE REAL CODE, not a copy of it: the saveEdit patch block and the closeTrade calculation are SLICED out of components/TradeJournal.tsx, type-stripped and executed. Two pieces of the shipped
 * source are then compared with each other, so there is no second implementation here that could agree with a wrong one. J2 and J3 are source anchors (the component has no DOM harness here); the rendered proof
 * is the browser cell qa/e2e/journal-honest-saves.spec.ts on a deployed build. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { stripTypeScriptTypes } from 'node:module';

const SRC = readFileSync(new URL('../components/TradeJournal.tsx', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const slice = (from: string, to: string, after = 0) => {
  const a = SRC.indexOf(from, after); assert.ok(a >= 0, `CONTROL: "${from.slice(0, 50)}" not found: the slicer lost its target`);
  const b = SRC.indexOf(to, a); assert.ok(b > a, `CONTROL: "${to.slice(0, 50)}" not found after it`);
  return SRC.slice(a, b);
};

/* the saveEdit calculation: from the exitNum line to the call that writes it */
const editBody = slice('const exitNum = editDraft.exit_price', 'setSaveFailed(false);\n    const { error: editErr }');
/* the closeTrade calculation: from `const dir` to the call that writes it */
const closeStart = SRC.indexOf('const closeTrade = async');
const closeBody = slice('const dir = trade.direction', 'setSaveFailed(false);\n    const { error: closeErr }', closeStart);

type Trade = { direction: 'LONG' | 'SHORT'; entry_price: number; stop_loss: number; exit_price: number | null; pnl_usd: number | null; result: string; position_size_usd: number | null };
type Draft = { exit_price: string; pnl_usd: string; result: string; notes: string };
/* The slices come from OUR OWN checked-in source file, never from input: this test reads the repository, so evaluating them is not an injection path. The wrapper is type-stripped whole so its types go too. */
const compile = (params: string, body: string, ret: string) => new Function(`return (${stripTypeScriptTypes(`function f(${params}) {\n${body}\nreturn ${ret};\n}`)});`)();
const editFn = compile('trade, editDraft', editBody, 'patch') as (t: Trade, d: Draft) => Record<string, unknown>;
const closeFn = compile('trade, exitNum', closeBody, '{ pnl_usd, pnl_r, result }') as (t: Trade, x: number) => { pnl_usd: number | null; pnl_r: number | null; result: string };

const LONG: Trade = { direction: 'LONG', entry_price: 100, stop_loss: 95, exit_price: 110, pnl_usd: 100, result: 'WIN', position_size_usd: 1000 };
const draft = (t: Trade, over: Partial<Draft> = {}): Draft => ({ exit_price: String(t.exit_price ?? ''), pnl_usd: String(t.pnl_usd ?? ''), result: t.result, notes: '', ...over });

test('J1a. editing the exit price gives EXACTLY what closing at that price would give (R, PnL and result), for LONG and SHORT, with and without a size', () => {
  const cases: { t: Trade; exit: number }[] = [
    { t: LONG, exit: 90 }, { t: LONG, exit: 120 }, { t: LONG, exit: 100 },
    { t: { ...LONG, direction: 'SHORT', stop_loss: 105, pnl_usd: -100, result: 'LOSS' }, exit: 90 },
    { t: { ...LONG, direction: 'SHORT', stop_loss: 105 }, exit: 112 },
    { t: { ...LONG, position_size_usd: null, pnl_usd: null }, exit: 90 },
    { t: { ...LONG, position_size_usd: null, pnl_usd: null }, exit: 100 },
  ];
  for (const { t, exit } of cases) {
    const patch = editFn(t, draft(t, { exit_price: String(exit) }));
    const closed = closeFn(t, exit);
    assert.equal(patch.exit_price, exit);
    assert.equal(patch.pnl_r, closed.pnl_r, `R after editing ${t.direction} to ${exit}`);
    assert.equal(patch.result, closed.result, `result after editing ${t.direction} to ${exit}`);
    if (t.position_size_usd) assert.equal(patch.pnl_usd, closed.pnl_usd, `PnL after editing ${t.direction} to ${exit}`);
  }
});
test('J1b. THE DEFECT: a winning LONG whose exit is edited below the entry becomes a LOSS with negative R and PnL (the stored values used to stay at the old exit)', () => {
  const patch = editFn(LONG, draft(LONG, { exit_price: '90' }));
  assert.equal(patch.result, 'LOSS'); assert.ok((patch.pnl_r as number) < 0, 'R did not follow the new exit'); assert.ok((patch.pnl_usd as number) < 0, 'PnL did not follow the new exit');
});
test('J1c. a PnL the user typed by hand is kept, and so is a result they changed by hand; R still follows the exit price', () => {
  let p = editFn(LONG, draft(LONG, { exit_price: '90', pnl_usd: '55' }));
  assert.equal(p.pnl_usd, 55, 'a hand-typed PnL was overwritten');
  p = editFn(LONG, draft(LONG, { exit_price: '90', result: 'BE' }));
  assert.equal(p.result, 'BE', 'a hand-changed result was overwritten'); assert.equal(p.pnl_r, -2, 'R must still follow the exit price');
});
test('J1d. an UNCHANGED exit price does not recompute anything (an edit of the notes alone leaves R and PnL as stored), and clearing the exit price clears R', () => {
  const p = editFn(LONG, draft(LONG, { notes: 'only a note' }));
  assert.equal('pnl_r' in p, false, 'an edit that did not touch the exit price recomputed R');
  assert.equal(p.pnl_usd, 100);
  const cleared = editFn(LONG, draft(LONG, { exit_price: '' }));
  assert.equal(cleared.pnl_r, null, 'clearing the exit price left an R behind'); assert.equal(cleared.exit_price, null);
});

test('J2. a failed close, edit and new trade each read the database error, keep the form open and show journal-save-failed; the three writes are the only ones that close it', () => {
  assert.ok(SRC.includes('const [saveFailed, setSaveFailed] = useState(false);'), 'CONTROL: the failure state is gone');
  assert.ok(SRC.includes('if (closeErr) { setSaveFailed(true); return; }'), 'closeTrade no longer keeps the form on an error');
  assert.ok(SRC.includes('if (editErr) { setSaveFailed(true); return; }'), 'saveEdit no longer keeps the form on an error');
  assert.ok(/if \(error\) setSaveFailed\(true\);\n\s+if \(!error\) \{/.test(SRC), 'saveTrade no longer reports the insert error / only clears on success');
  assert.ok(SRC.includes('data-testid="journal-save-failed"') && SRC.includes("t('TRADE_JOURNAL_NETWORK_ERROR')"), 'the failure line is not rendered');
  assert.ok(SRC.indexOf('if (closeErr)') < SRC.indexOf("setExitInput('')") || !SRC.includes("setExitInput('')"), 'the exit price is cleared before the error check');
  const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.ok(en.TRADE_JOURNAL_NETWORK_ERROR && en.TRADE_JOURNAL_NETWORK_ERROR.length > 5, 'the message key has no English text');
});
test('J3. the stats note shows at the cap only: JOURNAL_TRADES_LIMIT is the load limit AND the threshold, and the key has English text with the count', () => {
  assert.ok(SRC.includes('const JOURNAL_TRADES_LIMIT = 200;'), 'the cap constant changed');
  assert.ok(SRC.includes('.limit(JOURNAL_TRADES_LIMIT)'), 'the load no longer uses the constant (the note and the load would disagree)');
  assert.ok(SRC.includes('trades.length >= JOURNAL_TRADES_LIMIT && ('), 'the note is not tied to reaching the cap');
  assert.ok(SRC.includes('data-testid="journal-stats-capped"'), 'the note lost its test id');
  const en = JSON.parse(readFileSync(new URL('../lib/labelDefaults.en.json', import.meta.url), 'utf8')) as Record<string, string>;
  assert.match(en.TRADE_JOURNAL_STATS_NEWEST_NOTE ?? '', /\{n\}/, 'the note has no {n} for the count');
});
