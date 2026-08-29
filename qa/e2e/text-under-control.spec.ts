import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ROUTES, gotoGuarded } from './_shared';
import { signedInContext } from './_auth';
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
 * IT SAMPLES EDGES, AND THE FIRST VERSION DID NOT. I wrote this sampling the
 * centre point - the way `layout.spec.ts` does - and flagged that as a known
 * limitation to revisit. Dev then measured the real instance and the limitation
 * was fatal, not cosmetic: the counter's centre sits 1-2px BELOW the deepest
 * point the overlay reached, so the first version read CLEAN on `fd17cbc`, the
 * commit that actually shipped the bug. See `findTextUnderControls` for the
 * numbers. A detector that passes on its own motivating example is worse than
 * no detector, because it also reports "checked".
 *
 * WHAT THIS STILL DOES NOT COVER. Five points per element - four edges and the
 * centre - not an exhaustive hit-test. An overlay clipping only a corner is
 * missed. That is a real gap and it is stated rather than fixed, because the
 * five-point version is already ~5x the hit-tests of the sweep it sits beside
 * and no measured instance yet needs more.
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

    /** True if (x, y) lies outside any clipping ancestor's visible box. */
    const clippedOut = (el: Element, x: number, y: number): boolean => {
      for (let p = el.parentElement; p; p = p.parentElement) {
        const s = getComputedStyle(p);
        if (!/auto|scroll|hidden|clip/.test(s.overflowX + ' ' + s.overflowY)) continue;
        const r = p.getBoundingClientRect();
        if (x < r.left || x > r.right || y < r.top || y > r.bottom) return true;
      }
      return false;
    };

    /** True if the element or any ancestor is fixed or sticky positioned. */
    const isFixedish = (el: Element): boolean => {
      for (let p: Element | null = el; p; p = p.parentElement) {
        const pos = getComputedStyle(p).position;
        if (pos === 'fixed' || pos === 'sticky') return true;
      }
      return false;
    };

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

      /* EDGES, NOT THE CENTRE - and the first version of this file got it wrong.
       *
       * I sampled the centre point, the way `layout.spec.ts` does, and named
       * centre-sampling as a known limitation. Dev then measured the real
       * instance on `fd17cbc` and the limitation turned out to be fatal:
       *
       *     counter top       +4.0px below the pill
       *     counter height    16.6px
       *     counter CENTRE    +12.3px
       *     overlay reached   +9 to +11px      <- covered the top ~7px
       *
       * The centre sits 1-2px BELOW the deepest point the overlay reached, so a
       * centre sample returns the counter itself and reads clean on the exact
       * commit that shipped the defect.
       *
       * The structural reason matters more than those numbers. **An overlay
       * creeps into a neighbour from one side; it does not swallow it whole.**
       * The harm in this bug class lives at an edge by construction, so a centre
       * sample is blind to the common case rather than unlucky in one instance.
       *
       * Do NOT read "it missed by 2px" as "the centre nearly worked". That gap
       * is a function of the counter's rendered height, `--fs-caption`, font
       * metrics and the panel's 0.92 scale. At a different font size the centre
       * would catch this one and miss the next.
       *
       * Inset by 2px so a probe on the boundary does not hit-test the neighbour
       * legitimately abutting it. */
      const I = 2;
      const probes: [string, number, number][] = [
        ['top',    b.left + b.width / 2, b.top + I],
        ['bottom', b.left + b.width / 2, b.bottom - I],
        ['left',   b.left + I,           b.top + b.height / 2],
        ['right',  b.right - I,          b.top + b.height / 2],
        ['centre', b.left + b.width / 2, b.top + b.height / 2],
      ];

      for (const [edge, px, py] of probes) {
        const x = Math.min(Math.max(px, 1), innerWidth - 1);
        const y = Math.min(Math.max(py, 1), innerHeight - 1);

        /* IS THE TEXT ACTUALLY PAINTED AT THIS POINT? (dev, on #391)
         *
         * `getBoundingClientRect()` reports an element's LOGICAL box even when a
         * scrollable ancestor has clipped it out of view. So a row scrolled out
         * of `overflowY: auto` still has a rect - one that can sit over unrelated
         * controls elsewhere on the page. `elementFromPoint` then correctly
         * reports a control there, and the finding is real about the coordinates
         * and false about the user: **the text is not painted there and cannot
         * be tapped there.**
         *
         * `checkVisibility()` does NOT cover this. It answers "is this element
         * displayed", not "is this POINT inside every clip between it and the
         * viewport". Those differ exactly for scrolled-out content, which is why
         * the first version passed the visibility gate and still reported it.
         *
         * dev spotted the pattern before I did: every `/funding` finding sat at
         * a `top` or `bottom` edge, which is where a clip boundary falls.
         * `app/funding/page.tsx:448` is `maxHeight: 220, overflowY: auto`. */
        if (clippedOut(el, x, y)) continue;

        const hit = document.elementFromPoint(x, y);
        if (!hit || hit === el || el.contains(hit) || hit.contains(el)) continue;

        /* The coverer must be a CONTROL. Text covered by other text is a layout
         * bug and layout.spec.ts's zero-size half is closer to it; text covered
         * by something clickable is the one that spends the user's quota. */
        const control = hit.closest(CONTROL_SELECTOR);
        if (!control) continue;

        /* CAN THE USER SCROLL IT CLEAR? (dev, on #391 - and it is the right
         * question, sharper than the one I built the detector around.)
         *
         * A `position: fixed` bottom tab bar always has page content beneath it
         * mid-scroll. That is normal, not a defect - #173 already reserves a band
         * at the document end so nothing is permanently unreachable. Reporting it
         * made the mobile sweep 29 findings of which 20 were the tab bar.
         *
         * **#389 was different in kind, and the difference is the test:** that
         * overlay was a `::after` on a button in normal flow, so it moved WITH
         * the counter and no amount of scrolling separated them. A fixed coverer
         * over in-flow text can always be scrolled clear; an in-flow coverer over
         * in-flow text never can.
         *
         * So: skip when the COVERER is fixed/sticky and the TEXT is not. If both
         * are fixed they move together and it is the #389 shape again.
         *
         * WHAT THIS GIVES UP, stated rather than hidden: a fixed overlay that
         * covers text which CANNOT be scrolled (a short page, or a modal that
         * locks the body) is now missed. That is a real gap. It is narrower than
         * the 20 false positives it removes, and unlike them it does not train
         * anyone to ignore the output. */
        if (isFixedish(control) && !isFixedish(el)) continue;

        /* FIRST HIT ONLY. Reporting every edge that overlaps would make the
         * message length depend on how deep the overhang reaches, and the same
         * one defect would read as four. The edge name is kept because it says
         * which side to shrink. */
        found.push(`${describe(el)} "${text.slice(0, 32)}" is tappable as ${describe(control)} (at its ${edge} edge)`);
        break;
      }
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

      const beforeFindings = await findTextUnderControls(page);
      const beforeSet = new Set(beforeFindings);

      await page.evaluate(() => {
        const host = document.createElement('div');
        host.style.cssText = 'position:fixed;left:40px;top:200px;z-index:9999;';
        /* THE BAIT REPRODUCES `fd17cbc`'s GEOMETRY, not a convenient version of
         * it. An overlay that swallows the caption whole is caught by a centre
         * sample too, so a fixture like that would let a centre-only detector
         * pass its own self-test - which is exactly the failure this file just
         * had. The numbers below are dev's measurements from the real commit:
         *
         *     caption top      +4px below the button
         *     caption height   ~16.6px  (centre at +12.3px)
         *     overlay reach    +9px     <- covers the top ~5px only
         *
         * So the centre of this caption is NOT covered and only its top edge is.
         * A centre-sampling probe returns clean here, and must. */
        host.innerHTML = `
          <button class="tuc-injected" style="position:relative;display:block;width:90px;height:26px">Live
            <span style="position:absolute;left:0;right:0;top:-9px;bottom:-9px"></span>
          </button>
          <span id="tuc-bait" style="display:block;width:90px;margin-top:4px;font-size:13px;line-height:16.6px">40 messages left</span>`;
        document.body.appendChild(host);
      });

      /* CONTROL ON THE FIXTURE ITSELF, and it asserts a NEGATIVE.
       *
       * Everything below only proves the detector catches this bait. It proves
       * nothing about EDGES unless the bait is genuinely edge-only - and if a
       * later refactor made the overlay swallow the caption whole, this file
       * would keep passing while silently going back to testing the easy case.
       *
       * So: measure the caption's centre point directly and require it to be
       * clean. If this fails, the fixture drifted, not the detector. */
      const centreIsClean = await page.evaluate(() => {
        const bait = document.getElementById('tuc-bait')!;
        const b = bait.getBoundingClientRect();
        const hit = document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2);
        return { clean: hit === bait, hit: hit?.tagName.toLowerCase() ?? 'null', h: Math.round(b.height) };
      });
      expect(centreIsClean.clean,
        `the injected caption's CENTRE is covered (hit ${centreIsClean.hit}, height ${centreIsClean.h}px), ` +
        `so this fixture is catchable by centre-sampling and does not test edge probing at all. ` +
        `fd17cbc covered the top ~5px of a 16.6px caption - reproduce that, not a full overlap.`)
        .toBe(true);

      const after = await findTextUnderControls(page);
      expect(after.some(f => f.includes('40 messages left')),
        `the injected caption sits under a button's overhang and the detector did not report it. ` +
        `Everything else in this file is "found nothing", so a broken detector passes silently.\n` +
        after.join('\n'))
        .toBe(true);

      /* AND IT MUST NOT HAVE STARTED REPORTING EVERYTHING. A detector that flags
       * the whole page also "catches" the injected case, so the bait passing
       * alone proves very little.
       *
       * ATTRIBUTED, NOT COUNTED, and the first version counted. It asserted
       * `after.length === before + 1`, which failed on mobile at 390px - the
       * fixed-position host lands on top of real page text there, so the
       * injected button legitimately covers a second element. That finding is
       * TRUE; it is just caused by the fixture rather than by the app.
       *
       * Loosening this to `>=` would have hidden exactly what it exists to
       * catch. Instead every new finding must be attributable to the injection -
       * either it IS the bait, or its coverer is the injected button - so a
       * detector that started flagging unrelated page elements still fails. */
      const fresh = after.filter(f => !beforeSet.has(f));
      const unattributed = fresh.filter(f =>
        !f.includes('40 messages left') && !f.includes('button.tuc-injected'));
      expect(unattributed,
        'injecting one defect produced findings that are neither the bait nor caused by the ' +
        'injected control, so the detector is reporting unrelated elements')
        .toEqual([]);
      expect(fresh.length, 'the injection produced no new findings at all').toBeGreaterThan(0);
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
    /* SIGNED IN, AND ON AN APP ROUTE. The first version did neither and hung for
     * the full 240s test timeout.
     *
     * `GrokChat` is mounted by `AppShell` (`components/AppShell.tsx:141`), which
     * does not wrap the marketing landing page - so on `/` while signed out
     * there is no `.gchat-fab` at all and Playwright's auto-wait sat on a
     * locator that was never going to resolve.
     *
     * Worth naming the failure mode rather than just fixing it: **the test did
     * not lie, it hung** - which is the better of the two outcomes, but it is
     * the same root cause as a vacuous pass. I pointed a probe at a page that
     * could not contain the thing and did not assert that it did. The explicit
     * FAB check below is what makes the difference permanent. */
    const ctx = await signedInContext(browser, 'a', {
      viewport: testInfo.project.use.viewport ?? { width: 1440, height: 900 },
    });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ }
    });
    const page = await ctx.newPage();
    page.on('dialog', d => d.dismiss());
    await installMarketFixtures(page, 'as-recorded');
    const close = () => ctx.close();

    /* PIN THE QUOTA, BECAUSE THE ELEMENT UNDER TEST IS CONDITIONAL - and the
     * first version of this test passed without it, meaninglessly.
     *
     * `GrokChat` renders the counter only when `activeRemaining !== null`
     * (`GrokChat.tsx:605`), and `activeRemaining` comes from `/api/grok` via
     * `fetchGrokUsage`. On the seeded test account that call returned nothing,
     * so `.gchat-mode-count` was never in the DOM - and a probe looking for
     * "text covered by a control" found no text, reported zero, and went green
     * on `fd17cbc`, the commit that HAD the defect.
     *
     * That is the same vacuous pass this file's self-test guards against,
     * arriving through the app's own conditional rendering rather than through
     * the detector. Nothing was broken; the thing being measured was absent.
     *
     * 10 searches / 50 messages reproduces what QA saw rendered on qa@6fe3f6c,
     * so the counter is the same width as the real one - which matters here,
     * because the whole question is what its edges touch. */
    await page.route('**/api/grok', route => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ usage: {
        deep_used: 0, deep_limit: 5, quick_used: 0, quick_limit: 20,
        chat_used: 0, chat_limit: 50, search_used: 0, search_limit: 10,
        briefing_used: 0, briefing_limit: 3,
      } }),
    }));

    try {
      await gotoGuarded(page, '/dashboard');
      await settleForGeometry(page);

      /* ASSERT THE LAUNCHER EXISTS BEFORE CLICKING IT. A missing FAB means the
       * app shell did not render or the session did not take, and clicking a
       * locator that will never resolve turns that into a 4-minute timeout
       * whose message says nothing about the cause. */
      const fabs = await page.locator('.gchat-fab').count();
      expect(fabs,
        'no .gchat-fab on /dashboard - GrokChat is mounted by AppShell, so this means the ' +
        'app shell did not render or the seeded session did not take. Nothing below is measurable.')
        .toBeGreaterThan(0);

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

      /* THE ELEMENT THIS TEST IS ABOUT MUST BE PRESENT. Everything above proves
       * the panel is open; none of it proves the counter rendered. Without this
       * the sweep below returns [] whenever the quota fails to load, which is
       * indistinguishable from "nothing covers it". */
      const counter = await page.evaluate(() => {
        const el = document.querySelector('.gchat-mode-count');
        if (!el) return null;
        const b = el.getBoundingClientRect();
        return { h: Math.round(b.height * 10) / 10, txt: (el.textContent || '').trim() };
      });
      expect(counter,
        'no .gchat-mode-count in the open panel. It renders only when /api/grok supplies a ' +
        'quota, which this test pins - so this means the route stub did not take or the ' +
        'condition at GrokChat.tsx:605 changed. The sweep below would report a clean zero ' +
        'for the wrong reason.')
        .not.toBeNull();

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
