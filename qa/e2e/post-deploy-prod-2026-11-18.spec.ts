/* POST-DEPLOY PRODUCTION CHECKS for release v2026.11.18, READ-ONLY (signed out, GETs only, nothing written, no account).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f base_url=https://liquidity-hq.onrender.com -f project=desktop -f "spec=qa/e2e/post-deploy-prod-2026-11-18.spec.ts"
 *   PD1  /api/version answers a commit (printed: compare it with the release commit by eye) and a branch
 *   PD2  /api/market/snapshot: the klines section has 50 coins, HYPE among them with finite vwap and rsi14 (#2513)
 *   PD3  /upgrade: the checkout slot is in the HTML (upgrade-plans-pending) AND a script chunk carries the Whop checkout URL (#2503 must not have dropped it)
 *   PD4  /api/labels?locale=ru: the Russian run row (Быстрый / Глубокий / Спросить ИИ), the panel section titles and the three strategy group names are present and Cyrillic; the English anti-chop label is the new wording
 *   PD5  / /arena /briefing /dashboard /markets /changelog answer 200, render without a page error, and /changelog names v2026.11.18
 * Each check prints one [PRODCHK] line. */
import { test, expect } from '@playwright/test';

test('PD1. /api/version answers a commit and a branch', async ({ request }) => {
  test.setTimeout(150_000); const r = await request.get('/api/version', { timeout: 120_000 }); expect(r.status()).toBe(200); const j = await r.json() as { commit?: string; branch?: string };
  console.log(`[PRODCHK] PD1 version ${JSON.stringify(j)}`); expect(j.commit, 'no commit').toMatch(/^[0-9a-f]{7,40}$/); expect(j.branch, 'no branch').toBeTruthy();
});

test('PD2. snapshot: 50 coins, HYPE with finite vwap and rsi14', async ({ request }) => {
  test.setTimeout(120_000); const r = await request.get('/api/market/snapshot'); expect(r.status(), 'snapshot answered').toBe(200);
  const j = await r.json() as { klines?: Record<string, { vwap?: number; rsi14?: number } | undefined>; data?: { klines?: Record<string, unknown> } }; const k = (j.klines ?? (j.data?.klines as Record<string, { vwap?: number; rsi14?: number }>) ?? {}) as Record<string, { vwap?: number; rsi14?: number } | undefined>;
  const coins = Object.keys(k); const hype = k.hype; console.log(`[PRODCHK] PD2 klines ${coins.length} coins; hype vwap ${hype?.vwap} rsi14 ${hype?.rsi14}; missing of the usual: ${['btc', 'eth', 'sol', 'fet', 'hype'].filter((c) => !k[c]).join(',') || 'none'}`);
  expect(coins.length, `klines hold ${coins.length} coins, not 50`).toBe(50); expect(Number.isFinite(hype?.vwap), 'HYPE vwap is not a finite number').toBe(true); expect(Number.isFinite(hype?.rsi14), 'HYPE rsi14 is not a finite number').toBe(true);
});

test('PD3. /upgrade keeps the checkout slot and the Whop URL', async ({ request }) => {
  test.setTimeout(180_000); const r = await request.get('/upgrade'); expect(r.status()).toBe(200); const html = await r.text();
  const pending = html.includes('upgrade-plans-pending'); const chunks = [...new Set([...html.matchAll(/\/_next\/static\/chunks\/[A-Za-z0-9_\-./%~]+\.js/g)].map((m) => m[0]))]; let whop = ''; let scanned = 0;
  for (const c of chunks.slice(0, 80)) { const t = await (await request.get(c)).text().catch(() => ''); scanned++; const m = /https:\/\/[a-z.]*whop\.com\/checkout[^"'`\s)]{0,40}/.exec(t); if (m) { whop = m[0]; break; } }
  console.log(`[PRODCHK] PD3 checkout slot in HTML ${pending}; chunks scanned ${scanned}/${chunks.length}; whop url "${whop}"`);
  expect(pending, 'the checkout slot (upgrade-plans-pending) is not in the /upgrade HTML').toBe(true); expect(whop, 'no script chunk carries the Whop checkout URL').not.toBe('');
});

test('PD4. Russian labels: run row, panel sections, group names; new English anti-chop wording', async ({ request }) => {
  const ru = await (await request.get('/api/labels?locale=ru')).json() as Record<string, string>; const en = await (await request.get('/api/labels?locale=en')).json() as Record<string, string>;
  const L = (o: Record<string, string>, k: string) => (o as { labels?: Record<string, string> }).labels?.[k] ?? o[k];
  const want: Array<[string, string]> = [['STRATEGY_PANEL_RUN_QUICK', 'Быстрый'], ['STRATEGY_PANEL_RUN_DEEP', 'Глубокий'], ['STRATEGY_PANEL_RUN_ASK', 'Спросить ИИ'], ['STRATEGY_PANEL_SECTION_SET', 'Набор стратегий'], ['STRATEGY_PANEL_SECTION_INDICATORS', 'Индикаторы']];
  const got = want.map(([k]) => [k, L(ru, k)]); console.log(`[PRODCHK] PD4 ru ${JSON.stringify(got)}; groups ${JSON.stringify(['STRATEGY_GROUP_BEGINNER', 'STRATEGY_GROUP_PRICE', 'STRATEGY_GROUP_SESSIONS'].map((k) => [k, L(ru, k)]))}; en antichop "${L(en, 'ARENA_ANTICHOP_LABEL')}"`);
  for (const [k, v] of want) expect(L(ru, k), `ru ${k}`).toBe(v);
  for (const k of ['STRATEGY_GROUP_BEGINNER', 'STRATEGY_GROUP_PRICE', 'STRATEGY_GROUP_SESSIONS']) expect(/[А-Яа-я]/.test(L(ru, k) ?? ''), `ru ${k} is not Russian: "${L(ru, k)}"`).toBe(true);
  expect(L(en, 'ARENA_ANTICHOP_LABEL'), 'the anti-chop label wording').toBe('EMA ribbon: fewer, stricter signals');
});

for (const path of ['/', '/arena', '/briefing', '/dashboard', '/markets', '/changelog']) {
  test(`PD5. ${path} loads clean${path === '/changelog' ? ' and names v2026.11.18' : ''}`, async ({ page }) => {
    test.setTimeout(120_000); const errs: string[] = []; page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
    await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const resp = await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000); const text = (await page.locator('body').innerText()).replace(/\s+/g, ' ');
    console.log(`[PRODCHK] PD5 ${path}: status ${resp?.status()}, ${text.length} chars, page errors ${JSON.stringify(errs)}${path === '/changelog' ? `, newest entry sentence present ${/The landing page fits phones/.test(text)}, 2026-11-18 or tag present ${/2026[.-]11[.-]18|November 18/.test(text)}` : ''}`);
    expect(resp?.status()).toBe(200); expect(errs, `page errors on ${path}`).toEqual([]); expect(text.length, `${path} rendered almost nothing`).toBeGreaterThan(300);
    if (path === '/changelog') expect(/The landing page fits phones/.test(text), 'the changelog does not carry the v2026.11.18 entry ("The landing page fits phones")').toBe(true);
  });
}
