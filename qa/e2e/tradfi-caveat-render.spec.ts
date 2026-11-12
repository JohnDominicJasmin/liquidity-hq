/* #2196 (the six held TradFi rows are shown, each with a warning, no HK price with a bare "$") and
 * #2197 (price alerts cover the main coins only).
 *
 *   T1  HK0700: the HKD warning shows, "HK$" appears, and no number printed after "HK$" also appears behind a bare "$"
 *   T1b CONTROL: NVDA's page DOES contain a bare "$<price>" - so the scan in T1 can find one
 *   T2  ANTHROPIC and OPENAI: the pre-IPO note AND the "Exchanges disagree" line both show; BTC shows neither warning
 *   T3  the canvas labels (support/resistance, structure) on HK0700 - a SHOT, because canvas text is not in the DOM
 *   A1  #2197: Set Alert is disabled on HK0700 with the sentence beside it, enabled on BTC
 *   A2  #2197: POST /api/price-alerts for hk0700 answers 400 COIN_NOT_COVERED and the list is unchanged
 *   A3  #2197: POST for btc still saves (the row is removed again)
 *
 * A4  #2197: with the alert form open on BTC, switching to HK0700 via the scanner closes the form, sends no POST
 *
 * THE SCAN IS BY NUMBER, NOT BY "NO $ ON THE PAGE": the Arena legitimately prints "$" before notional values
 * (open interest, volume - Dev left those in USD on purpose). So it takes every figure printed after "HK$" and
 * fails if the SAME figure also appears behind a bare "$". Every bare "$<digits>" on the page is logged with its
 * context so a site that is wrong but not matched is still visible. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DIR = 'qa/.shots';
const QA_LABEL = 'qa-2197';
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

async function open(page: Page, coin: string) {
  await gotoSignedIn(page, `/arena?coin=${coin}&tf=1h`);
  await page.waitForTimeout(12_000);
}
const bodyText = (page: Page) => page.evaluate(() => document.body.innerText);

test.describe('#2196 shown TradFi rows carry their warning and the right currency sign', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  const run = (name: string, fn: (page: Page) => Promise<void>) =>
    test(name, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 } });
      const page = await ctx.newPage();
      try { await installPaidAiFence(page); await fn(page); } finally { await ctx.close(); }
    });

  run('T1. HK0700 shows the HKD warning and HK$, and no HK price also appears behind a bare $', async (page) => {
    await open(page, 'hk0700');
    const text = await bodyText(page);
    const hk = [...text.matchAll(/HK\$\s?([\d,]+(?:\.\d+)?)/g)].map(m => m[1]);
    const bare = [...text.matchAll(/(?<!HK)\$\s?\d[\d,]*(?:\.\d+)?/g)].map(m => text.slice(Math.max(0, (m.index ?? 0) - 24), (m.index ?? 0) + m[0].length + 6).replace(/\s+/g, ' '));
    console.log(`[tradfi T1] HK$ figures=${JSON.stringify(hk.slice(0, 12))} bare-$ contexts=${JSON.stringify(bare.slice(0, 12))}`);
    await expect(page.getByText(/Priced in Hong Kong dollars/i).first(), 'the HKD warning is not visible').toBeVisible();
    expect(hk.length, 'no "HK$" price anywhere on the HK0700 page (price did not load, or the prefix is missing)').toBeGreaterThan(0);
    for (const n of new Set(hk)) {
      expect(new RegExp(`(?<!HK)\\$\\s?${esc(n)}`).test(text), `the figure ${n} is printed with HK$ AND with a bare $ - a surface skipped currencyPrefix`).toBe(false);
    }

    /* PM's STRICT RULE (2026-11-13): no "$" directly before a digit on the HK0700 view - EMA card, Market Structure,
       Stop Loss Zone, scanner row, chart header. The only matches allowed are notional amounts with a magnitude suffix
       ("$1.2B", "$350M"), which Dev left in USD on purpose; a PRICE never carries one. The panels are checked present
       first, so a missing panel cannot make the scan pass by seeing nothing. */
    const panels = { ema: /EMA/i.test(text), marketStructure: /market structure/i.test(text), stopLoss: /stop loss/i.test(text), scanner: /HK0700/i.test(text) };
    console.log(`[tradfi T1] panels present=${JSON.stringify(panels)}`);
    expect(panels.ema && panels.scanner, `the scan saw too little of the page to mean anything: ${JSON.stringify(panels)}`).toBe(true);
    const offenders = [...text.matchAll(/(?<!HK)\$\s?\d[\d,]*(?:\.\d+)?\s?([KMBT]\b)?/g)]
      .filter(m => !m[1])
      .map(m => text.slice(Math.max(0, (m.index ?? 0) - 40), (m.index ?? 0) + m[0].length + 10).replace(/\s+/g, ' '));
    expect(offenders, `a bare $ sits directly before a price on the HK0700 view:\n${offenders.join('\n')}`).toEqual([]);
  });

  run('T1b. CONTROL: NVDA shows a bare $ price, so the scan can find one', async (page) => {
    await open(page, 'nvda');
    const text = await bodyText(page);
    const bare = [...text.matchAll(/(?<!HK)\$\s?\d[\d,]*\.\d{2}/g)].map(m => m[0]);
    console.log(`[tradfi T1b] NVDA bare-$ prices=${JSON.stringify(bare.slice(0, 8))}`);
    expect(bare.length, 'NVDA shows no "$<price>" at all: the scan in T1 could never fail').toBeGreaterThan(0);
    await expect(page.getByText(/Priced in Hong Kong dollars/i), 'an ordinary row shows the HKD warning').toHaveCount(0);
  });

  for (const coin of ['anthropic', 'openai']) {
    run(`T2. ${coin.toUpperCase()}: the pre-IPO note and the "Exchanges disagree" line both show`, async (page) => {
      await open(page, coin);
      await expect(page.getByText(/pre-IPO price reference, not a listed share/i).first(), 'the pre-IPO note is missing').toBeVisible();
      await expect(page.getByText(/Exchanges disagree on this price/i).first(), 'the disputed-price warning is missing').toBeVisible();
      await expect(page.getByText(/Priced in Hong Kong dollars/i), 'a disputed row shows the HKD warning').toHaveCount(0);
    });
  }

  run('T2b. BTC shows neither warning', async (page) => {
    await open(page, 'btc');
    await expect(page.getByText(/Exchanges disagree on this price|Priced in Hong Kong dollars/i)).toHaveCount(0);
  });

  run('T3. canvas labels on HK0700 (shot: canvas text is not in the DOM)', async (page) => {
    await open(page, 'hk0700');
    mkdirSync(DIR, { recursive: true });
    await page.screenshot({ path: `${DIR}/tradfi-hk0700-canvas.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/@/')], maskColor: '#000000' });
  });
});

test.describe('#2197 price alerts cover the main coins only', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  const alertCall = (page: Page, method: string, body?: object, query = '') => page.evaluate(async ({ method, body, query }) => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    const res = await fetch('/api/price-alerts' + query, {
      method, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      ...(body ? { body: JSON.stringify(body) } : {}),
    });
    let json: unknown = null; try { json = await res.json(); } catch { /* none */ }
    return { status: res.status, json: json as Record<string, unknown> | null };
  }, { method, body, query });

  const run = (name: string, fn: (page: Page) => Promise<void>) =>
    test(name, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 } });
      const page = await ctx.newPage();
      try { await installPaidAiFence(page); await fn(page); } finally { await ctx.close(); }
    });

  run('A1. Set Alert is disabled on HK0700 with the sentence beside it, and enabled on BTC', async (page) => {
    await open(page, 'hk0700');
    const btn = page.getByRole('button', { name: /^Set Alert$/i }).first();
    await expect(btn, 'Set Alert is not disabled on a non-main coin').toBeDisabled();
    await expect(page.getByTestId('alert-main-coins-only')).toContainText('Price alerts cover the main coins only.');
    await open(page, 'btc');
    await expect(page.getByRole('button', { name: /^Set Alert$/i }).first(), 'Set Alert is disabled on BTC').toBeEnabled();
    await expect(page.getByTestId('alert-main-coins-only')).toHaveCount(0);
  });

  run('A2. POST for hk0700 answers 400 COIN_NOT_COVERED and the list is unchanged', async (page) => {
    await gotoSignedIn(page, '/arena');
    const before = await alertCall(page, 'GET');
    const res = await alertCall(page, 'POST', { coin: 'hk0700', target_price: 123.45, direction: 'above' });
    const after = await alertCall(page, 'GET');
    const n = (r: typeof before) => ((r.json as { alerts?: unknown[] } | null)?.alerts ?? []).length;
    console.log(`[alerts A2] status=${res.status} error=${String(res.json?.error)} listBefore=${n(before)} listAfter=${n(after)}`);
    expect(res.status).toBe(400);
    expect(res.json?.error).toBe('COIN_NOT_COVERED');
    expect(n(after), 'a row was created for a non-main coin').toBe(n(before));
  });

  run('A4. with the alert form open on BTC, switching to HK0700 closes the form and no alert request is sent', async (page) => {
    await open(page, 'btc');
    let posts = 0;
    await page.route('**/api/price-alerts', (route) => {
      if (route.request().method() === 'POST') posts += 1;
      return route.fallback();
    });
    await page.getByRole('button', { name: /^Set Alert$/i }).first().click();
    const cancel = page.getByRole('button', { name: /^Cancel$/i }).first();
    await expect(cancel, 'the alert form did not open on BTC, so there is nothing to close').toBeVisible({ timeout: 10_000 });

    /* Drive the scanner: it opens on hover, filters by the search box, and each row has a stable test id. */
    await page.getByTestId('scanner-trigger').hover();
    const search = page.locator('input.clipped-row-search').first();
    await expect(search, 'the scanner flyout did not open').toBeVisible({ timeout: 10_000 });
    await search.fill('hk0700');
    await page.getByTestId('scanner-row-hk0700').click({ timeout: 10_000 });
    await page.waitForTimeout(2_000);

    await expect(page.getByText(/Priced in Hong Kong dollars/i).first(), 'the switch to HK0700 did not happen').toBeVisible({ timeout: 10_000 });
    await expect(cancel, 'the alert form is still open on a non-main coin').toBeHidden();
    await expect(page.getByRole('button', { name: /^Set Alert$/i }).first()).toBeDisabled();
    expect(posts, 'an alert request was sent while switching').toBe(0);
  });

  run('A3. POST for btc still saves, and the row is deactivated again (the DELETE is asserted, not assumed)', async (page) => {
    await gotoSignedIn(page, '/arena');
    const res = await alertCall(page, 'POST', { coin: 'btc', target_price: 1234.56, direction: 'below', label: QA_LABEL });
    console.log(`[alerts A3] status=${res.status} body=${JSON.stringify(res.json).slice(0, 160)}`);
    const id = (res.json as { alert?: { id?: string | number }; id?: string | number } | null)?.alert?.id ?? (res.json as { id?: string | number } | null)?.id;
    expect(res.status, 'BTC no longer saves (or the fixture account is at its active-alert cap - see the logged body)').toBeLessThan(300);
    expect(id, 'the POST answered without an alert id, so the row cannot be removed').toBeDefined();
    const del = await alertCall(page, 'DELETE', undefined, `?id=${encodeURIComponent(String(id))}`);
    console.log(`[alerts A3] DELETE status=${del.status} body=${JSON.stringify(del.json)}`);
    expect(del.status, 'the cleanup DELETE failed - the qa-2197 row is still active on the dev database').toBe(200);
  });

  /* SAFETY NET: whatever a cell above left behind (a failed DELETE, a retried cell, a cancelled run) is swept here. Only rows this
     spec creates - label QA_LABEL - on the fixture account the spec signed in as. The route's DELETE deactivates the row. */
  test.afterAll(async ({ browser }) => {
    if (!AUTH_READY) return;
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    try {
      await gotoSignedIn(page, '/arena');
      const list = await alertCall(page, 'GET');
      const rows = ((list.json as { alerts?: Array<{ id: string | number; label?: string | null; active?: boolean }> } | null)?.alerts ?? [])
        .filter(a => a.label === QA_LABEL && a.active !== false);
      let swept = 0;
      for (const r of rows) { const d = await alertCall(page, 'DELETE', undefined, `?id=${encodeURIComponent(String(r.id))}`); if (d.status === 200) swept += 1; }
      console.log(`[alerts cleanup] leftover ${QA_LABEL} rows found=${rows.length} deactivated=${swept}`);
    } finally { await ctx.close(); }
  });
});
