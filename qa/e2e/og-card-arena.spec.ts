/* ONE 1200x630 CAPTURE for the social share card (PM, Dev's #2748), SECOND TAKE after PM's review of the first frame: PROD liquidity-hq.com/arena, signed out, dark theme, BTC 4h, the full chart and the strategy panel in frame. Read-only (GETs only), nothing clicked except the strategy menu (a local choice), no AI read, nothing written or billed.
 * PM's rules: the strategy must DRAW zones and the panel must show levels (not "No ... found" / WAIT with nothing to watch); the whole chart and panel fit (no cut-off price label); no Ask AI float, no top nav, no "SIGNED OUT" tag, no usage counters, no news ticker, no "n/a" / "unavailable" text.
 * Two viewport variants are shot in the same run so PM can take the better one: V1 2400x1260 at device scale 0.5 and V2 1600x840 at device scale 0.75, both output 1200x630 px. The strategy is chosen by trying sr_flip, supply_demand, fvg, range_bounce, ema_stack in that order and keeping the first whose call box shows price levels and no "found" / "none" wording; every attempt's box text is printed. The spec asserts only that the chart rendered; the PNGs are the deliverable (artifact `qa-screenshots-*`, files qa/.shots/og2-v1-clean.png and og2-v2-clean.png). */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });

async function pickDrawingStrategy(page: Page): Promise<{ picked: string; attempts: string[] }> {
  const attempts: string[] = []; const menu = page.getByTestId('strategy-set-select');
  if (!(await menu.count()) || !(await menu.first().isEnabled().catch(() => false))) return { picked: '', attempts: ['menu absent or disabled'] };
  for (const v of ['sr_flip', 'supply_demand', 'fvg', 'range_bounce', 'ema_stack']) {
    const ok = await menu.first().selectOption(v).then(() => true).catch(() => false); if (!ok) { attempts.push(`${v}: not selectable`); continue; }
    await page.waitForTimeout(9_000);
    const text = ((await page.getByTestId('strategy-call-box').first().innerText().catch(() => '')) || '').replace(/\s+/g, ' ').trim();
    attempts.push(`${v}: ${text.slice(0, 200)}`);
    if (/\$\s?\d/.test(text) && !/\b(no|none)\b[^.]{0,40}\bfound\b|none found|unavailable|n\/a/i.test(text)) return { picked: v, attempts };
  }
  return { picked: '', attempts };
}

for (const v of [{ name: 'v1', w: 2400, h: 1260, dsf: 0.5 }, { name: 'v2', w: 1600, h: 840, dsf: 0.75 }]) {
  test(`OG capture ${v.name}: /arena BTC 4h, dark, ${v.w}x${v.h} at scale ${v.dsf} = 1200x630, strategy drawing zones, clean frame`, async ({ browser }) => {
    test.setTimeout(240_000);
    const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, deviceScaleFactor: v.dsf });
    await ctx.addInitScript(() => { try { localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private mode */ } });
    const page = await ctx.newPage();
    try {
      await page.goto('/arena?coin=btc&tf=4h', { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.locator('.klc-canvas').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(10_000);
      const pick = await pickDrawingStrategy(page);
      console.log(`[OG2 ${v.name}] strategy picked "${pick.picked}" · attempts ${JSON.stringify(pick.attempts)}`);
      await page.screenshot({ path: `qa/.shots/og2-${v.name}-raw.png` });
      const hidden = await page.evaluate(() => {
        const hide = (el: HTMLElement, why: string, out: string[]) => { if (el.offsetParent !== null || getComputedStyle(el).position === 'fixed') { el.style.setProperty('display', 'none', 'important'); out.push(`${why}:${(el.textContent || '').trim().slice(0, 24)}`); } };
        const out: string[] = [];
        for (const s of ['[class*="ticker" i]', '[data-testid*="ticker" i]', '[data-testid*="usage" i]', '[class*="usage" i]', '.arena-usage', '.tnav', 'header.tnav, .tnav-wrap, .app-header', '[data-testid*="ask" i]', '[class*="ask-ai" i]', '[class*="chat-fab" i]', '[class*="chatfab" i]', '[aria-label*="Ask" i][class*="fab" i]', '.tnav-session', '.session-pill']) for (const el of Array.from(document.querySelectorAll(s)) as HTMLElement[]) hide(el, s, out);
        // any fixed-position button whose text says Ask AI / Ask LiquidityAI (the floating chat button)
        for (const el of Array.from(document.querySelectorAll('button, a, div')) as HTMLElement[]) { const t = (el.textContent || '').trim(); if (t.length < 40 && /^(ask\s*(ai|liquidityai)|signed out|sign in)$/i.test(t) && (getComputedStyle(el).position === 'fixed' || /signed out/i.test(t))) hide(el, 'text', out); }
        const chart = document.querySelector('.klc-wrap') as HTMLElement | null; if (chart) chart.scrollIntoView({ block: 'start' }); window.scrollBy(0, -8);
        return out.slice(0, 14);
      });
      console.log(`[OG2 ${v.name}] hidden for the clean frame: ${JSON.stringify(hidden)}`);
      await page.waitForTimeout(2_000);
      const left = await page.evaluate(() => ({ placeholder: Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e as HTMLElement).offsetParent !== null && /(^|\W)(n\/a|unavailable|no data|signed out)(\W|$)/i.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 40)).slice(0, 6), counters: Array.from(document.querySelectorAll('body *')).filter((e) => e.children.length === 0 && (e as HTMLElement).offsetParent !== null && /\b\d+\s*\/\s*\d+\b|reads? (left|remaining)|left today|sign in to run/i.test(e.textContent || '')).map((e) => (e.textContent || '').trim().slice(0, 40)).slice(0, 6), chartBox: (() => { const c = document.querySelector('.klc-wrap') as HTMLElement | null; const r = c?.getBoundingClientRect(); return r ? { top: Math.round(r.top), bottom: Math.round(r.bottom), h: Math.round(r.height), viewportH: window.innerHeight } : null; })() }));
      console.log(`[OG2 ${v.name}] left in the clean frame: ${JSON.stringify(left)}`);
      await page.screenshot({ path: `qa/.shots/og2-${v.name}-clean.png` });
      expect(await page.locator('.klc-canvas').first().isVisible(), 'the chart did not render').toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
}
