/* #1113 READ-ONLY CHECK ON PRODUCTION (signed out, GETs and one click on the "?" legend button, nothing written), at 390 and 1280:
 *   H1  /hours and /arena: the session names read "Sunday window", "US session", "Quiet hours"; none of "God Tier", "Prime" (as a session name), "Dead Zone" appears anywhere in the page text
 *   H2  the Arena header carries no "LiquidityAI · LIVE · web + X" (no "web + X" anywhere on /arena)
 *   H3  the chart "?" legend opens and explains: the up/down counts (the squeeze arrows), the A-F grade, MAX PAIN, REALIZED (and R / S)
 * Prints [H] lines with what was found. */
import { test, expect } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });
const OLD = /God Tier|Dead Zone|\bPrime\b/i;

for (const width of [390, 1280]) {
  test(`H1 /hours session names at ${width}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await page.goto('/hours', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(12_000);
      const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
      const found = ['Sunday window', 'US session', 'Quiet hours'].map((n) => `${n}: ${new RegExp(n, 'i').test(text)}`); const old = OLD.exec(text);
      console.log(`[H] H1 /hours ${width}: ${found.join(' · ')} · old names: ${old ? old[0] : 'none'}`); await page.screenshot({ path: `qa/.shots/h1-hours-${width}.png`, fullPage: true }).catch(() => {});
      /* a session name is shown when it is THE CURRENT window (lib/session.ts: God Tier = Sun 15:00-19:00 UTC), so the Sunday window cannot show on a Thursday: it is checked below with the browser clock fixed on a Sunday */
      for (const n of ['US session', 'Quiet hours']) expect(new RegExp(n, 'i').test(text), `/hours at ${width} does not show "${n}"`).toBe(true);
      expect(old, `/hours at ${width} still shows an old session name: ${old?.[0]}`).toBeNull();
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`H1b+H2+H3 /arena at ${width}: session names, no "web + X" badge, the "?" legend explains the labels`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage();
    try {
      await page.goto('/arena?coin=btc', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(14_000);
      const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' ');
      const old = OLD.exec(text), badge = /web \+ X|LiquidityAI\s*·\s*LIVE/i.exec(text);
      console.log(`[H] H1b /arena ${width}: old session names: ${old ? old[0] : 'none'} · H2 badge "LIVE · web + X": ${badge ? 'PRESENT: ' + badge[0] : 'absent'} · session names on page: ${['Sunday window', 'US session', 'Quiet hours'].filter((n) => new RegExp(n, 'i').test(text)).join(', ') || 'none shown now'}`);
      const btn = page.getByRole('button', { name: /what the chart labels mean/i }).first(); const have = await btn.count();
      console.log(`[H] H3 legend button present: ${have > 0}`); expect(have, `/arena at ${width}: no "?" legend button`).toBeGreaterThan(0);
      await btn.click(); const panel = page.getByRole('region', { name: /chart labels/i }).first(); await expect(panel, 'the legend did not open').toBeVisible({ timeout: 10_000 });
      const lt = (await panel.innerText()).replace(/\s+/g, ' '); console.log(`[H] H3 legend text (${width}): ${lt}`); await page.screenshot({ path: `qa/.shots/h3-legend-${width}.png` }).catch(() => {});
      expect(old, `/arena at ${width} shows an old session name: ${old?.[0]}`).toBeNull(); expect(badge, `/arena at ${width} still carries the "LiquidityAI · LIVE · web + X" badge`).toBeNull();
      expect(/MAX PAIN/i.test(lt), 'the legend does not explain MAX PAIN').toBe(true); expect(/REALIZED/i.test(lt), 'the legend does not explain REALIZED').toBe(true);
      expect(/A strong setup, F no clear setup|A.{0,3}F/i.test(lt), 'the legend does not explain the A-F grade').toBe(true);
      expect(/[↑↓▲▼]\s?n|long-heavy|short-heavy|squeeze/i.test(lt), 'the legend does not explain the up/down squeeze counts').toBe(true); expect(/\bR\b.*\bS\b|resistance/i.test(lt), 'the legend does not explain R / S').toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`H1c the Sunday window at ${width}: with the browser clock fixed on Sunday 16:00 UTC, /hours and /arena say "Sunday window" and never "God Tier"`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
    const page = await ctx.newPage(); await page.clock.install({ time: new Date('2026-11-22T16:00:00Z') });
    try {
      const seen: string[] = [];
      for (const path of ['/hours', '/arena?coin=btc']) {
        await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3_000); await page.clock.resume(); await page.waitForTimeout(10_000);
        const text = (await page.evaluate(() => document.body.innerText || '')).replace(/\s+/g, ' '); const sunday = /Sunday window/i.test(text), old = OLD.exec(text);
        console.log(`[H] H1c ${path} ${width} (clock Sun 16:00 UTC): "Sunday window": ${sunday} · old names: ${old ? old[0] : 'none'}`);
        if (old) { const where = await page.evaluate(() => { const out: string[] = []; for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) { const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join(' '); const attrs = ['title', 'aria-label', 'alt', 'placeholder'].map((k) => `${k}=${el.getAttribute(k) || ''}`).join(' '); if (/God Tier|Dead Zone|Prime/i.test(own + ' ' + attrs)) { const chain: string[] = []; for (let n: HTMLElement | null = el, i = 0; n && i < 4; n = n.parentElement, i++) chain.push(n.tagName.toLowerCase() + (typeof n.className === 'string' && n.className ? '.' + n.className.split(/s+/)[0] : '') + (n.dataset && n.dataset.testid ? '[' + n.dataset.testid + ']' : '')); out.push(`${chain.join(' < ')} :: own="${own.trim().slice(0, 100)}" ${attrs.slice(0, 120)}`); } } return out.slice(0, 6); }); for (const w of where) console.log(`[H] H1c WHERE ${path} ${width}: ${w}`); const i = text.search(OLD); console.log(`[H] H1c CONTEXT ${path} ${width}: ...${text.slice(Math.max(0, i - 70), i + 90)}...`); } seen.push(`${path}: ${sunday}`);
        await page.screenshot({ path: `qa/.shots/h1c-${path.replace(/[^a-z]/g, '')}-${width}.png` }).catch(() => {}); expect(old, `${path} at ${width} shows an old session name: ${old?.[0]}`).toBeNull(); expect(sunday, `${path} at ${width}: no "Sunday window" with the clock on Sunday 16:00 UTC`).toBe(true);
      }
    } finally { await ctx.close().catch(() => {}); }
  });
}
