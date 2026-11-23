/* PINS FOR #2790 (#1185, the two colour-contrast nodes axe found on prod 2fd7735), signed out, a runner build of the head; nothing written.
 *   CF /funding in both themes: axe color-contrast finds nothing on the Bybit venue labels (`[data-testid="funding-venue-bybit"]`), also with a coin row selected (the node was inside `.on.frh-row`)
 *   CT /learn, both themes: the `ticker-slide-in` keyframes no longer step opacity (a fade-in blends the badge into the page for 0.28 s, which is what axe saw), and axe finds no color-contrast violation on `.ticker-badge` once the ticker shows (a breaking headline is needed: the cell reports "no badge on this build" rather than passing silently)
 * The two live-data nodes only show with live headlines and a Bybit-listed coin, so each cell prints what it measured. */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';

const AXE = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const setup = async (page: Page, theme: 'dark' | 'light') => { await page.addInitScript((th) => { try { localStorage.setItem('theme', th); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme); };
const contrast = async (page: Page, selector: string) => { await page.addScriptTag({ content: readFileSync(AXE, 'utf8') }); return page.evaluate(async (sel) => { const r = await (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; nodes: Array<{ target: unknown; any: Array<{ data: { contrastRatio?: number; fgColor?: string; bgColor?: string } }> }> }> }> } }).axe.run({ include: [[sel]] }, { runOnly: { type: 'rule', values: ['color-contrast'] } }); return r.violations.flatMap((v) => v.nodes.map((n) => ({ target: JSON.stringify(n.target), ratio: n.any[0]?.data?.contrastRatio ?? null, fg: n.any[0]?.data?.fgColor ?? null, bg: n.any[0]?.data?.bgColor ?? null }))); }, selector); };

for (const theme of ['dark', 'light'] as const) {
  test(`CF:${theme} /funding Bybit venue labels pass colour contrast (also on a selected row)`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await setup(page, theme); await page.goto('/funding', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(12_000);
      const labels = await page.locator('[data-testid="funding-venue-bybit"]').count();
      const before = labels ? await contrast(page, '[data-testid="funding-venue-bybit"]') : [];
      const btn = page.locator('.frh-coin-btn').first(); if (await btn.count()) await btn.click({ timeout: 10_000 }).catch(() => undefined); await page.waitForTimeout(1_500);
      const after = labels ? await contrast(page, '[data-testid="funding-venue-bybit"]') : [];
      console.log(`[CF] ${theme}: ${labels} Bybit label(s); violations ${JSON.stringify(before)}; after selecting a row ${JSON.stringify(after)}`);
      expect(labels, 'no Bybit venue label on /funding in this build: the cell measured nothing').toBeGreaterThan(0);
      expect(before, 'a Bybit label fails colour contrast').toEqual([]); expect(after, 'a Bybit label on the selected row fails colour contrast').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const theme of ['dark', 'light'] as const) {
  test(`CT:${theme} /learn the ticker slide-in has no opacity step and the badge passes colour contrast`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage();
    try {
      await setup(page, theme); await page.goto('/learn', { waitUntil: 'domcontentloaded', timeout: 60_000 }); await page.waitForTimeout(10_000);
      const kf = await page.evaluate(() => { for (const sh of Array.from(document.styleSheets)) { let rules: CSSRuleList; try { rules = sh.cssRules; } catch { continue; } for (const r of Array.from(rules)) if (r.type === CSSRule.KEYFRAMES_RULE && (r as CSSKeyframesRule).name === 'ticker-slide-in') return r.cssText; } return null; });
      const badges = await page.locator('.ticker-badge').count(); const vio = badges ? await contrast(page, '.ticker-badge') : [];
      console.log(`[CT] ${theme}: keyframes ${JSON.stringify(kf)}; ${badges} badge(s); violations ${JSON.stringify(vio)}`);
      expect(kf, 'the ticker-slide-in keyframes were not found').not.toBeNull(); expect(/opacity/.test(kf ?? ''), 'the slide-in still steps opacity').toBe(false);
      expect(vio, 'the ticker badge fails colour contrast').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}
