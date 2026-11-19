/* ARENA INDICATORS, re-check of the cells whose first verdict was an INSTRUMENT limit (not an app result), with the corrected instrument:
 *   GEX: a dim 1 px line dashed 2 on / 4 off was missed by a 3 px-wide, 60-level colour-diff window (the line IS drawn: qa/.shots/ind-btc-1d-1280.png shows "MAX PAIN $73,000"); the window is now 7 px wide, threshold 25
 *   MACD / VOL at 390 (45 px panes): the control 9-10 px off the line lands on the histogram / volume-average lines, so the rule is now "ink at the oracle pixel at least 30 points more often than at the control"
 *   S/R: the oracle is evaluated around the price (the app computes S/R once at load, from that moment's close)
 * Same cells otherwise: see _indcell.ts. */
import { test, expect } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { runCell, report } from './_indcell';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const CELLS: Array<[string, string, number]> = [['link', '1h', 390], ['pepe', '15m', 390], ['aapl', '1h', 390], ['aapl', '4h', 1280], ['aapl', '4h', 390], ['pepe', '1d', 1280], ['link', '15m', 390], ['aapl', '1d', 1280], ['btc', '15m', 390], ['eth', '1h', 390], ['link', '1h', 1280]];
for (const [coin, tf, w] of CELLS) test(`IND fix2 ${coin} ${tf} ${w}`, async ({ browser }) => {
  test.setTimeout(300_000);
  const rows = await runCell(browser, coin, tf, w, { shots: false });
  const fails = report(rows);
  console.log(`[IND-CELL] ${coin} ${tf} ${w}: ${fails.length ? 'FINDINGS ' + fails.length : 'clean'} | ${fails.join(' ;; ')}`);
  expect(rows.filter((r) => r.ind === 'CHART'), 'the chart handle was not found').toEqual([]);
});
