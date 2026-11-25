/* QA on a deployed site (qa): the 2026-11-25 batch (#2797 to #2809). Dispatch-only. Prints [B] lines; soft assertions. Screenshots shot-*.png at 390 and 1280, light and dark, for PM's visual checks.
 * Writes: one push subscription with a fake endpoint for the Pro fixture, removed in the same cell (dev database). No AI call (fenced). */
import { test, expect, type Page } from '@playwright/test';
import { AUTH_READY, FIXTURES, signIn, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 240_000 });

const SIZES = [390, 1280] as const, THEMES = ['dark', 'light'] as const;
async function anon(browser: import('@playwright/test').Browser, width: number, theme: string, lang = 'en') {
  const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
  await ctx.addInitScript(([t, l]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [theme, lang]);
  return ctx;
}
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const UNLIMITED = /unlimited price alerts|unlimited alerts|무제한 가격 알림|无限价格提醒|تنبيهات أسعار غير محدودة|[Нн]еограниченные оповещения/i;

test('B0 version and the market snapshot (#2797)', async ({ request }) => {
  const v = await (await request.get('/api/version', { timeout: 150_000 })).json() as { commit: string; branch: string };
  const r = await request.get('/api/market/snapshot', { timeout: 120_000 });
  const s = await r.json().catch(() => ({})) as { ticker?: Record<string, { high?: number }>; partial?: string[]; viaFallback?: Record<string, string[]> };
  console.log(`[B] version ${v.commit} ${v.branch}; snapshot HTTP ${r.status()} ticker=${Object.keys(s.ticker ?? {}).length} partial=${JSON.stringify(s.partial)} tickerViaFallback=${(s.viaFallback?.ticker ?? []).length}`);
  expect.soft(r.status()).toBe(200); expect.soft(Object.keys(s.ticker ?? {}).length).toBeGreaterThan(30);
});

test('B2802 push: Free is refused by the server, Pro is accepted and can remove it', async ({ request }) => {
  test.skip(!AUTH_READY, 'no fixtures on this host');
  const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/qa-batch-1128', keys: { p256dh: 'qaKeyBatch1128', auth: 'qaAuthBatch1128' } };
  const free = await signIn(FIXTURES.bEmail, FIXTURES.bPassword), pro = await signIn(FIXTURES.aEmail, FIXTURES.aPassword);
  const f = await request.post('/api/push/subscribe', { headers: { Authorization: `Bearer ${free}` }, data: sub });
  const fb = await f.json().catch(() => ({})) as { error?: string };
  console.log(`[B] push subscribe as Free: HTTP ${f.status()} ${fb.error ?? ''}`); expect.soft(f.status()).toBe(403); expect.soft(fb.error).toBe('PRO_REQUIRED');
  try {
    const p = await request.post('/api/push/subscribe', { headers: { Authorization: `Bearer ${pro}` }, data: sub });
    console.log(`[B] push subscribe as Pro: HTTP ${p.status()}`); expect.soft(p.status()).toBe(200);
  } finally {
    const d = await request.delete('/api/push/subscribe', { headers: { Authorization: `Bearer ${pro}` }, data: { endpoint: sub.endpoint } });
    console.log(`[B] push unsubscribe (cleanup): HTTP ${d.status()}`); expect.soft(d.status()).toBe(200);
  }
});

for (const width of SIZES) for (const theme of THEMES) {
  test(`B2802 settings push switch, Free, ${width} ${theme}`, async ({ browser }, info) => {
    test.skip(!AUTH_READY, 'no fixtures on this host');
    const ctx = await signedInContext(browser, 'b', { viewport: { width, height: width < 500 ? 844 : 900 }, theme });
    const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await gotoSignedIn(page, '/settings');
      const sw = page.getByRole('switch', { name: /push/i }).first(); await sw.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(8_000);
      const row = sw.locator('xpath=ancestor::div[2]'); await row.scrollIntoViewIfNeeded();
      const st = { disabled: await sw.isDisabled(), checked: await sw.getAttribute('aria-checked'), row: (await row.innerText()).replace(/\s+/g, ' '), theme: await page.evaluate(() => document.documentElement.getAttribute('data-theme') ?? document.documentElement.className) };
      console.log(`[B] settings push ${width} ${theme}: ${JSON.stringify(st)}`);
      expect.soft(st.disabled).toBe(true); expect.soft(st.row).toMatch(/pro/i);
      await page.screenshot({ path: info.outputPath(`shot-2802-settings-push-${width}-${theme}.png`) });
    } finally { await ctx.close().catch(() => {}); }
  });

  test(`B2805 market read tiles, ${width} ${theme}`, async ({ browser }, info) => {
    const ctx = await anon(browser, width, theme); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      const grid = page.locator('.mr-factors').first(); await grid.waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(10_000);
      const m = await grid.evaluate((g) => ({ tiles: Array.from(g.querySelectorAll('.mr-factor')).map((e) => (e as HTMLElement).innerText.replace(/\s+/g, ' ').trim()), columns: getComputedStyle(g).gridTemplateColumns.split(' ').length, overflow: g.scrollWidth - g.clientWidth, page: document.documentElement.scrollWidth }));
      console.log(`[B] market read ${width} ${theme}: ${JSON.stringify(m)}`);
      expect.soft(m.tiles.length).toBe(4); expect.soft(m.tiles.join(' ')).not.toMatch(/wall/i); expect.soft(m.page).toBeLessThanOrEqual(width);
      await grid.locator('xpath=ancestor::*[contains(@class,"card") or contains(@class,"mr-")][last()]').screenshot({ path: info.outputPath(`shot-2805-market-read-${width}-${theme}.png`) }).catch(async () => { await grid.screenshot({ path: info.outputPath(`shot-2805-market-read-${width}-${theme}.png`) }); });
    } finally { await ctx.close().catch(() => {}); }
  });

  test(`B2808 upgrade feature list, ${width} ${theme}`, async ({ browser }, info) => {
    const ctx = await anon(browser, width, theme); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page); await page.goto('/upgrade', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(12_000);
      const t = await text(page); const line = /.{0,40}50 active price alerts.{0,20}/i.exec(t)?.[0] ?? null;
      console.log(`[B] upgrade ${width} ${theme}: line=${JSON.stringify(line)} unlimited=${UNLIMITED.test(t)} scrollWidth=${await page.evaluate(() => document.documentElement.scrollWidth)}`);
      expect.soft(line, 'the upgrade list does not say 50 active price alerts').not.toBeNull(); expect.soft(UNLIMITED.test(t)).toBe(false);
      await page.screenshot({ path: info.outputPath(`shot-2808-upgrade-${width}-${theme}.png`), fullPage: true });
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const lang of ['en', 'ko', 'zh', 'ru', 'ar']) {
  test(`B2806 B2808 words in ${lang}`, async ({ browser }) => {
    const ctx = await anon(browser, 1280, 'dark', lang); const page = await ctx.newPage();
    try {
      await installPaidAiFence(page);
      await page.goto('/privacy', { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(8_000);
      const p = await text(page); const date = /(Last updated|최종 업데이트|最后更新|Последнее обновление|آخر تحديث)[^.。]{0,40}20\d\d(년 \d+월|年\d+月| г)?/.exec(p)?.[0] ?? null;
      console.log(`[B] privacy ${lang}: GlitchTip=${p.includes('GlitchTip')} Turnstile=${p.includes('Turnstile')} date=${JSON.stringify(date)}`);
      expect.soft(p.includes('GlitchTip') && p.includes('Turnstile')).toBe(true); expect.soft(date ?? '').toMatch(/November|11월|11月|ноябрь|نوفمبر/);
      for (const path of ['/upgrade', '/faq', '/help', '/']) {
        await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(7_000);
        const html = await page.evaluate(() => document.body.textContent?.replace(/\s+/g, ' ') ?? '');
        const hit = UNLIMITED.exec(html);
        console.log(`[B] ${lang} ${path}: unlimited=${hit ? JSON.stringify(html.slice(Math.max(0, hit.index - 40), hit.index + 60)) : false} has50=${/(?<!\d)50(?!\d)/.test(html)}`);
        expect.soft(hit?.[0] ?? null, `${lang} ${path} still promises unlimited price alerts`).toBeNull();
      }
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('B2804 a live EMA setup card: target is 2:1 from the entry shown', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures on this host'); test.setTimeout(420_000);
  const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
  let found = 0; const seen: string[] = [];
  try {
    await installPaidAiFence(page);
    for (const coin of ['btc', 'eth', 'sol', 'xrp', 'bnb', 'doge', 'avax', 'link', 'ada', 'sui', 'ltc', 'near']) {
      await gotoSignedIn(page, `/arena?coin=${coin}&tf=1h`); await page.waitForTimeout(14_000);
      const t = await text(page);
      const num = (re: RegExp) => { const m = re.exec(t); return m ? Number(m[1].replace(/,/g, '')) : null; };
      const entry = num(/Entry[^$]{0,60}\$([\d,]+(?:\.\d+)?)/), sl = num(/(?:Stop loss|Stop|SL)\b[^$]{0,60}\$([\d,]+(?:\.\d+)?)/), tp = num(/(?:Take profit|Target|TP)\b[^$]{0,60}\$([\d,]+(?:\.\d+)?)/);
      const verdict = /(Long setup|Short setup|Trending (?:long|short|up|down)|Freeze|No clear setup|Not enough movement)/i.exec(t)?.[0] ?? '?';
      seen.push(`${coin}:${verdict}`);
      if (/long setup|short setup/i.test(verdict) && entry && sl && tp) {
        const rr = (tp - entry) / (entry - sl); found++;
        console.log(`[B] ${coin} ${verdict}: entry ${entry} stop ${sl} target ${tp} reward:risk ${rr.toFixed(3)}`);
        expect.soft(Math.abs(rr - 2), `${coin}: ${rr.toFixed(3)} to 1`).toBeLessThan(0.05);
        if (found >= 3) break;
      }
    }
    console.log(`[B] EMA setups measured: ${found}; verdicts seen: ${seen.join(' ')}`);
  } finally { await ctx.close().catch(() => {}); }
});

test('B2809 signed-out public pages still read their data (grants not applied yet)', async ({ browser }) => {
  const ctx = await anon(browser, 1280, 'dark'); const page = await ctx.newPage(); const bad: string[] = [];
  page.on('response', (r) => { if (/supabase\.co\/rest\/v1\//.test(r.url()) && r.status() >= 400) bad.push(`${r.status()} ${r.url().split('/rest/v1/')[1]?.slice(0, 60)}`); });
  try {
    await installPaidAiFence(page);
    for (const path of ['/news', '/econ-calendar', '/liq', '/live-tracking']) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(8_000);
      const t = await text(page); console.log(`[B] signed out ${path}: chars=${t.length} errorWords=${JSON.stringify(/.{0,30}(permission denied|couldn.t load|failed to load).{0,30}/i.exec(t)?.[0] ?? null)}`);
      expect.soft(t).not.toMatch(/permission denied/i);
    }
    console.log(`[B] database refusals seen by the browser: ${bad.length ? bad.join(' | ') : 'none'}`);
  } finally { await ctx.close().catch(() => {}); }
});
