/* QA #1651 owner item 34 on a DEPLOYED site, signed out, read-only: FET funding, and the Scanner's RSI for gold, SPX, PEPE and BONK (BTC as the control). GETs only; the AI is fenced. Prints [F34] lines. */
import { test, expect } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test('F34 Scanner RSI and FET funding show numbers', async ({ browser }) => {
  test.setTimeout(420_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage(); let api: Record<string, Record<string, number>> = {}; const klines: string[] = [];
  page.on('response', async (r) => {
    if (r.url().includes('/api/market/rsi')) api = ((await r.json().catch(() => null)) as { rsi?: typeof api } | null)?.rsi ?? api;
    if (/PEPE|BONK|XAU|SPX/i.test(r.url()) && /klines?/i.test(r.url())) klines.push(`${r.status()} ${r.url().replace(/^https?:\/\//, '').slice(0, 110)}`);
  });
  try {
    await installPaidAiFence(page);
    await page.goto('/scanner', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('.scan-card').first().waitFor({ state: 'visible', timeout: 120_000 }); await page.waitForTimeout(45_000);
    console.log(`[F34] ${new Date().toISOString()} rsi api coins=${Object.keys(api).length}`);
    for (const coin of ['btc', 'xau', 'spx', 'pepe', 'bonk']) {
      await page.locator('input[type="search"]').first().fill(coin); await page.waitForTimeout(2_000);
      const card = page.locator('.scan-card').filter({ has: page.locator('.scan-coin-name', { hasText: new RegExp(`^${coin}$`, 'i') }) }).first();
      const there = await card.count();
      const text = there ? (await card.innerText()).replace(/\s+/g, ' ') : null;
      const rsi = text ? (text.match(/RSI[^A-Za-z]{0,6}(?:1H|4H)?\s*:?\s*\d+(?:\.\d+)?/gi) ?? []) : [];
      console.log(`[F34] scanner ${coin}: card=${there > 0} rsiShown=${JSON.stringify(rsi)} api=${JSON.stringify(api[coin] ? { h1: api[coin].rsi1h, h4: api[coin].rsi4h } : null)} text=${JSON.stringify(text?.slice(0, 260) ?? null)}`);
      expect.soft(there, `${coin}: no card`).toBeGreaterThan(0);
      expect.soft(rsi.length, `${coin}: the card shows no RSI`).toBeGreaterThan(0);
    }
    console.log(`[F34] browser candle reads for those coins: ${klines.length ? klines.slice(0, 8).join(' | ') : 'none'}`);
    await page.goto('/funding', { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.locator('.frh-table tbody tr').first().waitFor({ state: 'visible', timeout: 120_000 }); await page.waitForTimeout(25_000);
    const rows = await page.locator('.frh-table tbody tr').evaluateAll((trs) => trs.map((tr) => Array.from(tr.querySelectorAll('td')).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, ' ').trim())));
    for (const coin of ['FET', 'XAU', 'SPX', 'PEPE', 'BONK']) {
      const r = rows.find((x) => (x[0] ?? '').toUpperCase().startsWith(coin));
      console.log(`[F34] funding ${coin}: ${r ? JSON.stringify(r.slice(0, 4)) : 'no row'}`);
      if (coin === 'FET') expect.soft(r?.[1] ?? '', 'FET current funding is not a number').toMatch(/[+-]?\d+\.\d+%/);
    }
  } finally { await ctx.close().catch(() => {}); }
});
