import { test, expect } from '@playwright/test';
import { ROUTES, settle } from './_shared';

// Horizontal overflow is currently ZERO across all 32 routes at both 1440px
// and 375px (audit §3.1). That is a real, hard-won property - commit 0bf7305
// fixed the mobile pass - so this is a strict assertion, not a baseline.
// If it ever fails, something regressed today.

test.describe('responsive', () => {
  for (const route of ROUTES) {
    test(`${route} has no horizontal overflow`, async ({ page }, testInfo) => {
      await settle(page, route);

      const overflow = await page.evaluate(() => {
        const de = document.documentElement;
        if (de.scrollWidth <= window.innerWidth + 1) return null;
        const culprits: Array<{ sel: string; right: number; text: string }> = [];
        for (const el of Array.from(document.querySelectorAll('body *'))) {
          const r = el.getBoundingClientRect();
          if (r.right > window.innerWidth + 1 && r.width > 8) {
            const s = getComputedStyle(el);
            if (s.display === 'none' || s.visibility === 'hidden') continue;
            const cls = typeof el.className === 'string'
              ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '';
            culprits.push({
              sel: `${el.tagName.toLowerCase()}${el.id ? '#' + el.id : ''}${cls}`,
              right: Math.round(r.right),
              text: (el.textContent || '').trim().slice(0, 40),
            });
          }
        }
        return { scrollWidth: de.scrollWidth, innerWidth: window.innerWidth, culprits: culprits.slice(0, 5) };
      });

      expect(
        overflow,
        overflow
          ? `${route} overflows by ${overflow.scrollWidth - overflow.innerWidth}px at ` +
            `${testInfo.project.name}. Widest offenders: ` +
            overflow.culprits.map(c => `${c.sel} (right:${c.right}px "${c.text}")`).join(', ')
          : '',
      ).toBeNull();
    });
  }

  test('viewport meta is present and correct', async ({ page }) => {
    await settle(page, '/');
    const v = await page.getAttribute('meta[name="viewport"]', 'content');
    expect(v).toContain('width=device-width');
    // A fixed maximum-scale or user-scalable=no would fail WCAG 1.4.4.
    expect(v ?? '').not.toMatch(/user-scalable\s*=\s*no|maximum-scale\s*=\s*1/);
  });
});
