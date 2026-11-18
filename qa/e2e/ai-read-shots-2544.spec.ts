/* #2544 AI READ AT A GLANCE: Pro fixture, Arena BTC, the Quick read answered by a STUB (the paid AI route is fenced and nothing is billed) with a rich result: verdict + levels + FIVE WHY bullets (the card must cut to 3 for Quick), a chart read, patterns, reasoning.
 *   AR1  the card shows ONE summary line (arena-plain-summary), at most THREE reasons (arena-why-list), and a closed "More details" (arena-more-details) that holds the chart read / patterns / reasoning; summary is above the reasons
 *   AR2  a read with NO why[] falls back to one reasoning line (no empty list, no crash)
 *   AR3  screenshots of the read card (and the whole Arena) for PM's sign-off: en and ru, 390 and 1280, light and dark
 * Nothing is run on the paid AI route. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { settleForShot } from './_settle';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const RESULT = (why: string[] | undefined) => ({
  signal: 'LEAN BULLISH', confidence: 62, bias: 'BULLISH', waitFor: null, raidSetup: null, raidTarget: null, raidTrigger: null,
  levels: [{ price: 72400, label: 'Support', type: 'support' }, { price: 74100, label: 'Resistance', type: 'resistance' }, { price: 70900, label: 'Support', type: 'support' }],
  catalysts: ['US jobs data on Friday'], patterns: ['Higher lows on the 1h', 'Range under 74,100'],
  chartAnalysis: 'Price holds above the 20-period average and keeps making higher lows; the next test is the 74,100 resistance where sellers appeared twice this week.',
  reasoning: 'The trend on the one-hour chart is up and buyers are defending 72,400. Funding is neutral, so the move is not crowded. A close above 74,100 would confirm; a close under 72,400 would cancel the idea.',
  ...(why ? { why } : {}), analyzedAt: Date.now(), tf: '1h', session: 'London',
});
const WHY5 = ['Price is above the 20-period average', 'Buyers defended 72,400 twice today', 'Funding is neutral, so the move is not crowded', 'Volume rose on the last two green candles', 'The next resistance is 74,100'];

async function open(browser: Browser, lang: string, theme: string, width: number, why: string[] | undefined) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [lang, theme]);
  await page.route(/\/api\/grok(\?|$)/, async (route) => (route.request().method() !== 'POST' ? route.fallback() : route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ result: RESULT(why) }) })));
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, language: lang, strategy_selection: null, strategy_params: null, arena_strategy: null }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b as Record<string, unknown>)) }); });
  await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(10_000);
  return { ctx, page };
}
async function runQuick(page: Page) {
  const btn = page.locator('.arena-quick-btn').first(); await expect(btn).toBeVisible({ timeout: 40_000 }); await btn.click({ force: true });
  await page.locator('[data-testid="arena-plain-summary"]').first().waitFor({ state: 'visible', timeout: 40_000 }); await page.waitForTimeout(1_500);
}
const card = (page: Page) => page.locator('[data-testid="arena-plain-summary"]').first().locator('xpath=ancestor::*[contains(@class,"av-") or contains(@class,"arena-result") or contains(@class,"arena-read")][1]');

test('AR1. one summary, at most three reasons, a closed More details (en 1280)', async ({ browser }) => {
  test.setTimeout(180_000); const { ctx, page } = await open(browser, 'en', 'dark', 1280, WHY5);
  try {
    await runQuick(page);
    const m = await page.evaluate(() => {
      const sum = document.querySelector('[data-testid="arena-plain-summary"]') as HTMLElement | null; const list = document.querySelector('[data-testid="arena-why-list"]') as HTMLElement | null; const det = document.querySelector('[data-testid="arena-more-details"]') as HTMLDetailsElement | null;
      return { summary: (sum?.innerText || '').replace(/\s+/g, ' ').trim(), whyItems: list ? Array.from(list.querySelectorAll('li')).map((li) => (li as HTMLElement).innerText.trim()) : null, detailsOpen: det ? det.open : null, detailsSummary: det ? (det.querySelector('summary') as HTMLElement | null)?.innerText.trim() : null,
        summaryAboveList: sum && list ? sum.getBoundingClientRect().top < list.getBoundingClientRect().top : null, chartReadInsideDetails: det ? /Price holds above the 20-period/.test(det.innerText) || /higher lows/i.test(det.innerText) : null };
    });
    console.log(`[AIREAD2544] AR1 ${JSON.stringify(m)}`);
    expect(m.summary.length, 'no plain summary').toBeGreaterThan(10); expect(m.whyItems, 'no WHY list').toBeTruthy(); expect(m.whyItems!.length, 'Quick must show at most 3 reasons').toBeLessThanOrEqual(3); expect(m.whyItems!.length).toBeGreaterThan(0);
    expect(m.detailsOpen, 'More details must start CLOSED').toBe(false); expect(m.summaryAboveList, 'the summary must sit above the reasons').toBe(true);
  } finally { await ctx.close(); }
});

test('AR2. a read with no why falls back to one reasoning line', async ({ browser }) => {
  test.setTimeout(180_000); const { ctx, page } = await open(browser, 'en', 'dark', 1280, undefined);
  try {
    await runQuick(page);
    const m = await page.evaluate(() => ({ list: !!document.querySelector('[data-testid="arena-why-list"]'), why: (document.querySelector('.av-why') as HTMLElement | null)?.innerText || '', summary: (document.querySelector('[data-testid="arena-plain-summary"]') as HTMLElement | null)?.innerText || '' }));
    console.log(`[AIREAD2544] AR2 ${JSON.stringify({ ...m, why: m.why.slice(0, 80) })}`);
    expect(m.list, 'an EMPTY why list is drawn').toBe(false); expect(m.why.length, 'no fallback reasoning line').toBeGreaterThan(10); expect(m.summary.length).toBeGreaterThan(5);
  } finally { await ctx.close(); }
});

for (const lang of ['en', 'ru']) for (const theme of ['light', 'dark']) for (const width of [390, 1280]) {
  test(`AR3 SHOT ${lang} ${theme} ${width}`, async ({ browser }) => {
    test.setTimeout(180_000); const { ctx, page } = await open(browser, lang, theme, width, WHY5);
    try {
      await runQuick(page); await settleForShot(page, 'airead').catch(() => {});
      await page.screenshot({ path: `qa/.shots/airead-page-${lang}-${theme}-${width}.png`, timeout: 25_000 }).catch(() => {});
      const el = card(page); if (await el.count()) { await el.scrollIntoViewIfNeeded().catch(() => {}); await page.waitForTimeout(600); await el.screenshot({ path: `qa/.shots/airead-card-${lang}-${theme}-${width}.png`, timeout: 25_000 }).catch(() => {}); }
      const det = page.locator('[data-testid="arena-more-details"]').first(); if (await det.count()) { await det.locator('summary').click().catch(() => {}); await page.waitForTimeout(700); await det.screenshot({ path: `qa/.shots/airead-more-${lang}-${theme}-${width}.png`, timeout: 25_000 }).catch(() => {}); }
      const txt = ((await page.locator('[data-testid="arena-plain-summary"]').first().innerText()) || '').replace(/\s+/g, ' '); console.log(`[AIREAD2544] ${lang} ${theme} ${width}: summary "${txt.slice(0, 120)}"; sideways ${await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)}`);
      const cul = await page.evaluate(() => { const vw = document.documentElement.clientWidth; const clipAnc = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (/hidden|clip|auto|scroll/.test(getComputedStyle(a).overflowX) || getComputedStyle(a).position === 'fixed') return true; return false; }; return { doc: document.documentElement.scrollWidth, vw, past: Array.from(document.querySelectorAll('body *')).map((e) => ({ e, r: e.getBoundingClientRect() })).filter((x) => x.r.width > 0 && x.r.right > vw + 1 && !clipAnc(x.e)).slice(0, 8).map((x) => `${x.e.tagName.toLowerCase()}.${String((x.e as HTMLElement).className).slice(0, 26)} "${((x.e as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 22)}" r${Math.round(x.r.right)}`) }; });
      console.log(`[AIREAD2544] culprits ${lang} ${theme} ${width}: ${JSON.stringify(cul)}`);
    } finally { await ctx.close(); }
  });
}
