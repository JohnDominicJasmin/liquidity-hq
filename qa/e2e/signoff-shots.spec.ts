/* Visual sign-off evidence for the combined group-1..4 release, captured on a GitHub runner against
 * the deployed qa site (never the owner's laptop). PM reviews the PNGs.
 *
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/signoff-shots.spec.ts \
 *     -f base_url=https://liquidity-hq-qa.onrender.com -f screenshots=true -f project=desktop
 *
 * PUBLIC ARTIFACT RULES: it is signed in as fixtures A (Pro) and B (Free), so the account email is
 * BLURRED (a stylesheet in _auth.ts) AND masked on every shot, and only /arena is shot - never an
 * account or settings page. Draw Structure is served a stubbed proposal so no AI call is billed.
 *
 * WHAT IT CANNOT PROVE: layout correctness. It produces images; PM judges them. Where a state cannot
 * be forced deterministically (the landing "N of 3 signals" partial), the spec logs what the Setup
 * row actually said instead of claiming the state. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { signedInContext, gotoSignedIn, AUTH_READY, AUTH_SKIP_REASON } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const DIR = 'qa/.shots';
const themes = ['dark', 'light'] as const;
const mask = (p: Page) => [p.locator('.tnav-drop-email'), p.locator('text=/@/')];
const shot = async (p: Page, name: string) => {
  mkdirSync(DIR, { recursive: true });
  await p.screenshot({ path: `${DIR}/${name}.png`, mask: mask(p), maskColor: '#000000' });
};
const tf = async (p: Page, label: string) => {
  const b = p.getByRole('button', { name: new RegExp(`^${label}$`) }).first();
  if (await b.count()) { await b.click({ timeout: 10_000 }).catch(() => {}); await p.waitForTimeout(6_000); return true; }
  return false;
};

test.describe('sign-off shots', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  test.describe.configure({ timeout: 180_000 });

  /* Landing hero: signed out, 4 widths x 2 themes. Logs the Setup row text so the partial state is
     reported, not assumed. */
  for (const theme of themes) {
    for (const width of [390, 768, 1024, 1280]) {
      test(`landing hero ${width}px ${theme}`, async ({ browser }) => {
        const ctx = await browser.newContext({ viewport: { width, height: width < 500 ? 844 : 900 } });
        await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t); } catch { /* private */ } }, theme);
        const p = await ctx.newPage();
        await p.goto('/', { waitUntil: 'domcontentloaded' });
        await p.locator('.lp-hero-h1').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
        await p.waitForTimeout(4_000);
        const setup = await p.evaluate(() => {
          const t = document.body.innerText.replace(/\s+/g, ' ');
          const m = t.match(/Setup[^A-Za-z]{0,6}[0-9]+[^.]{0,40}/i);
          return { setup: m ? m[0] : 'no Setup row text found', nOf3: /\d of 3 signals/i.test(t) };
        });
        console.log(`[landing ${width} ${theme}] ${JSON.stringify(setup)}`);
        await shot(p, `landing-${width}-${theme}`);
        await ctx.close();
      });
    }
  }

  /* Arena Strategy panel, Free (B) and Pro (A), both themes. */
  for (const who of ['a', 'b'] as const) {
    for (const theme of themes) {
      test(`arena strategy panel ${who === 'a' ? 'Pro' : 'Free'} ${theme}`, async ({ browser }) => {
        const ctx = await signedInContext(browser, who, { viewport: { width: 1280, height: 1000 }, theme });
        const p = await ctx.newPage();
        await installPaidAiFence(p);
        await gotoSignedIn(p, '/arena');
        await p.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 30_000 }).catch(() => {});
        await p.waitForTimeout(4_000);
        await shot(p, `strategy-${who === 'a' ? 'pro' : 'free'}-${theme}`);
        await ctx.close();
      });
    }
  }

  /* Weekly and monthly chart (Pro), with whatever note the page shows above 1d. */
  /* The timeframe buttons are labelled '1w' and '1M' (KLineProChart TFS). Matched case-SENSITIVELY and
     exactly: '1W' found nothing, and a case-insensitive '1M' would also match '1m' (one minute). */
  for (const label of ['1w', '1M']) {
    test(`arena chart ${label}`, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 1000 }, theme: 'dark' });
      const p = await ctx.newPage();
      await installPaidAiFence(p);
      await gotoSignedIn(p, '/arena');
      await p.waitForTimeout(6_000);
      const clicked = await tf(p, label);
      console.log(`[chart ${label}] timeframe button found and clicked: ${clicked}`);
      expect(clicked, `the ${label} timeframe button was not found, so nothing below was measured`).toBe(true);
      /* The ceiling note and the disabled run buttons (PM, 2026-11-12). Signals, the AI read and Draw
         Structure cover up to 1D; above it the chart is context only. Three claims: the note is
         visible, it says so, and Quick and Deep cannot be run (title "Covers up to the 1D chart ...",
         arena/page.tsx:218). */
      const note = p.getByTestId('signal-above-ceiling').first();
      await expect(note, `the above-1D note (data-testid=signal-above-ceiling) is not visible on ${label}`).toBeVisible({ timeout: 15_000 });
      await expect(note, 'the note should say the features cover up to the 1D chart').toContainText(/cover up to the 1D chart/i);
      await expect(p.locator('button.arena-quick-btn').first(), `Quick must be disabled on ${label}`).toBeDisabled();
      await expect(p.getByRole('button', { name: /Deep Research/i }).first(), `Deep must be disabled on ${label}`).toBeDisabled();
      await shot(p, `chart-${label.toLowerCase()}`);
      await ctx.close();
    });
  }

  /* Draw Structure labels, both themes, with a STUBBED proposal (nothing billed). */
  for (const theme of themes) for (const width of [1280, 390]) {
    test(`draw structure labels ${width}px ${theme}`, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width === 390 ? 844 : 1000 }, theme });
      const p = await ctx.newPage();
      await installPaidAiFence(p);
      let intercepted = 0;
      await p.route('**/api/draw-structure', async (route) => {
        intercepted += 1;
        /* THE REAL SHAPE (qa/e2e/draw-structure-labels-render.spec.ts, from lib/drawStructure.ts): every
           proposal needs `side` and `touchTimestamps`, or the route's validator drops it and the panel
           says "Could not read the chart" - which is what the first version of this shot showed, because
           it sent only type/touches/from/to. Timestamps are hour-aligned and inside the last ~200 bars
           so the lines actually land on the 1h chart. */
        const HOUR = 3_600_000;
        const t0 = Math.floor(Date.now() / HOUR) * HOUR - 120 * HOUR;
        await route.fulfill({
          status: 200, contentType: 'application/json',
          body: JSON.stringify({
            structures: ['trendline', 'channel', 'horizontal'].map((type, n) => ({
              type, side: n % 2 ? 'high' : 'low',
              touchTimestamps: [t0 + n * 10 * HOUR, t0 + (n * 10 + 30) * HOUR, t0 + (n * 10 + 60) * HOUR],
              from: { timestamp: t0 + n * 10 * HOUR, price: 100 + n },
              to: { timestamp: t0 + (n * 10 + 60) * HOUR, price: 110 + n },
            })),
          }),
        });
      });
      await gotoSignedIn(p, '/arena');
      await p.waitForTimeout(6_000);
      await tf(p, '1h');
      const btn = p.getByRole('button', { name: /Draw Structure/i }).first();
      await btn.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      console.log(`[draw structure ${width} ${theme}] button count=${await btn.count()} box=${JSON.stringify(await btn.boundingBox().catch(() => null))}`);
      if (await btn.count()) { await btn.click({ timeout: 10_000 }).catch(() => {}); await p.waitForTimeout(5_000); }
      console.log(`[draw structure ${width} ${theme}] stub intercepted ${intercepted} call(s)`);
      /* A proposal label must be on screen BEFORE the shot, otherwise the image proves nothing about
         #2165: "Could not read the chart" is a different state wearing the same screenshot. */
      await expect(p.locator('.klc-draw-item', { hasText: /Trend line/i }).first(),
        'no structure label rendered - the stub was rejected (see the response shape) or the call never fired').toBeVisible({ timeout: 15_000 });
      const sfx = width === 1280 ? '' : `-${width}`;
      await shot(p, `draw-structure${sfx}-${theme}`);
      /* THE REAL DISMISS (#2192): Escape closes the menu, the lines stay. The button shows the lines are
         still there (class "on" while proposals exist) and aria-expanded is false. */
      await p.keyboard.press('Escape');
      await expect(p.locator('.klc-draw-menu')).toBeHidden({ timeout: 5_000 });
      await expect(btn, 'the lines are gone after Escape: the button is no longer "on"').toHaveClass(/\bon\b/);
      await expect(btn).toHaveAttribute('aria-expanded', 'false');
      await p.waitForTimeout(1_500);
      await shot(p, `draw-structure-closed${sfx}-${theme}`);
      await ctx.close();
    });
  }

  /* Strategy indicator chips (#2184: full names), Pro, 390/768/1280 x both themes. The shot is the panel
     itself so a clipped or wrapped name is visible; each chip's text and overflow is also logged. */
  for (const theme of themes) for (const width of [390, 768, 1280]) {
    test(`strategy chips ${width}px ${theme}`, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: 1000 }, theme });
      const p = await ctx.newPage();
      await installPaidAiFence(p);
      await gotoSignedIn(p, '/arena');
      const panel = p.locator('.strat-panel').first();
      await panel.waitFor({ state: 'visible', timeout: 30_000 });
      await p.waitForTimeout(4_000);
      const m = await p.evaluate(() => ({
        sw: document.documentElement.scrollWidth,
        chips: Array.from(document.querySelectorAll('.strat-ind-chip')).map(c => {
          const n = c.querySelector('.strat-ind-name') as HTMLElement | null;
          return { name: (n?.textContent ?? '').trim(), clipped: !!n && n.scrollWidth > n.clientWidth + 1 };
        }),
      }));
      console.log(`[chips ${width} ${theme}] scrollWidth=${m.sw} ` + m.chips.map(c => `${c.name}${c.clipped ? '(CLIPPED)' : ''}`).join(' | '));
      expect(m.chips.length, 'no indicator chips rendered').toBeGreaterThan(0);
      await panel.scrollIntoViewIfNeeded();
      mkdirSync(DIR, { recursive: true });
      await panel.screenshot({ path: `${DIR}/chips-${width}-${theme}.png`, mask: mask(p), maskColor: '#000000' });
      await ctx.close();
    });
  }

  /* FAB gutter (#2190): the Ask AI button against the Chart Layers rows at 390 and 768, both themes. Logs every
     element inside the Strategy panel whose box intersects the FAB's box, so the 72px gutter is MEASURED, not
     eyeballed, and shoots the viewport with Chart Layers in view. */
  for (const theme of themes) for (const width of [390, 768]) {
    test(`fab gutter ${width}px ${theme}`, async ({ browser }) => {
      const ctx = await signedInContext(browser, 'a', { viewport: { width, height: 900 }, theme });
      const p = await ctx.newPage();
      await installPaidAiFence(p);
      await gotoSignedIn(p, '/arena');
      await p.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 30_000 });
      await p.waitForTimeout(4_000);
      const heading = p.getByText(/chart layers/i).first();
      await heading.scrollIntoViewIfNeeded({ timeout: 10_000 }).catch(() => {});
      await p.waitForTimeout(1_000);
      const m = await p.evaluate(() => {
        const fab = Array.from(document.querySelectorAll('button')).find(b => /ask ai/i.test(b.textContent ?? ''));
        const fr = fab?.getBoundingClientRect();
        if (!fab || !fr) return { fab: null, hits: [] as string[] };
        const hits: string[] = [];
        document.querySelectorAll('.strat-panel *').forEach(el => {
          if (el.children.length > 0 && !(el as HTMLElement).innerText) return;
          const t = (el.textContent ?? '').trim();
          if (!t || el.children.length > 0) return;
          const r = el.getBoundingClientRect();
          if (r.width && r.height && r.left < fr.right && r.right > fr.left && r.top < fr.bottom && r.bottom > fr.top) hits.push(t.slice(0, 30));
        });
        return { fab: { l: Math.round(fr.left), t: Math.round(fr.top), w: Math.round(fr.width), h: Math.round(fr.height) }, hits };
      });
      console.log(`[fab ${width} ${theme}] fab=${JSON.stringify(m.fab)} overlappingText=${JSON.stringify(m.hits)}`);
      await shot(p, `fab-gutter-${width}-${theme}`);
      await ctx.close();
    });
  }
});
