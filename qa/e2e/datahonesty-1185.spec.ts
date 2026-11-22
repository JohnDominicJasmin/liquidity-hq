/* #1185 THE SEVEN DATA-HONESTY SITES, re-measured with the market reads FAILING (QA comment 6793111067, Dev says fixed): a failed read must never be shown as a confident value or as "nothing here".
 * Every market read is aborted (snapshot, proxy, klines, news) and WebSockets are closed, so the store never gets data. Read-only: nothing is written, no AI. Prints [DH] lines with the text each site shows after 25 s; soft assertions on the written rule:
 *   DH1 /scanner: SetupScanner, AccumulationTracker, DistributionTracker do not say "No setups match" / "No stealth accumulation detected" / "No distribution detected" for a failed read
 *   DH2 /arena: MultiTFAlignment draws no confident 0% bar from a missing RSI
 *   DH3 /news All tab: does not stay on a loading state for ever, and does not claim "no news" for a failed read
 *   DH4 (Pro fixture, staging) /arena ConfluenceScore: prints the panel text with klines failing
 * The "Setup 0" public-landing item was ticked by PM (2026-11-14). */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import DEFAULT_EN from '../../lib/labelDefaults.en.json';

const EN = DEFAULT_EN as Record<string, string>;
const DH = (id: string, msg: string) => console.log(`[DH] ${id} ${msg}`);
async function failReads(page: Page) {
  for (const g of ['**/api/market/**', '**/api/proxy**', '**/api/news**']) await page.route(g, (r) => r.abort('failed'));
  const ws = (page as unknown as { routeWebSocket?: (u: RegExp, h: (w: { close: () => void }) => void) => Promise<void> }).routeWebSocket;
  if (ws) await ws.call(page, /.*/, (w) => w.close());
}
const body = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const prefix = (k: string, n = 36) => (EN[k] ?? k).slice(0, n);
const lang = (ctx: import('@playwright/test').BrowserContext) => ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });

test('DH1 /scanner with every market read failing: no "nothing here" claim', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await lang(ctx); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await failReads(page);
    await page.goto('/scanner', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(25_000);
    const t = await body(page);
    const claims = { setupNoMatch: /No setups match|No strong setups right now|No coins match/i.test(t), accumulationEmpty: t.includes(prefix('ACCUMULATION_TRACKER_EMPTY')), distributionEmpty: t.includes(prefix('DISTRIBUTION_TRACKER_EMPTY_TITLE')) };
    const win = (re: RegExp, n = 320) => { const m = re.exec(t); return m ? t.slice(m.index, m.index + n) : 'NOT ON THE PAGE'; };
    DH('DH1', `${JSON.stringify(claims)} · SETUP: ${win(/Setup Scanner|squeeze risk/i)} · ACCUMULATION: ${win(/Accumulation Tracker/i)} · DISTRIBUTION: ${win(/Distribution Tracker/i)}`);
    expect.soft(claims.setupNoMatch, 'SetupScanner says no match for a failed read').toBe(false);
    expect.soft(claims.accumulationEmpty, 'AccumulationTracker says nothing detected for a failed read').toBe(false);
    expect.soft(claims.distributionEmpty, 'DistributionTracker says nothing detected for a failed read').toBe(false);
  } finally { await ctx.close().catch(() => {}); }
});

test('DH2 /arena with every market read failing: MultiTFAlignment shows no confident 0% from a missing RSI', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await lang(ctx); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await failReads(page);
    await page.goto('/arena?coin=btc&tf=1h', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(25_000);
    const m = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('section,div,aside')).filter((e) => /multi.?tf|timeframe alignment|alignment/i.test((e as HTMLElement).innerText?.slice(0, 80) ?? '')).sort((a, b) => (a as HTMLElement).innerText.length - (b as HTMLElement).innerText.length)[0] as HTMLElement | undefined;
      const txt = el ? el.innerText.replace(/\s+/g, ' ').slice(0, 500) : null;
      const bars = el ? Array.from(el.querySelectorAll('[style*="width"]')).map((b) => (b as HTMLElement).style.width).filter((w) => /%/.test(w)) : [];
      return { found: !!el, txt, bars: bars.slice(0, 12) };
    });
    DH('DH2', JSON.stringify(m));
    const zeroBars = m.bars.filter((w) => /^0(\.0+)?%$/.test(w));
    expect.soft(zeroBars.length, `MultiTFAlignment draws ${zeroBars.length} zero-percent bars while every read fails: ${JSON.stringify(m.bars)}`).toBe(0);
  } finally { await ctx.close().catch(() => {}); }
});

test('DH3 /news All tab with the reads failing: not a loading state for ever, not "no news"', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); await lang(ctx); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await failReads(page);
    await page.goto('/news', { waitUntil: 'domcontentloaded', timeout: 60_000 });
    await page.waitForTimeout(20_000); const t20 = await body(page); await page.waitForTimeout(40_000); const t60 = await body(page);
    const busy = await page.evaluate(() => document.querySelectorAll('[aria-busy="true"], [class*="skeleton" i]').length);
    const after = (t: string) => { const i = t.indexOf('Breaking crypto headlines'); return i < 0 ? t.slice(-500) : t.slice(i, i + 700); };
    DH('DH3', `at 20 s: ${after(t20)} || at 60 s: ${after(t60)} || skeleton/busy elements at 60 s: ${busy}`);
    expect.soft(busy, 'the News page is still on a loading state after 60 s with every read failing').toBe(0);
    expect.soft(/no news|nothing here|no alerts|no articles/i.test(t60) && !/couldn.t|could not|unavailable|failed|retry|try again/i.test(t60), 'the News page claims there is nothing for a failed read').toBe(false);
  } finally { await ctx.close().catch(() => {}); }
});

test('DH4 Pro /arena with klines failing: the Confluence panel text', async ({ browser }) => {
  test.skip(!AUTH_READY, 'the Pro fixture does not exist on this host'); test.setTimeout(150_000);
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  try {
    await installPaidAiFence(page); await failReads(page);
    await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(25_000);
    const c = await page.evaluate(() => {
      const el = Array.from(document.querySelectorAll('section,div')).filter((e) => /confluence/i.test((e as HTMLElement).innerText?.slice(0, 60) ?? '')).sort((a, b) => (a as HTMLElement).innerText.length - (b as HTMLElement).innerText.length)[0] as HTMLElement | undefined;
      return el ? el.innerText.replace(/\s+/g, ' ').slice(0, 700) : null;
    });
    DH('DH4', `Confluence panel text: ${c}`);
    expect.soft(c, 'the Confluence panel is missing').not.toBeNull();
  } finally { await ctx.close().catch(() => {}); }
});
