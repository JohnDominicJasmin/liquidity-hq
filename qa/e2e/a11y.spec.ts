import { test, expect } from '@playwright/test';
import { ROUTES, BASELINE, settle, INTERACTIVE_SELECTOR } from './_shared';

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
