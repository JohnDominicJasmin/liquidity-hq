/* QA on a deployed site (qa): what came after 735166c up to 117e5ac (#2821 to #2843). Dispatch-only. Prints [D] lines; soft assertions. Signed-out screenshots go to qa/.shots under plain names for PM.
 * Failures are forced in the browser (sockets, the history read, one alert refusal); nothing is written and no AI call is made (fenced). */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 300_000 });
const SIZES = [390, 768, 1280] as const, THEMES = ['dark', 'light'] as const;
async function anon(browser: Browser, width: number, theme: string, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme, lang]);
  return ctx;
}
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

test('D0 version, RSI coins and the operator check', async ({ request }) => {
  const v = await (await request.get('/api/version', { timeout: 150_000 })).json() as { commit: string };
  const r = await (await request.get('/api/market/rsi', { timeout: 120_000 })).json() as { rsi?: Record<string, Record<string, number>> };
  const pick = Object.fromEntries(['xau', 'pepe', 'bonk'].map((c) => [c, r.rsi?.[c] ? { h1: Math.round(r.rsi[c].rsi1h * 10) / 10, h4: Math.round(r.rsi[c].rsi4h * 10) / 10 } : null]));
  const e = await request.get('/api/egress-ip');
  console.log(`[D] version ${v.commit}; rsi coins=${Object.keys(r.rsi ?? {}).length} ${JSON.stringify(pick)}; egress-ip without secret: ${e.status()}`);
  expect.soft(Object.keys(r.rsi ?? {}).length).toBe(50); expect.soft(e.status()).toBe(401);
});

test('D95 Scanner cards for XAU, PEPE and BONK', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await page.goto('/scanner', { waitUntil: 'domcontentloaded', timeout: 150_000 });
    await page.locator('.scan-card').first().waitFor({ state: 'visible', timeout: 120_000 }); await page.waitForTimeout(30_000);
    for (const coin of ['xau', 'pepe', 'bonk']) {
      await page.locator('input[type="search"]').first().fill(coin); await page.waitForTimeout(1_500);
      const t = (await page.locator('.scan-card').first().innerText().catch(() => '')).replace(/\s+/g, ' ');
      console.log(`[D] scanner ${coin}: ${JSON.stringify(t.slice(0, 240))}`);
      expect.soft(t, `${coin} 1h/4h RSI`).toMatch(/RSI 1h \d+(\.\d+)?.*RSI 4h \d+(\.\d+)?/i);
    }
  } finally { await ctx.close().catch(() => {}); }
});

for (const width of SIZES) for (const theme of THEMES) {
  test(`D75 liquidation totals row, ${width} ${theme}`, async ({ browser }) => {
    const ctx = await anon(browser, width, theme); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.goto('/liq', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const row = page.locator('.liqfeed-stats').first(); await row.waitFor({ state: 'visible', timeout: 90_000 });
      const first = (await row.innerText()).replace(/\s+/g, ' '); await page.waitForTimeout(12_000);
      const later = (await row.innerText()).replace(/\s+/g, ' ');
      const m = await row.evaluate((r) => ({ mids: Array.from(r.children).map((c) => Math.round((c as HTMLElement).getBoundingClientRect().y + (c as HTMLElement).getBoundingClientRect().height / 2)), page: document.documentElement.scrollWidth }));
      console.log(`[D] liq stats ${width} ${theme}: first=${JSON.stringify(first)} after12s=${JSON.stringify(later)} oneLine=${Math.max(...m.mids) - Math.min(...m.mids) <= 2} scrollWidth=${m.page}`);
      expect.soft(Math.max(...m.mids) - Math.min(...m.mids)).toBeLessThanOrEqual(2); expect.soft(m.page).toBeLessThanOrEqual(width);
      await row.scrollIntoViewIfNeeded();
      const box = row.locator('xpath=..'); await box.screenshot({ path: `qa/.shots/pr2828-liq-stats-qa-${width}-${theme}.png` });
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('D96 liquidation totals while the history read is held, then failed', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage(); let release: () => void = () => {}; const gate = new Promise<void>((r) => { release = r; }); let held = 0;
  try {
    await installPaidAiFence(page);
    await page.route(/\/rest\/v1\/lhq(_dev)?_liq_events/, async (r) => { held++; await gate; await r.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"qa: forced"}' }); });
    await page.goto('/liq', { waitUntil: 'domcontentloaded', timeout: 150_000 });
    const row = page.locator('.liqfeed-stats').first(); await row.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(5_000);
    const pending = (await row.innerText()).replace(/\s+/g, ' '); release(); await page.waitForTimeout(6_000);
    const failed = (await row.innerText()).replace(/\s+/g, ' ');
    console.log(`[D] liq held=${held} pending=${JSON.stringify(pending)} failed=${JSON.stringify(failed)}`);
    expect.soft(held).toBeGreaterThan(0); expect.soft(pending).toContain('…'); expect.soft(pending).not.toMatch(/\$0\b/); expect.soft(failed).toMatch(/no data/i);
  } finally { await ctx.close().catch(() => {}); }
});

test('D32b the live sockets as this runner sees them, and the chip', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage(); const socks: Record<string, { frames: number; closed: boolean; errors: string[] }> = {};
  page.on('websocket', (ws) => { const k = ws.url().split('?')[0]; const m = (socks[k] ??= { frames: 0, closed: false, errors: [] }); ws.on('framereceived', () => { m.frames++; }); ws.on('close', () => { m.closed = true; }); ws.on('socketerror', (e) => { m.errors.push(String(e).slice(0, 80)); }); });
  try {
    await installPaidAiFence(page); await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(40_000);
    console.log(`[D] sockets: ${JSON.stringify(socks)}`);
    console.log(`[D] chip with the runner's own network: ${JSON.stringify(await page.getByTestId('feed-status').first().innerText({ timeout: 2_000 }).catch(() => null))}`);
  } finally { await ctx.close().catch(() => {}); }
});

test('D73 D74 Korean: tab titles and the new Korean words', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark', 'ko'); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page);
    for (const [path, words] of [['/arena', /LiquidityAI · 실시간|원하는 코인에 AI 분석/], ['/dashboard', /거래량/], ['/learn', /용어 \d+개 중 \d+개/], ['/scanner', /테이커/], ['/funding', /./], ['/privacy', /./]] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(12_000);
      const t = await text(page); const hit = words.exec(t)?.[0] ?? null;
      console.log(`[D] ko ${path}: title=${JSON.stringify(await page.title())} word=${JSON.stringify(hit)}`);
      expect.soft(await page.title(), path).toMatch(/[가-힣]/); expect.soft(hit, path).not.toBeNull();
    }
  } finally { await ctx.close().catch(() => {}); }
});

test('D93 the calendar countdown, 40 minutes before and at the start (browser clock)', async ({ browser }) => {
  for (const [name, at] of [['before', '2026-12-04T12:50:00Z'], ['start', '2026-12-04T13:31:00Z']] as const) {
    const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.clock.install({ time: new Date(at) });
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(15_000);
      const t = await text(page); const lines = [...t.matchAll(/(Upcoming: )?Nonfarm Payrolls \(NFP\) - [^()·]{0,30}/g)].map((m) => m[0].trim());
      console.log(`[D] countdown ${name} (${at}): ${JSON.stringify([...new Set(lines)])}`);
      expect.soft(lines.join(' | ')).toMatch(name === 'before' ? /Upcoming: .* - in \d+ min/ : /- Happening NOW/);
      if (name === 'start') expect.soft(lines.join(' | ')).not.toMatch(/Upcoming:/);
    } finally { await ctx.close().catch(() => {}); }
  }
});

test('D66 D61 signed in: a refused alert in Korean, and the settings plan panel', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures on this host');
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page);
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ko'); } catch { /* private */ } });
    await page.route(/\/api\/price-alerts/, (r) => (r.request().method() === 'POST' ? r.fulfill({ status: 400, contentType: 'application/json', body: '{"error":"ALERT_LIMIT","message":"QA-RAW-SERVER-WORDS"}' }) : r.fallback()));
    await gotoSignedIn(page, '/alerts'); await page.waitForTimeout(10_000);
    const price = page.locator('input[type="number"]').filter({ visible: true }).first();
    await price.fill('1'); await price.press('Enter'); await page.waitForTimeout(1_000);
    let t = await text(page);
    if (!/50개|You can have up to/.test(t)) { await price.locator('xpath=ancestor::*[.//button][1]').locator('button').last().click().catch(() => {}); await page.waitForTimeout(2_000); t = await text(page); }
    console.log(`[D] alert refusal: label=${JSON.stringify(/.{0,40}(50개|You can have up to 50).{0,60}/.exec(t)?.[0] ?? null)} rawShown=${t.includes('QA-RAW-SERVER-WORDS')} lang=${await page.evaluate(() => document.documentElement.lang)}`);
    expect.soft(t).toMatch(/50개|You can have up to 50/); expect.soft(t).not.toContain('QA-RAW-SERVER-WORDS');
    await gotoSignedIn(page, '/settings'); await page.waitForTimeout(12_000);
    const s = await text(page);
    const buttons = await page.getByRole('button').allInnerTexts();
    console.log(`[D] settings plan panel (Pro fixture): ${JSON.stringify(/.{0,20}(구독|Pro).{0,80}/.exec(s)?.[0] ?? null)} cancelButtons=${buttons.filter((b) => /cancel subscription|구독 취소|해지/i.test(b)).length}`);
    expect.soft(buttons.filter((b) => /cancel subscription|구독 취소|해지/i.test(b)).length).toBe(0);
  } finally { await ctx.close().catch(() => {}); }
});
