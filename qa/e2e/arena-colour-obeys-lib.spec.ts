import { test, expect } from '@playwright/test';
import { CONVERTED_ROUTES } from './_design-tokens';
import { TERMINAL_COLORS } from '@/lib/terminalTokens';
import { evidencePaint } from '@/lib/arenaColour';

/* Does the RENDERED evidence list obey `lib/arenaColour.ts`?
 *
 * Dev's unit tests prove the RULE is right — a positive value that did not fire
 * renders `--txt`, an inactive penalty is `--txt3` not green, RSI 50 is neutral
 * because the band is 57/43. 124 lines of them, and they pass.
 *
 * **They do not prove the COMPONENT calls it.** `ArenaTerminal.tsx` could import
 * `evidencePaint` and hardcode a colour in one branch, and every one of those
 * tests still passes. That is not hypothetical — it is the shape of the paywall
 * leak, where the component was correct and its call site was not.
 *
 * So this asserts the join: for every row, the colour on screen equals what
 * `evidencePaint` returns for the input the component actually used. Dev added
 * `data-fire` for exactly this, so the input is readable rather than inferred.
 *
 * WHY NOT JUST COUNT COLOURED ROWS. Criterion 12 says "exactly 2 of the rows
 * carry colour", and a count passes when the WRONG two are coloured. It cannot
 * fail when the rule inverts, only when the arithmetic changes — and inverting
 * the rule is the defect this screen is most likely to have, because green on a
 * positive number looks better and is a legal palette token.
 */

const ARENA = '/arena';

/** `var(--green)` → the literal hex the browser computes, for comparison. */
function resolve(token: string): string {
  const name = token.replace(/^var\(|\)$/g, '');
  const hex = (TERMINAL_COLORS as Record<string, string>)[name];
  if (!hex) throw new Error(`no hex for ${name} in terminalTokens — the token set moved under this spec`);
  return hex.toLowerCase();
}

function rgbToHex(v: string): string {
  const m = v.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
  if (!m) return v.toLowerCase();
  return '#' + [1, 2, 3].map(i => Number(m[i]).toString(16).padStart(2, '0')).join('');
}

test.describe('the rendered evidence list obeys arenaColour', () => {
  test.skip(!CONVERTED_ROUTES.includes(ARENA),
    '/arena is not in CONVERTED_ROUTES yet — arms itself in the PR that converts the screen');

  test('every row\'s colour equals evidencePaint(its own data-fire)', async ({ page }) => {
    test.setTimeout(150_000);
    await page.goto(`${ARENA}?design=terminal`, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => localStorage.setItem('lhq_analytics_consent_v1', 'denied'));
    await page.goto(`${ARENA}?design=terminal`, { waitUntil: 'domcontentloaded' });
    await page.waitForTimeout(8000);

    const rows = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.at-ev')).map(el => ({
        label: (el.querySelector('.at-ev-label') as HTMLElement)?.innerText?.trim() ?? '?',
        fire: (el as HTMLElement).dataset.fire ?? 'MISSING',
        value: (el.querySelector('.at-ev-val') as HTMLElement)?.innerText?.trim() ?? '',
        colour: getComputedStyle(el.querySelector('.at-ev-val') as Element).color,
        marker: getComputedStyle(el.querySelector('.at-ev-mark') as Element).backgroundColor,
      })));

    /* THE CONTROL. Zero rows is the answer this check is most likely to give for
     * the wrong reason — a renamed class, a screen that did not finish
     * rendering, a route that redirected. Every assertion below is a loop, and a
     * loop over nothing passes silently. */
    expect(rows.length,
      'no .at-ev rows found — the class was renamed, or the screen did not render. ' +
      'Every assertion below iterates rows and would pass vacuously at zero.',
    ).toBeGreaterThan(0);

    const wrong: string[] = [];
    for (const r of rows) {
      if (r.fire === 'MISSING') { wrong.push(`${r.label}: no data-fire attribute`); continue; }
      const fire = r.fire === 'null' ? null : (r.fire as 'green' | 'red');
      const hasValue = r.value !== '' && r.value !== '—' && r.value !== '-';
      const want = evidencePaint(fire, hasValue);
      const gotValue = rgbToHex(r.colour);
      const gotMarker = rgbToHex(r.marker);
      if (gotValue !== resolve(want.value)) {
        wrong.push(`${r.label}: fire=${r.fire} value painted ${gotValue}, lib says ${want.value} (${resolve(want.value)})`);
      }
      if (gotMarker !== resolve(want.marker)) {
        wrong.push(`${r.label}: fire=${r.fire} marker painted ${gotMarker}, lib says ${want.marker}`);
      }
    }

    expect(wrong,
      'the rendered colour disagrees with lib/arenaColour for these rows. The unit ' +
      'tests prove the rule; this proves the component obeys it — a hardcoded ' +
      'colour in one branch fails here and nowhere else.',
    ).toEqual([]);
  });
});
