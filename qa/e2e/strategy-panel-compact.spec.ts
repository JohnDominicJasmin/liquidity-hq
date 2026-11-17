/* #2500 COMPACT STRATEGY PANEL: the numbers the owner asked for, measured in a browser (CI build of the PR head, or a deployed qa/staging URL).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f project=desktop -f screenshots=true -f spec=qa/e2e/strategy-panel-compact.spec.ts      (no base_url = CI builds the ref)
 * Signed in as A (Pro, saved strategy ema_stack, chips SMA + MACD on so the params box is OPEN: the tallest state) and as B (Free). Settings writes are stubbed; paid AI is fenced; nothing is pressed that spends.
 *   H1  panel height with the rail forced to 288 and to 360 px, en and ru. Asserts <= 560 at 360 (the owner's target); 288 is printed (it is the narrow band, and a number to know)
 *   V1  QUICK / DEEP / ASK AI are inside the viewport at 1280x800 with the page not scrolled (the Run row bottom <= 800, scrollTop 0), Pro and Free
 *   T1  no clipped text: every chip, chip name, label, call-box line and button has scrollWidth <= clientWidth (+1), and no chip name is cut vertically; offenders are NAMED with their text (long names may ellipsize by design: they are reported, and fail the cell, so the owner decides)
 *   C1  every indicator chip is at least 36 px tall, with 2 columns at a 360 rail
 *   S1  Free: the upsell is ONE text link (strategy-pro-callout), a second chip SWAPS the first (one pressed at a time)
 *   S2  plan being read: select and chips disabled, "Checking your plan…", no upsell, no plan note
 *   S3  settings read failed: the error state with "Try again", no chip grid; Try again brings the chips back
 *   S4  1w / 1M: the call box says the timeframe is not available (strategy-call-tf-unavailable)
 *   P1  shots of the panel at 390 / 768 / 1280, light and dark, to qa/.shots (the dispatch uploads them with screenshots=true); any email on the page is masked
 * Every cell prints [PANEL] lines so the run log is the evidence. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { installSyntheticSocket } from './_fixtures';
import { AUTH_READY, AUTH_SKIP_REASON, SUPABASE_URL, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';
import { settleForShot } from './_settle';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
const SHOTS = 'qa/.shots';
const SAVED = ['SMA', 'MACD'];
const PANEL = '.strat-panel';

async function open(browser: Browser, who: 'a' | 'b', o: { width: number; height: number; lang?: string; theme?: 'dark' | 'light'; path?: string; saved?: boolean; selection?: string[]; hold?: 'plan' | 'settingsFail'; hintDismissed?: boolean } ) {
  const ctx = await signedInContext(browser, who, { viewport: { width: o.width, height: o.height }, theme: o.theme });
  if (o.lang) await ctx.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); } catch { /* private */ } }, o.lang);
  if (o.hintDismissed) await ctx.addInitScript(() => { try { localStorage.setItem('lhq_hint_arena', '1'); } catch { /* private */ } });   // the Arena intro hint starts collapsed to its "How this page works" link
  const page = await ctx.newPage(); await installSyntheticSocket(page); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async (route) => { if (route.request().method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) }); });
  const saved = o.saved !== false;
  const patch = (r: Record<string, unknown>) => ({ ...r, ...(saved ? { arena_strategy: 'ema_stack', strategy_selection: o.selection ?? SAVED } : {}), ...(o.lang ? { language: o.lang } : {}) });
  let failSettings = o.hold === 'settingsFail';
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' });
    if (failSettings) return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'simulated failure' }) });
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) });
  });
  const held: Array<import('@playwright/test').Route> = [];
  if (o.hold === 'plan') await page.route('**/rest/v1/*user_subscriptions*', (route) => { held.push(route); });
  await gotoSignedIn(page, o.path ?? '/arena?coin=btc&tf=1h');
  await page.locator(PANEL).first().waitFor({ state: 'visible', timeout: 60_000 });
  return { ctx, page, release: () => { failSettings = false; }, held };
}

/* force the RAIL width (the panel's own width) the way the layout would give it: the panel fills whatever column it sits in */
async function setRail(page: Page, px: number) {
  await page.addStyleTag({ content: `${PANEL}{width:${px}px !important;max-width:${px}px !important;min-width:0 !important;box-sizing:border-box !important}` });
  await page.waitForTimeout(600);
}

const measure = (page: Page) => page.evaluate((sel) => {
  const panel = document.querySelector(sel) as HTMLElement | null; if (!panel) return null;
  const vis = (e: Element) => (e as HTMLElement).offsetParent !== null && (e as HTMLElement).getBoundingClientRect().width > 0;
  const chips = Array.from(panel.querySelectorAll('button.strat-ind-chip')).filter(vis) as HTMLElement[];
  const cols = new Set(chips.map((c) => Math.round(c.getBoundingClientRect().left))).size;
  const clip = (els: Element[], what: string) => els.filter(vis).filter((e) => { const h = e as HTMLElement; return h.scrollWidth > h.clientWidth + 1 || h.scrollHeight > h.clientHeight + 1; }).map((e) => `${what}: "${((e as HTMLElement).innerText || e.textContent || '').trim().slice(0, 50)}" (scroll ${(e as HTMLElement).scrollWidth}x${(e as HTMLElement).scrollHeight} > client ${(e as HTMLElement).clientWidth}x${(e as HTMLElement).clientHeight})`);
  const callLines = Array.from(panel.querySelectorAll('[data-testid="strategy-call-invalidation"],[data-testid="strategy-call-watching"],[data-testid="strategy-call-verdict"]'));
  const offenders = [
    ...clip(chips, 'chip'), ...clip(Array.from(panel.querySelectorAll('.strat-ind-name')), 'chip name'), ...clip(Array.from(panel.querySelectorAll('.strat-lbl,.strat-layer-name,.strat-count,.strat-pro-line')), 'label'),
    ...clip(callLines, 'call line'), ...clip(Array.from(panel.querySelectorAll('.strat-btn')), 'button'),
  ];
  const r = panel.getBoundingClientRect(); const actions = panel.querySelector('.strat-actions') as HTMLElement | null; const ar = actions?.getBoundingClientRect();
  return { height: Math.round(r.height), width: Math.round(r.width), chips: chips.length, chipMinH: chips.length ? Math.round(Math.min(...chips.map((c) => c.getBoundingClientRect().height))) : 0, cols,
    runBottom: ar ? Math.round(ar.bottom) : null, runTop: ar ? Math.round(ar.top) : null, scrollY: Math.round(window.scrollY), vh: window.innerHeight, offenders,
    levelsLine: ((panel.querySelector('[data-testid="strategy-call-invalidation"]') as HTMLElement | null)?.innerText ?? '').slice(0, 80) };
}, PANEL);

test.describe('#2500 compact Strategy panel', () => {
  test.describe.configure({ timeout: 240_000 });

  for (const lang of ['en', 'ru']) for (const rail of [288, 360]) {
    test(`H1 panel height with a ${rail} px rail in ${lang} (Pro, saved strategy, params box open)`, async ({ browser }) => {
      const { ctx, page } = await open(browser, 'a', { width: 1280, height: 800, lang });
      try {
        await page.waitForTimeout(6_000); await setRail(page, rail); await settleForShot(page, `panel-${lang}-${rail}`);
        const m = await measure(page); console.log(`[PANEL] H1 ${lang} rail=${rail}: height=${m?.height} width=${m?.width} chips=${m?.chips} cols=${m?.cols} chipMinH=${m?.chipMinH} levels="${m?.levelsLine}" offenders=${JSON.stringify(m?.offenders)}`);
        expect(m, 'the Strategy panel was not found').not.toBeNull();
        if (rail === 360) expect(m!.height, `panel is ${m!.height} px at a 360 px rail in ${lang}: over the 560 target`).toBeLessThanOrEqual(560);
        assertNoUnstubbedPaidAi(page, `H1 ${lang} ${rail}`);
      } finally { await ctx.close(); }
    });
  }

  /* the params box CLOSED (a strategy saved, no chip on that has parameters) versus OPEN (SMA + MACD on): both are reported, the owner's target applies to both */
  for (const lang of ['en', 'ru']) for (const rail of [288, 360]) {
    test(`H1c panel height with a ${rail} px rail in ${lang} (Pro, saved strategy, params box CLOSED)`, async ({ browser }) => {
      const { ctx, page } = await open(browser, 'a', { width: 1280, height: 800, lang, selection: [] });
      try {
        await page.waitForTimeout(6_000); await setRail(page, rail); await settleForShot(page, `panel-closed-${lang}-${rail}`);
        const m = await measure(page); console.log(`[PANEL] H1c ${lang} rail=${rail} CLOSED: height=${m?.height} width=${m?.width} chips=${m?.chips} cols=${m?.cols} chipMinH=${m?.chipMinH} offenders=${JSON.stringify(m?.offenders)}`);
        expect(m, 'the Strategy panel was not found').not.toBeNull();
        if (rail === 360) expect(m!.height, `panel (params closed) is ${m!.height} px at a 360 px rail in ${lang}: over the 560 target`).toBeLessThanOrEqual(560);
      } finally { await ctx.close(); }
    });
  }

  /* V1 runs in BOTH params states and says which: CLOSED (no chip with parameters on: what a visitor who has picked nothing sees) and OPEN (SMA + MACD on). */
  for (const who of ['a', 'b'] as const) for (const pstate of ['closed', 'open'] as const) for (const hint of ['hint shown', 'hint dismissed'] as const) test(`V1 the Run row is inside the 1280x800 viewport, unscrolled (${who === 'a' ? 'Pro' : 'Free'}, params ${pstate}, ${hint})`, async ({ browser }) => {
    const { ctx, page } = await open(browser, who, { width: 1280, height: 800, hintDismissed: hint === 'hint dismissed', ...(pstate === 'closed' ? { selection: [] } : {}) });
    try {
      await page.waitForTimeout(6_000); await settleForShot(page, `run-row-${who}`);
      const m = await measure(page); console.log(`[PANEL] V1 ${who} params=${pstate} ${hint}: runTop=${m?.runTop} runBottom=${m?.runBottom} viewport=${m?.vh} scrollY=${m?.scrollY} panelHeight=${m?.height}`);
      expect(m!.runBottom, 'the Run row (QUICK/DEEP/ASK AI) was not found').not.toBeNull();
      expect(m!.scrollY, 'the page is scrolled: the check would measure a different place').toBe(0);
      expect(m!.runBottom!, `the Run row ends at ${m!.runBottom} px, below the ${m!.vh} px viewport: the owner still has to scroll`).toBeLessThanOrEqual(m!.vh);
    } finally { await ctx.close(); }
  });

  for (const lang of ['en', 'ru']) for (const rail of [288, 360]) {
    test(`T1/C1 no clipped text and chips at least 36 px tall at a ${rail} px rail in ${lang}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, 'a', { width: 1280, height: 800, lang });
      try {
        await page.waitForTimeout(6_000); await setRail(page, rail);
        const m = await measure(page); console.log(`[PANEL] T1 ${lang} ${rail}: chips=${m?.chips} minChipH=${m?.chipMinH} columns=${m?.cols} offenders=${JSON.stringify(m?.offenders)}`);
        expect(m!.chips, 'no indicator chips rendered').toBeGreaterThan(0);
        expect(m!.chipMinH, `the shortest chip is ${m!.chipMinH} px (target 36)`).toBeGreaterThanOrEqual(36);
        if (rail >= 340) expect(m!.cols, 'chips are not in 2 columns at a 360 px rail').toBe(2);
        expect(m!.offenders, `clipped text at a ${rail} px rail in ${lang}`).toEqual([]);
      } finally { await ctx.close(); }
    });
  }

  /* OWNER DECISION (2026-11-17): on phones the Strategy panel sits DIRECTLY under the chart. At 390 and 768 nothing wide (a card) may sit between the chart's bottom edge and the panel's top edge, and the gap is small; at 1280 the panel stays in the RIGHT RAIL beside the chart. */
  for (const width of [390, 768, 1280]) test(`L1 order at ${width}: ${width < 1000 ? 'no card between the chart and the Strategy panel' : 'the panel stays in the right rail'}`, async ({ browser }) => {
    const { ctx, page } = await open(browser, 'a', { width, height: width < 500 ? 844 : width < 1000 ? 1024 : 800 });
    try {
      await page.waitForTimeout(6_000); await settleForShot(page, `order-${width}`);
      const m = await page.evaluate((sel) => {
        const chart = document.querySelector('.klc-wrap') as HTMLElement | null; const panel = document.querySelector(sel) as HTMLElement | null; if (!chart || !panel) return null;
        const c = chart.getBoundingClientRect(), p = panel.getBoundingClientRect(); const vw = innerWidth; const sy = window.scrollY;
        const between = Array.from(document.querySelectorAll('body *')).filter((e) => { const h = e as HTMLElement; if (chart.contains(h) || panel.contains(h) || h.contains(chart) || h.contains(panel)) return false; const r = h.getBoundingClientRect(); return r.width >= vw * 0.6 && r.height >= 40 && r.top >= c.bottom - 2 && r.bottom <= p.top + 2 && getComputedStyle(h).visibility !== 'hidden'; }).slice(0, 5).map((e) => { const h = e as HTMLElement; const cl = (typeof h.className === 'string' ? h.className : '').trim().split(/\s+/)[0]; return `${h.tagName.toLowerCase()}${cl ? '.' + cl : ''} ${Math.round(h.getBoundingClientRect().width)}x${Math.round(h.getBoundingClientRect().height)} "${(h.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 30)}"`; });
        return { chartTop: Math.round(c.top + sy), chartBottom: Math.round(c.bottom + sy), chartRight: Math.round(c.right), panelTop: Math.round(p.top + sy), panelLeft: Math.round(p.left), gap: Math.round(p.top - c.bottom), after: !!(chart.compareDocumentPosition(panel) & Node.DOCUMENT_POSITION_FOLLOWING), between };
      }, PANEL);
      console.log(`[PANEL] L1 ${width}: ${JSON.stringify(m)}`);
      expect(m, 'the chart or the Strategy panel was not found').not.toBeNull();
      if (width < 1000) { expect(m!.between, `a card sits between the chart and the Strategy panel at ${width}: ${JSON.stringify(m!.between)}`).toEqual([]); /* the one-line anti-chop switch (28 px + margins) now sits between the chart and the panel (#2500, owner 2026-11-17), so the allowed gap is the switch row, not 32 px */ expect(m!.gap, `the Strategy panel starts ${m!.gap} px below the chart at ${width} (expected the one-line switch row and nothing else: <= 80)`).toBeLessThanOrEqual(80); expect(m!.after).toBe(true); }
      else { expect(m!.panelLeft, `the Strategy panel is not in the right rail at ${width} (left ${m!.panelLeft} < chart right ${m!.chartRight})`).toBeGreaterThanOrEqual(m!.chartRight - 4); }
    } finally { await ctx.close(); }
  });

  test('S1 Free: ONE upsell text link, and a second chip SWAPS the first', async ({ browser }) => {
    const { ctx, page } = await open(browser, 'b', { width: 1280, height: 800, saved: false });
    try {
      await page.waitForTimeout(6_000);
      const upsell = page.locator('[data-testid="strategy-pro-callout"]'); /* #2500 / #2514: the panel's own "See Pro" line is GONE (the page carries ONE "With Pro" row instead), so the panel must carry no upsell callout */ await expect(upsell, 'the Strategy panel still carries its own Free upsell line').toHaveCount(0); console.log('[PANEL] S1 the panel carries no upsell callout (the page-level With Pro row replaces it)');
      const chips = page.locator(`${PANEL} button.strat-ind-chip`); const first = chips.nth(0), second = chips.nth(1);
      await first.click(); await expect(first).toHaveAttribute('aria-pressed', 'true'); await second.click();
      await expect(second, 'Free: the second chip must be pressed').toHaveAttribute('aria-pressed', 'true', { timeout: 5_000 }); await expect(first, 'Free: the first chip must be released (swap, one at a time)').toHaveAttribute('aria-pressed', 'false', { timeout: 5_000 });
    } finally { await ctx.close(); }
  });

  test('S2 plan being read: disabled, "Checking your plan…", no upsell, no plan note', async ({ browser }) => {
    const { ctx, page, held } = await open(browser, 'b', { width: 1280, height: 800, hold: 'plan', saved: false });
    try {
      await expect.poll(() => held.length, { timeout: 20_000, message: 'the plan read was never held: this run measures nothing' }).toBeGreaterThan(0);
      const panel = page.locator(PANEL).first();
      await expect(panel.locator('select.strat-sel')).toBeDisabled({ timeout: 10_000 });
      const chips = panel.locator('button.strat-ind-chip'); await expect(chips.first()).toBeVisible({ timeout: 15_000 });
      for (let i = 0; i < await chips.count(); i++) await expect(chips.nth(i), `chip ${i} must be disabled while the plan is read`).toBeDisabled();
      await expect(panel.getByText('Checking your plan…')).toBeVisible();
      await expect(panel.locator('[data-testid="strategy-pro-callout"]'), 'the upsell shows while the plan is unknown').toHaveCount(0);
      await expect(panel.getByText(/Defaults on free|Free limit/i), 'a plan claim shows while the plan is unknown').toHaveCount(0);
      console.log('[PANEL] S2 ok: disabled, checking note, no upsell, no plan note');
    } finally { await ctx.close(); }
  });

  test('S3 settings read failed: error state with Try again, no chips, then Try again recovers', async ({ browser }) => {
    const { ctx, page, release } = await open(browser, 'a', { width: 1280, height: 800, hold: 'settingsFail', saved: true });
    try {
      const alert = page.locator(`${PANEL} [role="alert"]`).first(); await expect(alert, 'no error state after a failed settings read').toBeVisible({ timeout: 30_000 });
      await expect(page.locator(`${PANEL} button.strat-ind-chip`)).toHaveCount(0);
      release(); await alert.getByRole('button', { name: /retry|try again/i }).click();
      await expect(page.locator(`${PANEL} button.strat-ind-chip`).first(), 'the chips did not come back after Try again').toBeVisible({ timeout: 20_000 });
      console.log('[PANEL] S3 ok: error state, no chips, recovered');
    } finally { await ctx.close(); }
  });

  for (const tf of ['1w', '1M']) test(`S4 timeframe ${tf}: the call box says it is not available`, async ({ browser }) => {
    const { ctx, page } = await open(browser, 'a', { width: 1280, height: 800, path: `/arena?coin=btc&tf=${tf}` });
    try {
      await page.waitForTimeout(6_000);
      await expect(page.locator('[data-testid="strategy-call-tf-unavailable"]').first(), `no "not available" on ${tf}`).toBeVisible({ timeout: 30_000 });
      console.log(`[PANEL] S4 ${tf}: not-available shown`);
    } finally { await ctx.close(); }
  });

  for (const theme of ['dark', 'light'] as const) for (const width of [390, 768, 1280]) {
    test(`P1 shots of the panel at ${width} ${theme}`, async ({ browser }) => {
      const { ctx, page } = await open(browser, 'a', { width, height: width < 500 ? 844 : 900, theme });
      try {
        await page.waitForTimeout(7_000); await settleForShot(page, `shot-${width}-${theme}`);
        mkdirSync(SHOTS, { recursive: true });
        await page.locator(PANEL).first().scrollIntoViewIfNeeded();
        await page.locator(PANEL).first().screenshot({ path: `${SHOTS}/panel-${width}-${theme}.png`, mask: [page.locator('text=/@/')], maskColor: '#000000' });
        await page.screenshot({ path: `${SHOTS}/arena-${width}-${theme}.png`, fullPage: false, mask: [page.locator('text=/@/')], maskColor: '#000000' });
        const m = await measure(page); console.log(`[PANEL] P1 ${width} ${theme}: height=${m?.height} width=${m?.width} offenders=${JSON.stringify(m?.offenders)}`);
      } finally { await ctx.close(); }
    });
  }
});
