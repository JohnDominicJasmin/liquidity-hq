/* A PROBE, NOT A GATE: WHICH ELEMENTS GROW OR ARE INSERTED WHEN /arena SHIFTS AT 360 PX IN RUSSIAN, signed in as fixture A with a saved strategy (cold: the gate's SAVED-RU 360 cell read 0.13: arena-ws pushed 141 px =
 * arena-below-chart 145 -> 230 plus 56 px above the scanner trigger).
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f spec=qa/e2e/cls-probe-360ru.spec.ts -f base_url=https://liquidity-hq-qa.onrender.com -f project=desktop
 * A ResizeObserver on every element under <main> (new ones are picked up as they are inserted) logs each element whose HEIGHT changed by 8 px or more after 0.8 s: [GROW] t, element (tag.classes[testid] "text"), from -> to, top;
 * a MutationObserver logs every inserted element taller than 10 px with its parent: [ADD]. Three loads. Reads only (settings writes stubbed; the settings read patched for ema_stack and language ru). */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.describe('360 px Russian growth probe', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON); test.describe.configure({ timeout: 300_000, retries: 0 });
  test('which elements grow or are inserted', async ({ browser }) => {
    for (let run = 1; run <= 3; run++) {
      const ctx = await signedInContext(browser, 'a');
      await ctx.addInitScript(() => {
        try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('lhq_lang_v1', 'ru'); } catch { /* private */ }
        const w = window as unknown as { __g: string[] }; w.__g = []; const t0 = performance.now(); const seen = new WeakMap<Element, number>();
        const d = (el: Element) => { const e = el as HTMLElement; const c = (typeof e.className === 'string' ? e.className : '').split(/\s+/).filter(Boolean).slice(0, 2).join('.'); const id = e.getAttribute('data-testid'); return `${e.tagName.toLowerCase()}${c ? '.' + c : ''}${id ? '[' + id + ']' : ''} "${(e.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 26)}"`; };
        const ro = new ResizeObserver((es) => { for (const e of es) { const h = Math.round(e.contentRect.height); const p = seen.get(e.target); seen.set(e.target, h); const t = Math.round(performance.now() - t0); if (p !== undefined && Math.abs(h - p) >= 8 && t > 800) w.__g.push(`[GROW] ${t}ms ${d(e.target)} ${p} -> ${h} top ${Math.round(e.target.getBoundingClientRect().top + scrollY)}`); } });
        const watch = (n: Node) => { if (n.nodeType !== 1) return; const el = n as Element; if (!el.closest('main, .arena-term-wrap')) return; ro.observe(el); el.querySelectorAll('*').forEach((c) => ro.observe(c)); };
        new MutationObserver((ms) => { for (const m of ms) for (const n of Array.from(m.addedNodes)) { watch(n); if (n.nodeType === 1 && performance.now() - t0 > 800) { const b = (n as HTMLElement).getBoundingClientRect(); if (b.height > 10 && !(n as Element).closest('svg,.gchat-panel,.gchat-fab')) w.__g.push(`[ADD] ${Math.round(performance.now() - t0)}ms ${d(n as Element)} h${Math.round(b.height)} top ${Math.round(b.top + scrollY)} in ${(m.target as HTMLElement).tagName.toLowerCase()}.${String((m.target as HTMLElement).className).split(/\s+/)[0]}`); } } }).observe(document, { childList: true, subtree: true });
      });
      const page = await ctx.newPage(); await page.setViewportSize({ width: 360, height: 844 }); await installPaidAiFence(page);
      await page.route(/\/api\/settings(\?|$)/, async route => { const q = route.request(); if (q.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) }); });
      await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => { if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, arena_strategy: 'ema_stack', language: 'ru' }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) }); });
      try {
        await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(10_000);
        const g = await page.evaluate(() => (window as unknown as { __g: string[] }).__g);
        for (const x of g.slice(0, 60)) console.log(`[G360] load ${run} ${x}`); console.log(`[G360] load ${run} done: ${g.length} lines`);
      } finally { await ctx.close(); }
    }
  });
});
