import { test, expect, type Browser, type Page } from '@playwright/test';
import { FIXTURES, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence, assertNoUnstubbedPaidAi } from './_no-paid-ai';

/* THE STATE MATRIX THE OWNER COMMISSIONED, 2026-10-23:
 *   "check different edges either account signed in, account is free, account is pro, login, logout, or a free trial.
 *    Mobile, desktop, phone, light theme, dark theme, check it. Just have multiple accounts. Free, pro, free trial."
 *
 * ── WHAT THIS ASSERTS, AND WHAT IT DELIBERATELY DOES NOT ────────────────────────────────────────────────────────
 *
 * It asserts the INVARIANTS - the things true of every state on every page, which QA can judge without asking anyone:
 *   (1) the page rendered app content rather than a loading screen, an error boundary or a cold-start placeholder;
 *   (2) it does not scroll sideways at the requested width.
 *
 * It RECORDS, without judging, the things that differ by state: whether a purchase call to action is present, whether
 * a plan or trial line appears, what the paywall says. Those are product decisions and, where they are visual, the
 * owner's sign-off under rule 8 step 5 - so a spec asserting "pro must not see a buy button" would be QA inventing a
 * product rule. The recorded table goes to him; the invariants fail the build.
 *
 * ── WIDTH IS MEASURED AS scrollWidth AGAINST THE REQUESTED VIEWPORT ─────────────────────────────────────────────
 *
 * `innerWidth` reports what we asked for, not what the page needs, so a page that overflows reports clean. A /settings
 * overflow shipped once behind exactly that mistake, which is why every cell measures
 * `document.documentElement.scrollWidth` against the width the context was created with.
 *
 * ── WHY NOT EVERY PAGE IN EVERY STATE ──────────────────────────────────────────────────────────────────────────
 *
 * Four states x two viewports x two themes x every page is 100+ cells and nobody reads 100 cells. The matrix is cut by
 * where state actually changes the render: /upgrade in every state because it is the paywall and the one surface where
 * a wrong state shows a paying customer a buy button; /arena and /dashboard across free and pro for the gating; the
 * landing page signed out only, because that is all a visitor can be.
 *
 * ── THE FENCE IS INSTALLED IN EVERY CELL ───────────────────────────────────────────────────────────────────────
 *
 * /arena and /dashboard poll usage and can trigger a read. `installPaidAiFence` refuses any paid AI route this spec has
 * not stubbed (the free usage GETs on /api/grok and /api/grok-chat pass through - see that file). Without it, a matrix
 * run across five accounts is a plausible way to spend real money on a layout check.
 *
 * ── WHAT IS NOT COVERED, NAMED RATHER THAN IMPLIED ─────────────────────────────────────────────────────────────
 *
 * `plan` is NULL on all five fixture accounts, including the Pro one (PM measured `lhq_dev_user_subscriptions`). So no
 * cell here distinguishes a $20 fortnightly from a $49 monthly or a $490 annual subscriber - what /upgrade shows
 * someone who already holds each tier, what renewal date appears, what cancellation offers. A column that is null in
 * every test account cannot fail a test. Tracked on #1630 beside "record which plan a subscriber bought"; the two must
 * not close independently.
 *
 * usage: E2E_BASE_URL=https://liquidity-hq-staging.onrender.com npx playwright test state-matrix
 *   Unset, playwright.config.ts builds and boots a local app, which measures this machine instead of the build. */

/* ONE PROJECT ONLY. The config runs every spec under `desktop` and `mobile`, which is right for a spec that inherits a
   viewport - and wrong for this one, which sets its own width per cell. Left unguarded the 60 cells become 120, half of
   them measuring 390px inside a project already pinned to an iPhone 13, so "phone" would mean two different things in
   one report. The matrix owns its viewports; it runs once. */
const ONE_PROJECT = 'desktop';

type StateId = 'out' | 'free' | 'pro' | 'trial' | 'admin';

const STATES: Array<{ id: StateId; who: 'a' | 'b' | 't' | 'admin' | null; label: string; ready: () => boolean }> = [
  { id: 'out', who: null, label: 'signed out', ready: () => true },
  { id: 'free', who: 'b', label: 'free', ready: () => !!FIXTURES.bEmail && !!FIXTURES.bPassword },
  { id: 'pro', who: 'a', label: 'pro', ready: () => !!FIXTURES.aEmail && !!FIXTURES.aPassword },
  { id: 'trial', who: 't', label: 'trial active', ready: () => !!FIXTURES.tEmail && !!FIXTURES.tPassword },
  { id: 'admin', who: 'admin', label: 'admin, trial expired', ready: () => !!FIXTURES.adminEmail && !!FIXTURES.adminPassword },
];

const PAGES: Array<{ path: string; states: StateId[] }> = [
  { path: '/', states: ['out'] },
  { path: '/upgrade', states: ['out', 'free', 'pro', 'trial', 'admin'] },
  { path: '/arena', states: ['out', 'free', 'pro', 'trial'] },
  { path: '/dashboard', states: ['free', 'pro'] },
  { path: '/settings', states: ['free', 'pro', 'trial'] },
];

const VIEWPORTS = [
  { id: 'desktop', width: 1280, height: 800 },
  { id: 'phone', width: 390, height: 844 },
];

const THEMES = ['dark', 'light'] as const;

/** What a cell records. Numbers and booleans only - no screenshots unless something fails. */
interface Cell {
  state: StateId; path: string; viewport: string; theme: string;
  scrollWidth: number; requested: number; overflowPx: number;
  rendered: boolean; textLength: number;
  purchaseCta: number; planMentions: number; trialMentions: number;
  theming: string | null;
  /** Did two samples 1.5s apart agree? Only a settled cell's state-dependent counts are reportable. */
  settled?: boolean;
}

const recorded: Cell[] = [];

async function measure(page: Page, cell: Omit<Cell, 'scrollWidth' | 'overflowPx' | 'rendered' | 'textLength' | 'purchaseCta' | 'planMentions' | 'trialMentions' | 'theming'>): Promise<Cell> {
  const m = await page.evaluate(() => {
    const text = document.body?.innerText ?? '';
    /* A purchase call to action by ROLE and accessible name, not by class or test id: the question is what a user can
       click, and a class name is an implementation detail that changes without the behaviour changing. */
    const clickable = [...document.querySelectorAll('button, a[href]')]
      .map((el) => (el.textContent ?? '').trim())
      .filter((t) => /upgrade|subscribe|buy|get pro|start.*trial|checkout|pay/i.test(t));
    return {
      scrollWidth: document.documentElement.scrollWidth,
      textLength: text.length,
      /* "Rendered" means app content, not a shell: a loading screen is short and names itself. */
      rendered: text.length > 400 && !/setting up your account|loading your session/i.test(text),
      purchaseCta: clickable.length,
      planMentions: (text.match(/\$\s?\d|per month|monthly|annual|fortnight/gi) ?? []).length,
      trialMentions: (text.match(/trial/gi) ?? []).length,
      theming: document.documentElement.getAttribute('data-theme'),
    };
  });
  return { ...cell, ...m, overflowPx: Math.max(0, m.scrollWidth - cell.requested) };
}

for (const { path, states } of PAGES) {
  for (const stateId of states) {
    const state = STATES.find((s) => s.id === stateId)!;
    for (const viewport of VIEWPORTS) {
      for (const theme of THEMES) {
        const name = `${path} · ${state.label} · ${viewport.id} ${viewport.width}px · ${theme}`;

        test(name, async ({ browser, page: plainPage }) => {
          /* ONE PROJECT. The config runs every spec under `desktop` and `mobile`, which is right for a spec that
             inherits a viewport and wrong for this one, which sets its own width per cell. Unguarded, 60 cells become
             120 and half of them measure 390px inside a project already pinned to an iPhone 13 - so "phone" would mean
             two different things in one report. */
          test.skip(test.info().project.name !== ONE_PROJECT,
            `the matrix sets its own viewports, so it runs under the ${ONE_PROJECT} project only`);

          /* A state we have no credentials for SKIPS with the state named, rather than quietly measuring a signed-out
             page and reporting it as that state - which would be the instrument answering a different question. */
          test.skip(!state.ready(), `no credentials for the '${state.label}' account`);

          let page = plainPage;
          let ctx: Awaited<ReturnType<Browser['newContext']>> | null = null;

          if (state.who) {
            ctx = await signedInContext(browser, state.who, { viewport: { width: viewport.width, height: viewport.height }, theme });
            page = await ctx.newPage();
          } else {
            await page.setViewportSize({ width: viewport.width, height: viewport.height });
            await page.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private mode */ } }, theme);
          }

          await installPaidAiFence(page);

          try {
            if (state.who) await gotoSignedIn(page, path);
            else { await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3000); }

            /* MEASURED TWICE, 1.5s APART, AND THE CELL SAYS WHETHER IT SETTLED.
             *
             * The first run of this matrix reported that `/upgrade` showed a free account two purchase buttons in dark and
             * zero in light, and that `/dashboard` showed a free account 0 CTAs in dark and 2 in light. A theme cannot change
             * content - those were the SAME page caught at different render stages behind a fixed wait, with text lengths of
             * 2,223 against 1,194 on one pair and 3,319 against 286 on another. Five of twenty-two theme pairs disagreed.
             *
             * So a single sample behind a timeout is not a measurement here: entitlements resolve asynchronously and the
             * buttons appear when they land. Two samples that agree is weak evidence of a settled page; two that disagree is
             * strong evidence the number is not reportable, and the cell records which it was rather than quietly printing
             * one of them. The invariants are unaffected - overflow and the applied theme do not move once painted - so this
             * only governs what goes in the observation table. */
            const first = await measure(page, { state: stateId, path, viewport: viewport.id, theme, requested: viewport.width });
            await page.waitForTimeout(1500);
            const cell = await measure(page, { state: stateId, path, viewport: viewport.id, theme, requested: viewport.width });
            cell.settled = first.purchaseCta === cell.purchaseCta
              && first.planMentions === cell.planMentions
              && Math.abs(first.textLength - cell.textLength) <= 20;
            recorded.push(cell);
            // eslint-disable-next-line no-console
            console.log(`CELL ${JSON.stringify(cell)}`);

            /* INVARIANT 1: app content, not a shell. */
            expect(cell.rendered, `${name}: no app content rendered (${cell.textLength} chars of text) - a cell that measured a loading screen would report confident numbers about the wrong document`).toBe(true);

            /* INVARIANT 2: no sideways scroll at the requested width. Measured as scrollWidth, never innerWidth. */
            expect(cell.overflowPx, `${name}: scrollWidth ${cell.scrollWidth} against a requested ${cell.requested} - overflows by ${cell.overflowPx}px`).toBeLessThanOrEqual(1);

            /* The theme we asked for is the theme that rendered - otherwise the light pass silently measured dark. */
            expect(cell.theming, `${name}: data-theme is ${cell.theming}, so this cell did not measure the ${theme} theme`).toBe(theme);
          } finally {
            assertNoUnstubbedPaidAi(page, name);
            await ctx?.close();
          }
        });
      }
    }
  }
}

test.afterAll(() => {
  if (recorded.length === 0) return;
  /* The state-dependent observations, printed as one table for the owner's read. NOT assertions: what /upgrade should
     show a Pro account is his call, and this is the evidence he needs to make it rather than a rule QA invented. */
  // eslint-disable-next-line no-console
  console.log('\nSTATE-DEPENDENT OBSERVATIONS (for the owner; nothing here is asserted)');
  // eslint-disable-next-line no-console
  console.log('path | state | viewport | theme | purchase CTAs | price/plan mentions | trial mentions | settled?');
  for (const c of recorded) {
    // eslint-disable-next-line no-console
    console.log(`${c.path} | ${c.state} | ${c.viewport} | ${c.theme} | ${c.purchaseCta} | ${c.planMentions} | ${c.trialMentions} | ${c.settled ? 'settled' : 'UNSETTLED - not reportable'}`);
  }
});
