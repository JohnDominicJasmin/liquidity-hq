/* SETTLE BEFORE ANY VISUAL SHOT (PM, 2026-11-17: a mid-render capture of / at 768 dark reached sign-off as if it were the steady state).
 * Fonts loaded, no running finite CSS animation or transition, and the page height unchanged across three samples 400 ms apart.
 * Gives up after 12 s and SAYS SO in the run log instead of shooting silently. */
import type { Page } from '@playwright/test';

export async function settleForShot(page: Page, label = 'shot'): Promise<void> {
  await page.evaluate(() => (document as unknown as { fonts?: { ready: Promise<unknown> } }).fonts?.ready).catch(() => {});
  const t0 = Date.now(); let last = -1; let stable = 0;
  while (Date.now() - t0 < 12_000) {
    const m = await page.evaluate(() => ({
      h: document.documentElement.scrollHeight,
      running: document.getAnimations().filter((a) => a.playState === 'running' && a.effect && (a.effect.getTiming().iterations ?? 1) !== Infinity).length,
    })).catch(() => ({ h: -2, running: 0 }));
    if (m.h === last && m.running === 0) stable++; else stable = 0;
    last = m.h; if (stable >= 3) return;
    await page.waitForTimeout(400);
  }
  console.log(`[CELL] settle ${label}: not stable after 12 s (height ${last}); the shot may be mid-render`);
}
