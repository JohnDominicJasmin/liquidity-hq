import { test, expect, type Page, type Browser } from '@playwright/test';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';

/* #1347 item 4 (#1365, fix by Dev Team) - a read computed for one indicator
 * selection kept being SHOWN after the trader changed the selection, and only
 * one of the places that show it said so. The audit found the stale result in
 * four places; #1365 covers three and leaves one on purpose:
 *
 *   1. the signal card's banner         - already marked before #1365 (baseline)
 *   2. the reasoning / chart-analysis / patterns block - NOW marked, same notice
 *   3. the ASK AI opening prompt        - NOW gated: a stale result is no longer
 *                                          cited as fact (`result && !selectionChanged`)
 *   4. the chart itself                 - NOT fixed, deliberately (needs a
 *                                          per-overlay marker inside the charting
 *                                          library; Dev split it out as its own change)
 *
 * READ THIS BEFORE READING A GREEN RUN: nothing below asserts anything about
 * place 4. A pass here means places 1-3 agree, not that everything the trader
 * can see is marked. The chart still renders the stale result unlabelled by
 * design, and that gap is Dev's to close in a separate PR.
 *
 * WRITTEN AGAINST THE #1365 BRANCH, NOT THE PROPOSAL WORDING. Not yet run:
 * the fix is unmerged and the machine is Dev's. Expected against `dev`/`qa`
 * without it: the "marked in both places" test is RED (only the banner exists,
 * so exactly one notice is found, not two) and the ASK AI test is RED (the
 * stale result's specifics are still cited). The baseline and order-independence
 * tests guard behaviour that must not change and should be green either way.
 *
 * NO AI CREDITS. /api/grok and /api/grok-chat are both stubbed, so the "read"
 * here is a fixed payload and the "outgoing prompt" is read off the chat
 * request body. Klines are stubbed for the same reason as
 * audit-001-item-23-24-25.spec.ts's item 24: readMarket fetches real candles
 * before it ever reaches /api/grok, and real-network variance there is a
 * separate source of flake unrelated to what this file measures.
 *
 * ASSERTED BY LABEL KEY, NOT BY RENDERED ENGLISH. The stale notice's wording is
 * read from /api/labels (ARENA_STALE_SELECTION_PRE) rather than typed here, and
 * the ASK AI prompt is identified by the fixed payload's own marker token, which
 * is locale-invariant. A copy edit to either label cannot silently turn these
 * into passing-for-the-wrong-reason.
 */

test.skip(!AUTH_READY, AUTH_SKIP_REASON);

const MARKER = 'STALE-MARKER-7741';

async function resetStrategySelection(page: Page, selection: string[]) {
  const result = await page.evaluate(async (sel) => {
    const raw = Object.keys(localStorage).find(k => k.startsWith('sb-') && k.endsWith('-auth-token'));
    const token = raw ? JSON.parse(localStorage.getItem(raw)!).access_token : null;
    const res = await fetch('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ strategy_selection: sel, knownAsOf: { strategy_selection: new Date().toISOString() } }),
    });
    const body = await res.json();
    localStorage.removeItem('lhq_settings_v1');
    for (const k of Object.keys(localStorage)) {
      if (k.startsWith('lhq_settings_unconfirmed_v1')) localStorage.removeItem(k);
    }
    return { status: res.status, accepted: body.accepted as string[] | undefined };
  }, selection);
  expect(result.accepted, `strategy_selection reset was rejected by the concurrency guard: ${JSON.stringify(result)}`)
    .toContain('strategy_selection');
}

interface ChatTurn { role: string; content: string }

/** Signs in as A, stubs every AI and candle call, runs one QUICK read with
 *  `firstPick` selected, and returns once the signal card is on screen. */
async function arrangeFreshRead(browser: Browser, firstPick: string[]) {
  const ctx = await signedInContext(browser, 'a');
  const page = await ctx.newPage();
  const grokPosts: string[] = [];
  const chatBodies: Array<{ turns: ChatTurn[] }> = [];

  await page.route('**/api/grok', async route => {
    if (route.request().method() !== 'POST') {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ usage: null }) });
    }
    grokPosts.push(route.request().postData() ?? '');
    const asked = route.request().postDataJSON() as { tf?: string; session?: string };
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({
        result: {
          signal: 'LEAN BEARISH', confidence: 71, levels: [], patterns: ['Bear flag'], catalysts: [],
          chartAnalysis: `${MARKER} chart analysis`, reasoning: `${MARKER} reasoning`,
          waitFor: null, bias: null, raidSetup: null, raidTarget: null, raidTrigger: null,
          analyzedAt: Date.now(), tf: asked.tf ?? '15m', session: asked.session ?? 'London',
        },
        usage: null,
      }),
    });
  });
  await page.route('**/api/grok-chat', route => {
    const body = route.request().postDataJSON() as { messages?: ChatTurn[]; input?: ChatTurn[] };
    chatBodies.push({ turns: body?.messages ?? body?.input ?? [] });
    return route.fulfill({
      status: 200, contentType: 'application/json',
      body: JSON.stringify({ choices: [{ message: { content: 'stubbed reply' } }] }),
    });
  });
  const fakeCandle = (i: number) => [Date.now() - (300 - i) * 60_000, 100, 101, 99, 100.5, 10];
  await page.route('**/api/market/klines**', route =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(Array.from({ length: 300 }, (_, i) => fakeCandle(i))) }),
  );

  await gotoSignedIn(page, '/about');
  await resetStrategySelection(page, []);
  await page.goto('/arena');

  await page.locator('select.strat-sel').selectOption('custom');
  for (const name of firstPick) {
    const chip = page.locator('button.strat-chip', { hasText: name });
    await chip.click();
    await expect(chip).toHaveAttribute('aria-pressed', 'true');
  }

  const quickBtn = page.getByRole('button', { name: 'QUICK', exact: true });
  await expect(quickBtn).toBeVisible({ timeout: 15_000 });
  await quickBtn.click();
  await expect.poll(() => grokPosts.length, { message: 'QUICK never reached the stubbed /api/grok', timeout: 20_000 }).toBe(1);
  await expect(page.locator('.arena-signal-card'), 'the signal card never rendered from the stubbed read - this run measured nothing')
    .toBeVisible({ timeout: 20_000 });
  await expect(quickBtn).toBeEnabled({ timeout: 20_000 });

  const labels = await (await page.request.get('/api/labels?locale=en')).json() as Record<string, string>;
  const stalePre = labels.ARENA_STALE_SELECTION_PRE;
  expect(stalePre, 'ARENA_STALE_SELECTION_PRE is missing from /api/labels - cannot identify the stale notice by key').toBeTruthy();
  const noResultPrefix = (labels.ARENA_CHAT_PROMPT_NO_RESULT ?? '').split('{')[0];
  expect(noResultPrefix, 'ARENA_CHAT_PROMPT_NO_RESULT is missing from /api/labels').toBeTruthy();

  const staleNotices = page.locator('.arena-override-notice').filter({ hasText: stalePre });
  const staleInCard = page.locator('.arena-signal-card .arena-override-notice').filter({ hasText: stalePre });

  const askAi = async (): Promise<{ userPrompt: string; systemMsg: string }> => {
    const before = chatBodies.length;
    await page.getByRole('button', { name: 'ASK AI', exact: true }).click();
    await expect.poll(() => chatBodies.length, {
      message: 'ASK AI never produced a /api/grok-chat request', timeout: 10_000,
    }).toBeGreaterThan(before);
    const turns = chatBodies[chatBodies.length - 1].turns;
    return {
      userPrompt: [...turns].reverse().find(t => t.role === 'user')?.content ?? '',
      systemMsg: turns.find(t => t.role === 'system')?.content ?? '',
    };
  };

  return { ctx, page, grokPosts, staleNotices, staleInCard, noResultPrefix, askAi };
}

test.describe('A read computed for a different selection is marked wherever it is shown, and not cited as fact (#1347 item 4)', () => {
  test('BASELINE: an unchanged selection shows no stale notice anywhere, and ASK AI still cites the read', async ({ browser }) => {
    const { ctx, staleNotices, askAi } = await arrangeFreshRead(browser, ['EMA Ribbon']);
    try {
      await expect(staleNotices, 'a stale notice appeared although the selection has not changed since the read - the non-stale path regressed').toHaveCount(0);

      const { userPrompt } = await askAi();
      expect(userPrompt, `ASK AI must still cite the read when the selection is unchanged (it carries ${MARKER} in its reasoning) - ` +
        'tightening the condition to `result && !selectionChanged` must not have broken the ordinary case').toContain(MARKER);
    } finally {
      await ctx.close();
    }
  });

  test('a stale read is marked in BOTH the signal card and the reasoning block', async ({ browser }) => {
    const { ctx, page, staleNotices, staleInCard } = await arrangeFreshRead(browser, ['EMA Ribbon']);
    try {
      // Change the selection WITHOUT re-running - the read on screen is now
      // computed for a selection the trader no longer has.
      await page.locator('button.strat-chip', { hasText: 'EMA Ribbon' }).click();
      const smaChip = page.locator('button.strat-chip', { hasText: 'SMA' });
      await smaChip.click();
      await expect(smaChip).toHaveAttribute('aria-pressed', 'true');

      await expect(staleInCard, 'place 1 (baseline): the signal card banner must mark the stale read - it did before #1365 and must still').toHaveCount(1);
      await expect(staleNotices,
        'place 2: the reasoning / chart-analysis / patterns block must carry the same stale notice as the signal card. ' +
        'Exactly ONE notice found means only the banner exists - the block #1365 exists to fix is still unmarked.').toHaveCount(2);
    } finally {
      await ctx.close();
    }
  });

  test('ASK AI does not cite a stale read, and still carries the CURRENT selection', async ({ browser }) => {
    const { ctx, page, noResultPrefix, askAi } = await arrangeFreshRead(browser, ['EMA Ribbon']);
    try {
      await page.locator('button.strat-chip', { hasText: 'EMA Ribbon' }).click();
      const smaChip = page.locator('button.strat-chip', { hasText: 'SMA' });
      await smaChip.click();
      await expect(smaChip).toHaveAttribute('aria-pressed', 'true');

      const { userPrompt, systemMsg } = await askAi();

      expect(userPrompt, 'place 3: the ASK AI prompt cited the stale read as fact (its reasoning marker is present) - ' +
        'one message asserting the old selection\'s conclusion beside the current selection, the audit\'s worst case').not.toContain(MARKER);
      expect(userPrompt, 'the stale read\'s signal must not be cited either').not.toContain('LEAN BEARISH');
      expect(userPrompt, 'a stale read must be treated exactly like no read at all: expected the ARENA_CHAT_PROMPT_NO_RESULT wording ' +
        `(starts "${noResultPrefix.trim()}...") - Quick/Deep are one click away for a fresh read`).toContain(noResultPrefix);
      expect(systemMsg, 'the CURRENT selection (SMA) must still reach the chat - not citing the stale read must not drop the live selection').toContain('SMA');
    } finally {
      await ctx.close();
    }
  });

  test('re-selecting the same indicators in a different order is NOT a change - no notice', async ({ browser }) => {
    const { ctx, page, staleNotices } = await arrangeFreshRead(browser, ['EMA Ribbon', 'SMA']);
    try {
      const ema = page.locator('button.strat-chip', { hasText: 'EMA Ribbon' });
      const sma = page.locator('button.strat-chip', { hasText: 'SMA' });
      await ema.click();
      await sma.click();
      await expect(ema).toHaveAttribute('aria-pressed', 'false');
      await expect(sma).toHaveAttribute('aria-pressed', 'false');
      // Same two indicators, opposite click order.
      await sma.click();
      await ema.click();
      await expect(sma).toHaveAttribute('aria-pressed', 'true');
      await expect(ema).toHaveAttribute('aria-pressed', 'true');

      await expect(staleNotices,
        'order-independent comparison regressed: the same indicators picked in a different click order was reported as a changed selection').toHaveCount(0);
    } finally {
      await ctx.close();
    }
  });
});
