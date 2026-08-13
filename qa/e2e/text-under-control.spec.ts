import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES, gotoGuarded } from './_shared';
import { installMarketFixtures } from './_fixtures';

/* THE MIRROR OF `layout.spec.ts`, AND IT EXISTS BECAUSE THAT FILE FACES ONE WAY.
 *
 * `layout.spec.ts` asks: is an INTERACTIVE control covered by something? That
 * catches "renders but cannot be clicked". It is scoped to interactive elements
 * on the covered side, so the opposite arrangement is invisible to it:
 *
 *     an INERT element - a label, a counter, a caption - covered by a CONTROL
 *
 * Nothing is unreachable there, so the older detector correctly reports zero.
 * The harm is different in kind: you tap the words to read them and a control
 * fires instead. Nothing looks broken, and what the tap DID is off-screen.
 *
 * FOUND BY MISSING IT. Reviewing #389 on 2026-08-14 I read this arrangement out
 * of the JSX rather than measuring it - a 48px `::after` overhang on a 26px pill
 * sitting 1px above its own quota counter, so a tap on the words
 * `10 searches left` would select a mode. Switching Fast to Live changes which
 * quota the NEXT message bills, so the accidental tap spends from a different
 * pool than the user believes. I asked dev to measure it. Neither the reading
 * nor the request is a test, and both of us had a passing suite at the time.
 *
 * The `::after` hit-area trick is the general case and it is a good technique -
 * it is how you honour a 44px target without repainting a 26px control. It just
 * has a blast radius that nothing in this suite was looking at.
 *
 * WHAT THIS DOES NOT COVER. Only the text's CENTRE point is sampled, so a
 * control overlapping a caption's left edge and nothing else is missed. Centre
 * sampling is what `layout.spec.ts` does and is what keeps the sweep to one
 * hit-test per element. A four-corner probe is the obvious next step and is
 * deliberately not in the first version - measure the cheap one, then decide.
 */

const TEXT_SELECTOR = 'span, p, small, label, dd, dt, td, th, li, figcaption, time';
const CONTROL_SELECTOR = 'a, button, [role=button], [role=link], [role=tab], [role=radio], input, select';

/* Text this short is punctuation, an icon glyph or a unit suffix. Covering a
 * bullet is not the defect; covering something you would read is. Measured
 * rather than guessed: at 0 the sweep is dominated by `·`, `%` and single
 * digits from the metric rows, which are decorative and never the tap target. */
const MIN_TEXT_LENGTH = 8;

async function settleForGeometry(page: Page): Promise<void> {
  const started = Date.now();
  await page.waitForFunction(() => {
    const w = window as unknown as { __tuc?: { last: string; stable: number } };
    const sig = document.querySelectorAll('*').length + ':' + (document.body.innerText || '').length;
    w.__tuc = w.__tuc || { last: '', stable: 0 };
    if (sig === w.__tuc.last) w.__tuc.stable++; else { w.__tuc.last = sig; w.__tuc.stable = 0; }
    return w.__tuc.stable >= 6;
  }, undefined, { timeout: 20_000, polling: 300 }).catch(() => { /* fall through to the floor */ });

  const elapsed = Date.now() - started;
  if (elapsed < 3_000) await page.waitForTimeout(3_000 - elapsed);
}

async function findTextUnderControls(page: Page): Promise<string[]> {
  return page.evaluate(({ TEXT_SELECTOR, CONTROL_SELECTOR, MIN_TEXT_LENGTH }) => {
    const found: string[] = [];

    const describe = (el: Element) => {
      const cls = typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
      return `${el.tagName.toLowerCase()}${cls}`;
    };

    for (const el of document.querySelectorAll(TEXT_SELECTOR)) {
      if (!el.checkVisibility?.()) continue;

      /* Same exclusion as layout.spec.ts, same reason: an element inside an
       * `inert` subtree cannot be reached at all, so what sits on top of it is
       * not a question. GrokChat alone keeps 65 controls in a closed panel. */
      if (el.closest('[inert]')) continue;

      /* TEXT INSIDE A CONTROL IS THE POINT OF THE CONTROL. A button's own label
       * hit-tests to the button, which is correct and is not this defect. */
      if (el.closest(CONTROL_SELECTOR)) continue;

      /* Only leaf text. A wrapper `<li>` containing a `<span>` would otherwise
       * report the same overlap twice under two names, which is exactly the
       * unstable-baseline problem layout.spec.ts hit with the tab bar. */
      if (el.querySelector(TEXT_SELECTOR)) continue;

      const text = (el.textContent || '').trim();
      if (text.length < MIN_TEXT_LENGTH) continue;

      const b = el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2) continue;
      if (b.bottom < 0 || b.top > innerHeight || b.right < 0 || b.left > innerWidth) continue;

      const x = Math.min(Math.max(b.left + b.width / 2, 1), innerWidth - 1);
      const y = Math.min(Math.max(b.top + b.height / 2, 1), innerHeight - 1);
      const hit = document.elementFromPoint(x, y);
      if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;

      /* The coverer must be a CONTROL. Text covered by other text is a layout
       * bug and layout.spec.ts's zero-size half is closer to it; text covered by
       * something clickable is the one that spends the user's quota. */
      const control = hit.closest(CONTROL_SELECTOR);
      if (!control) continue;

      found.push(`${describe(el)} "${text.slice(0, 32)}" is tappable as ${describe(control)}`);
    }
    return found;
  }, { TEXT_SELECTOR, CONTROL_SELECTOR, MIN_TEXT_LENGTH });
}

test.describe('text is not silently tappable as a control', () => {
  test.describe.configure({ mode: 'serial' });

  async function preparedPage(
    browser: import('@playwright/test').Browser,
    viewport: { width: number; height: number },
  ) {
    const ctx = await browser.newContext({ viewport });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    page.on('dialog', d => d.dismiss());
    await installMarketFixtures(page, 'as-recorded');
    return { page, close: () => ctx.close() };
  }

  /* THE SELF-TEST, AND IT RUNS FIRST.
   *
   * The assertion below is "found nothing", which is also what a detector that
   * never looked returns. `qa/STATUS.md` calls this out as a standing risk and
   * this suite has produced it for real twice. So: build the #389 arrangement
   * deliberately - a control with an invisible overhang sitting over a caption -
   * and require the detector to catch it. */
  test('the detector actually detects (guards against a vacuous pass)', async ({ browser }, testInfo) => {
    const { page, close } = await preparedPage(browser, testInfo.project.use.viewport ?? { width: 1440, height: 900 });
    try {
      await gotoGuarded(page, '/');
      await settleForGeometry(page);

      const before = (await findTextUnderControls(page)).length;

      await page.evaluate(() => {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:40px;top:200px;z-index:9999;';
        /* The real shape: a small button whose ::after-equivalent overhang
         * reaches down over an inert caption 1px below it. Written as a child
         * div rather than a pseudo-element so it can be injected at runtime -
         * the hit-testing is identical, which is the property under test. */
        host.innerHTML = `
          <button style="position:relative;display:block;width:90px;height:26px">Live
            <span style="position:absolute;left:0;right:0;top:50%;transform:translateY(-50%);height:48px"></span>
          </button>
          <span id="tuc-bait" style="display:block;width:90px;font-size:11px">40 messages left</span>`;
        document.body.appendChild(host);
      });

      const after = await findTextUnderControls(page);
      expect(after.some(f => f.includes('40 messages left')),
        `the injected caption sits under a button's overhang and the detector did not report it. ` +
        `Everything else in this file is "found nothing", so a broken detector passes silently.\n` +
        after.join('\n'))
        .toBe(true);

      /* And it must not have started reporting everything. A detector that
       * flags the whole page also "catches" the injected case. */
      expect(after.length, 'injecting one defect changed the count by more than one')
        .toBe(before + 1);
    } finally {
      await close();
    }
  });

  /* THE SWEEP BELOW CANNOT SEE THIS, and that is worth its own test rather than
   * a caveat in a comment.
   *
   * Both this file and `layout.spec.ts` skip `[inert]` subtrees, because an
   * element nobody can reach is not made defective by something covering it.
   * GrokChat's panel is `inert` while closed and holds 65 controls. So the 32-
   * route sweep walks straight past the exact arrangement that prompted this
   * file - the quota counter under the mode pills' hit-area overhang.
   *
   * A detector with a blind spot the size of its own motivating example is not
   * finished. This opens the panel first, which makes the subtree live, then
   * runs the same probe against it. */
  test('the chat panel: opening it makes its text reachable, and none of it is tappable', async ({ browser }, testInfo) => {
    const { page, close } = await preparedPage(browser, testInfo.project.use.viewport ?? { width: 1440, height: 900 });
    try {
      await gotoGuarded(page, '/');
      await settleForGeometry(page);

      /* CONTROL, and it runs before the assertion. If the panel does not open,
       * the probe returns nothing and nothing reads as a pass - the same vacuous
       * green this file's self-test exists to prevent, arriving by a different
       * route. Assert the subtree is actually live before trusting a zero. */
      await page.locator('.gchat-fab').click();
      await page.locator('.gchat-panel.gchat-open').waitFor({ state: 'visible', timeout: 15_000 });
      await settleForGeometry(page);

      const live = await page.evaluate(() => {
        const panel = document.querySelector('.gchat-panel.gchat-open');
        if (!panel) return { open: false, inert: true, controls: 0 };
        return {
          open: true,
          inert: !!panel.closest('[inert]'),
          controls: panel.querySelectorAll('a,button,[role=button],[role=radio],input').length,
        };
      });

      expect(live.open, 'the chat panel did not open, so this test measured nothing').toBe(true);
      expect(live.inert,
        'the panel is still inert with the panel open, so the probe below skips all of it ' +
        'and returns a zero that means "did not look" rather than "looked and saw nothing"')
        .toBe(false);
      expect(live.controls,
        'the open panel reports no controls, so the probe has nothing to hit-test against')
        .toBeGreaterThan(2);

      const found = await findTextUnderControls(page);
      testInfo.attach('chat-panel-text-under-control.txt', {
        body: found.join('\n') || '(none)',
        contentType: 'text/plain',
      });

      expect(found,
        'Text inside the chat panel is sitting under a clickable element. The quota counter ' +
        'sits 1px below the Fast/Live pills in a column flex (gap: 1), so any hit-area ' +
        'overhang taller than about 27px reaches it - and a tap on the words then switches ' +
        'mode, changing which quota the NEXT message bills. See #389.')
        .toEqual([]);
    } finally {
      await close();
    }
  });

  test('no inert text is covered by an interactive control', async ({ browser }, testInfo) => {
    test.setTimeout(15 * 60_000);
    const { page, close } = await preparedPage(browser, testInfo.project.use.viewport ?? { width: 1440, height: 900 });
    const found: string[] = [];
    try {
      for (const route of ROUTES) {
        await gotoGuarded(page, route);
        await settleForGeometry(page);

        /* A route that renders nothing reports nothing, and nothing looks like
         * a pass. Same guard and same 50-element floor as a11y.spec.ts, which
         * calibrated it against the smallest legitimate page (88 elements). */
        const rendered = await page.evaluate(() => document.querySelectorAll('*').length);
        if (rendered < 50) {
          found.push(`${route}  UNMEASURED - only ${rendered} elements rendered`);
          continue;
        }

        for (const f of await findTextUnderControls(page)) found.push(`${route}  ${f}`);
      }

      testInfo.attach('text-under-control.txt', {
        body: found.join('\n') || '(none)',
        contentType: 'text/plain',
      });

      expect(found,
        'Text a user would read is sitting under a clickable element, so tapping the words ' +
        'fires that control instead. The usual cause is an invisible hit-area overlay ' +
        '(a ::after sized past its own box) reaching into whatever is next to it - see #389. ' +
        'Either shrink the overhang, move it to the side with room, or increase the gap.')
        .toEqual([]);
    } finally {
      await close();
    }
  });
});
