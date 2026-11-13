/* #2248 (#1631): a DEEP read that gave levels but cites no catalysts says "No catalysts cited in this read.".
 * Fixture A (Pro), signed in by session injection; every AI and candle call is stubbed (installPaidAiFence refuses any other paid path), nothing is billed.
 *   K1  DEEP, 3 levels, catalysts []        -> the line shows
 *   K2  DEEP, 3 levels, 2 catalysts         -> the bullets show, no line
 *   K3  QUICK, 3 levels, catalysts []       -> no line
 *   K4  DEEP, no levels, catalysts []       -> no line
 * The card must be on screen for the cell to mean anything: each cell first waits for .arena-signal-card. */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const LINE = /No catalysts cited in this read\./;
const levels3 = [{ price: 68000, label: 'Support', type: 'support' }, { price: 70500, label: 'Resistance', type: 'resistance' }, { price: 66000, label: 'Support 2', type: 'support' }];

async function arrange(page: Page, answer: { levels: unknown[]; catalysts: string[] }) {
  await installPaidAiFence(page);
  await page.route('**/api/grok', async route => {
    if (route.request().method() !== 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: null }) });
    const asked = route.request().postDataJSON() as { tf?: string; session?: string };
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
      usage: { quick_used: 1, quick_limit: 50, deep_used: 1, deep_limit: 20 },
      result: { signal: 'FLAT', confidence: 60, entryLow: null, entryHigh: null, tp: null, sl: null, levels: answer.levels, chartAnalysis: 'fixture chart', patterns: [], reasoning: 'fixture reasoning', catalysts: answer.catalysts, waitFor: null, bias: 'NEUTRAL', raidSetup: null, raidTarget: null, raidTrigger: null, analyzedAt: Date.now(), tf: asked.tf ?? '15m', session: asked.session ?? 'London' },
    }) });
  });
  await page.route('**/api/grok-chat', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: 'stub', followUps: [], citations: [], _usage: null }) }));
  const fakeCandle = (i: number) => [Date.now() - (300 - i) * 60_000, 100, 101, 99, 100.5, 10];
  await page.route('**/api/market/klines**', route => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: 300 }, (_, i) => fakeCandle(i))) }));
}
async function run(browser: import('@playwright/test').Browser, mode: 'QUICK' | 'DEEP', answer: { levels: unknown[]; catalysts: string[] }) {
  const ctx = await signedInContext(browser, 'a'); const page = await ctx.newPage();
  await arrange(page, answer);
  await gotoSignedIn(page, '/arena');
  const btn = page.getByRole('button', { name: mode, exact: true }); await expect(btn).toBeVisible({ timeout: 20_000 }); await btn.click();
  await expect(page.locator('.arena-signal-card'), 'the signal card never rendered from the stubbed read: nothing measured').toBeVisible({ timeout: 30_000 });
  await page.waitForTimeout(1500);
  return { ctx, text: (await page.locator('.arena-signal-card').innerText()).replace(/\s+/g, ' ') };
}

test.describe('#2248 no catalysts cited', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 150_000 });

  test('K1. DEEP with levels and no catalysts shows the line', async ({ browser }) => { const r = await run(browser, 'DEEP', { levels: levels3, catalysts: [] }); try { console.log(`[K1] line=${LINE.test(r.text)}`); expect(r.text).toMatch(LINE); } finally { await r.ctx.close(); } });
  test('K2. DEEP with catalysts shows the bullets and no line', async ({ browser }) => { const r = await run(browser, 'DEEP', { levels: levels3, catalysts: ['CPI print on Thursday', 'ETF flow reversal'] }); try { console.log(`[K2] line=${LINE.test(r.text)} bullets=${/CPI print/.test(r.text)}`); expect(r.text).toMatch(/CPI print on Thursday/); expect(r.text).not.toMatch(LINE); } finally { await r.ctx.close(); } });
  test('K3. QUICK shows no line', async ({ browser }) => { const r = await run(browser, 'QUICK', { levels: levels3, catalysts: [] }); try { console.log(`[K3] line=${LINE.test(r.text)}`); expect(r.text).not.toMatch(LINE); } finally { await r.ctx.close(); } });
  test('K4. DEEP with no levels and no catalysts shows no line', async ({ browser }) => { const r = await run(browser, 'DEEP', { levels: [], catalysts: [] }); try { console.log(`[K4] line=${LINE.test(r.text)}`); expect(r.text).not.toMatch(LINE); } finally { await r.ctx.close(); } });
});
