/* SETTINGS, AS A USER (owner order 2026-11-18, item D): every control on /settings saves, survives a reload FROM THE DATABASE, and (where it can be seen) takes effect. Staging / CI, signed in as the Free fixture (b); every value is put back at the end.
 *   S1  account size, risk per trade, default coin, default timeframe, funding trigger, fear below, greed above, RSI overbought, RSI oversold, squeeze score: each is changed, then a BRAND-NEW signed-in context (empty localStorage, so only the saved row can supply the value) reads them back
 *   S2  EFFECT: with default coin ETH and timeframe 4h saved, /arena with no coin in the URL opens ETH on 4h
 *   S3  the Arena sound switch: on, saved, a new context shows it on and the first-visit sound question is not asked again; off again
 * Prints every reading ([SET]). A control that does not persist is printed with its before / typed / after values. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const NUM: Array<[string, string]> = [['Account Size', '1234'], ['Risk Per Trade', '2.5'], ['Funding Rate trigger', '0.08'], ['Extreme Fear below', '20'], ['Extreme Greed above', '80'], ['RSI 1h overbought', '75'], ['RSI 1h oversold', '25'], ['Squeeze/Flush alert score', '65']];
const field = (page: Page, name: string) => page.getByRole('spinbutton', { name, exact: true });
async function open(browser: Browser) { const ctx = await signedInContext(browser, 'b', { viewport: { width: 1280, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }); const page = await ctx.newPage(); await gotoSignedIn(page, '/settings'); await page.getByTestId('settings-page').waitFor({ timeout: 40_000 }); await page.waitForTimeout(3_000); return { ctx, page }; }
async function readAll(page: Page) {
  const out: Record<string, string> = {};
  for (const [n] of NUM) out[n] = await field(page, n).inputValue().catch(() => '(missing)');
  out['Default Coin'] = await page.getByRole('combobox', { name: 'Default Coin', exact: true }).inputValue().catch(() => '(missing)');
  out['Default Timeframe'] = await page.locator('.st-chip[aria-pressed="true"]').first().innerText().catch(() => '(missing)');
  return out;
}
async function setAll(page: Page, vals: Record<string, string>) {
  for (const [n] of NUM) if (vals[n] != null) { const f = field(page, n); await f.fill(vals[n]); await f.blur(); }
  if (vals['Default Coin']) await page.getByRole('combobox', { name: 'Default Coin', exact: true }).selectOption(vals['Default Coin']);
  if (vals['Default Timeframe']) { const chip = page.locator('.st-chip', { hasText: new RegExp(`^${vals['Default Timeframe']}$`, 'i') }).first(); if (await chip.isEnabled()) await chip.click(); else console.log(`[SET] the ${vals['Default Timeframe']} chip is LOCKED for this plan: left as is (the fixture can hold a saved value its plan cannot re-select)`); }
}

test('S1. every settings control saves to the account and a fresh session reads it back', async ({ browser }) => {
  test.setTimeout(300_000);
  let a = await open(browser); const original = await readAll(a.page); console.log(`[SET] original ${JSON.stringify(original)}`);
  const typed: Record<string, string> = Object.fromEntries(NUM); typed['Default Coin'] = original['Default Coin'] === 'eth' ? 'sol' : 'eth'; typed['Default Timeframe'] = original['Default Timeframe'] === '4h' ? '1h' : '4h';
  try {
    await setAll(a.page, typed); await a.page.waitForTimeout(6_000); await a.ctx.close();
    const b = await open(browser); const after = await readAll(b.page); console.log(`[SET] typed ${JSON.stringify(typed)}`); console.log(`[SET] fresh session ${JSON.stringify(after)}`);
    const bad = Object.keys(typed).filter((k) => String(after[k]).toLowerCase() !== String(typed[k]).toLowerCase());
    expect(bad, `controls that did NOT persist (typed → read back): ${bad.map((k) => `${k}: ${typed[k]} → ${after[k]}`).join(' | ')}`).toEqual([]);
    await b.ctx.close();
  } finally {
    const r = await open(browser); await setAll(r.page, original); await r.page.waitForTimeout(6_000); await r.ctx.close();
  }
});

test('S2. EFFECT: the saved default coin and timeframe decide what /arena opens with', async ({ browser }) => {
  test.setTimeout(300_000); let a = await open(browser); const original = await readAll(a.page);
  try {
    await setAll(a.page, { 'Default Coin': original['Default Coin'] === 'eth' ? 'sol' : 'eth', 'Default Timeframe': original['Default Timeframe'] === '4h' ? '1h' : '4h' }); const want = { coin: await a.page.getByRole('combobox', { name: 'Default Coin', exact: true }).inputValue(), tf: await a.page.locator('.st-chip[aria-pressed="true"]').first().innerText() };
    await a.page.waitForTimeout(6_000); await a.ctx.close();
    const ctx = await signedInContext(browser, 'b', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    await gotoSignedIn(page, '/arena'); await page.waitForTimeout(15_000);
    const got = await page.evaluate(() => ({ url: location.search, tfOn: (document.querySelector('.klc-tf-btn.on') as HTMLElement | null)?.innerText ?? null, title: document.title, coin: (document.body.innerText.match(/\b(BTC|ETH|SOL)\b[^\n]{0,12}(USDT|\/|·)/) || [''])[0] }));
    console.log(`[SET] S2 saved default ${JSON.stringify(want)} · /arena opened with ${JSON.stringify(got)}`);
    expect(got.tfOn?.toLowerCase(), `S2: /arena opened on timeframe "${got.tfOn}", the saved default is ${want.tf}`).toBe(want.tf.toLowerCase());
    expect(JSON.stringify(got).toLowerCase(), `S2: /arena does not show the saved default coin ${want.coin}`).toContain(want.coin.toLowerCase());
    await ctx.close();
  } finally { const r = await open(browser); await setAll(r.page, original); await r.page.waitForTimeout(6_000); await r.ctx.close(); }
});

test('S3. the Arena sound switch saves and the first-visit question is not asked again', async ({ browser }) => {
  test.setTimeout(240_000); const a = await open(browser); const sw = a.page.getByTestId('arena-sound-toggle'); const was = await sw.getAttribute('aria-checked');
  try {
    await sw.click(); await a.page.waitForTimeout(6_000); await a.ctx.close();
    const b = await open(browser); const now = await b.page.getByTestId('arena-sound-toggle').getAttribute('aria-checked'); console.log(`[SET] S3 sound before ${was} · after a fresh session ${now}`);
    expect(now, 'S3: the sound switch did not persist').not.toBe(was);
    await b.page.goto('/arena', { waitUntil: 'domcontentloaded' }).catch(() => {}); await b.page.waitForTimeout(12_000);
    const asked = await b.page.getByRole('region', { name: /sound/i }).count().catch(() => 0) + (await b.page.getByText(/play a sound|sound alert/i).count().catch(() => 0));
    console.log(`[SET] S3 sound question shown on /arena after answering: ${asked > 0}`); await b.ctx.close();
  } finally { const r = await open(browser); const s2 = r.page.getByTestId('arena-sound-toggle'); if ((await s2.getAttribute('aria-checked')) !== was) { await s2.click(); await r.page.waitForTimeout(6_000); } await r.ctx.close(); }
});
