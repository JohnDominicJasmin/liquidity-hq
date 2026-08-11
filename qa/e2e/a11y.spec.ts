import { test, expect } from '@playwright/test';
import { ROUTES, BASELINE, settle, runAxe, INTERACTIVE_SELECTOR } from './_shared';
import { installMarketFixtures } from './_fixtures';

// Accessibility. Mixed strategy on purpose:
//   - things that currently pass (alt text, duplicate ids, lang) -> hard assert
//   - things that currently fail (tap targets, names) -> ratcheting baseline
// See qa/e2e/_shared.ts for why baselines exist and how to move them.

test.describe('accessibility', () => {
  test('every image has an alt attribute', async ({ page }) => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const bad = await page.$$eval('img:not([alt])', els =>
        els.map(e => (e.getAttribute('src') || '(no src)').slice(0, 80)));
      offenders.push(...bad.map(s => `${route}: ${s}`));
    }
    expect(offenders, 'images missing alt').toEqual([]);
  });

  test('no duplicate id attributes', async ({ page }) => {
    const offenders: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const dupes = await page.evaluate(() => {
        const seen: Record<string, number> = {};
        for (const el of Array.from(document.querySelectorAll('[id]'))) {
          seen[el.id] = (seen[el.id] || 0) + 1;
        }
        return Object.entries(seen).filter(([, n]) => n > 1).map(([id]) => id);
      });
      offenders.push(...dupes.map(d => `${route}: #${d}`));
    }
    expect(offenders, 'duplicate ids break label-for and aria-labelledby').toEqual([]);
  });

  test('html[lang] is set on every route', async ({ page }) => {
    const missing: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const lang = await page.getAttribute('html', 'lang');
      if (!lang) missing.push(route);
    }
    expect(missing).toEqual([]);
  });

  // WCAG 2.2 SC 2.5.8 Target Size (Minimum), Level AA -> 24x24 CSS px.
  // Currently 159 violations, ~85% from one shared footer component
  // (.pf-footer-bottom-link at 15px tall, .pf-footer-expand at 18px).
  test('tap targets below 24px do not increase', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'touch target sizing is a mobile concern');

    /* FIXED MARKET DATA, and this is the whole point of #263.
     *
     * This sweep counts CONTROLS, and how many controls render depends on how
     * much data arrives. Without fixtures the number moves with the live market,
     * so the baseline was a snapshot of one afternoon and any comparison against
     * it measures the market as much as the code.
     *
     * Measured on 2026-08-11 against two builds, minutes apart:
     *
     *     24e8c3b  (pre-release)   148
     *     ff9704d  (the release)   149
     *     BASELINE                 122
     *
     * The pre-release build failed identically, so the 26-count gap was drift
     * that nothing caught - and the 1-count difference between the builds is
     * inside the noise this fixes. A ratcheting baseline over an uncontrolled
     * input cannot distinguish "someone added a small control" from "more rows
     * rendered today", which is the only question it exists to answer.
     *
     * `contrast.spec.ts` and `layout.spec.ts` already do this for the same
     * reason. This one was missed.
     *
     * The baseline is NOT raised here. A controlled number has to be measured
     * first, and raising it in the same change would convert "we cannot measure
     * this reliably" into "this is the new normal" - the thing qa/STATUS.md
     * warns about for perf.spec. */
    await installMarketFixtures(page, 'as-recorded');

    const found: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const bad = await page.$$eval(INTERACTIVE_SELECTOR, els =>
        els.flatMap(el => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return [];
          const s = getComputedStyle(el);
          if (s.visibility === 'hidden' || s.display === 'none' || +s.opacity < 0.1) return [];
          const w = Math.round(r.width), h = Math.round(r.height);
          if (w >= 24 && h >= 24) return [];
          const cls = typeof el.className === 'string'
            ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
          return [`${el.tagName.toLowerCase()}${cls} ${w}x${h} "${(el.textContent || '').trim().slice(0, 24)}"`];
        }));
      found.push(...bad.map(b => `${route}  ${b}`));
    }

    testInfo.attach('tap-targets-under-24px.txt', { body: found.join('\n'), contentType: 'text/plain' });
    expect(
      found.length,
      `Tap targets under 24px went ${found.length > BASELINE.tapTargetsUnder24 ? 'UP' : 'DOWN'} ` +
      `(${BASELINE.tapTargetsUnder24} -> ${found.length}). If DOWN, lower BASELINE.tapTargetsUnder24 ` +
      `in qa/e2e/_shared.ts in this same commit. If UP, you added a control that fails WCAG 2.2 AA.`,
    ).toBeLessThanOrEqual(BASELINE.tapTargetsUnder24);
  });

  // The conformance half of the test above. Issue #46: all 122 elements the
  // ratchet tracks are <a> inside text blocks, which SC 2.5.8 exempts, so a real
  // 16x16 button appearing would move that number 122 -> 123 and go unnoticed.
  // axe-core's target-size rule models both the spacing and the inline exception
  // properly, so a real failure here is 0 -> 1. Hard assert, not a ratchet.
  test('no WCAG 2.2 SC 2.5.8 target-size violations', async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== 'mobile', 'touch target sizing is a mobile concern');

    const violations: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const found = await runAxe(page, { runOnly: ['target-size'] });
      for (const v of found) violations.push(...v.nodes.map(n => `${route}  ${n}`));
    }

    testInfo.attach('axe-target-size.txt', { body: violations.join('\n') || '(none)', contentType: 'text/plain' });
    expect(
      violations.length,
      `axe target-size violations: ${BASELINE.axeTargetSizeViolations} -> ${violations.length}.\n` +
      `Unlike tapTargetsUnder24, these are REAL SC 2.5.8 AA failures - axe has already ` +
      `applied the spacing and inline exceptions. Do not raise the baseline; file the defect.\n` +
      violations.slice(0, 10).join('\n'),
    ).toBe(BASELINE.axeTargetSizeViolations);
  });

  // Placeholder text is not an accessible name (WCAG 4.1.2).
  // Currently: /markets, /playbook, /funding search inputs + /liq select.
  test('controls without an accessible name do not increase', async ({ page }, testInfo) => {
    const found: string[] = [];
    for (const route of ROUTES) {
      await settle(page, route);
      const bad = await page.$$eval('input:not([type=hidden]),select,textarea', els =>
        els.flatMap(el => {
          const r = el.getBoundingClientRect();
          if (!r.width || !r.height) return [];
          const id = el.id;
          const labelled = (id && document.querySelector(`label[for="${CSS.escape(id)}"]`))
            || el.closest('label')
            || el.getAttribute('aria-label')
            || el.getAttribute('aria-labelledby')
            || el.getAttribute('title');
          if (labelled) return [];
          return [`${el.tagName.toLowerCase()} placeholder="${el.getAttribute('placeholder') ?? ''}"`];
        }));
      found.push(...bad.map(b => `${route}  ${b}`));
    }

    testInfo.attach('controls-without-name.txt', { body: found.join('\n'), contentType: 'text/plain' });
    expect(
      found.length,
      `Unnamed controls: ${BASELINE.controlsWithoutName} -> ${found.length}. ` +
      `Fix with a visually-hidden <label for> or aria-label. NOTE: never add aria-label ` +
      `alongside a visible <label> - it overrides the visible text and breaks voice ` +
      `control (docs/HANDOVER.md §14).`,
    ).toBeLessThanOrEqual(BASELINE.controlsWithoutName);
  });
});
