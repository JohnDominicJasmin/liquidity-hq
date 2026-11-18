/* PROBE (not a gate): which direct child of the first .arena-below-chart changes height on /arena in Russian at 360 px, signed in, and when. Samples every 40 ms from document start. For Dev's #2500 RU CLS fix.
 *   gh workflow run ci.yml --ref <branch> -f e2e=true -f project=desktop -f "spec=qa/e2e/ru-below-chart-probe.spec.ts" */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
type Snap = { t: number; ws: number; kids: Array<{ k: string; h: number; top: number; txt: string }> };

for (const saved of [false, true]) {
  test(`PROBE ru 360 ${saved ? 'saved strategy' : 'no strategy'}: below-chart children over time`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedInContext(browser, 'a');
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_lang_v1', 'ru'); } catch { /* private */ }
      const w = window as unknown as { __snaps: unknown[] }; w.__snaps = []; const t0 = performance.now();
      const snap = () => {
        const b = document.querySelector('.arena-below-chart'); const ws = document.querySelector('.arena-ws');
        if (!b) return;
        w.__snaps.push({ t: Math.round(performance.now() - t0), ws: ws ? Math.round(ws.getBoundingClientRect().top) : -1,
          kids: Array.from(b.children).map((c) => { const r = (c as HTMLElement).getBoundingClientRect(); return { k: `${c.tagName.toLowerCase()}${(c as HTMLElement).dataset.testid ? '[' + (c as HTMLElement).dataset.testid + ']' : ''}.${String((c as HTMLElement).className).split(' ')[0]}`, h: Math.round(r.height), top: Math.round(r.top), txt: (c.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 70) }; }) });
      };
      setInterval(snap, 40);
    });
    const page = await ctx.newPage(); await page.setViewportSize({ width: 360, height: 844 });
    if (saved) await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
      if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
      const patch = (r: Record<string, unknown>) => ({ ...r, arena_strategy: 'ema_stack', language: 'ru' }); return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
    });
    page.on('response', async (r) => { try { const u = r.url(); if (!/user_settings|\/api\/settings/.test(u) || r.request().method() !== 'GET') return; const b = await r.json().catch(() => null); const row = Array.isArray(b) ? b[0] : b; console.log(`[RUPROBE] ${saved ? 'saved' : 'none'} settings GET ${u.split('?')[0].split('/').slice(-2).join('/')} status ${r.status()} language=${JSON.stringify(row && typeof row === 'object' ? (row as Record<string, unknown>).language : undefined)} keys=${row && typeof row === 'object' ? Object.keys(row as object).join(',') : ''}`); } catch { /* none */ } });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(5_000);
      const snaps = await page.evaluate(() => (window as unknown as { __snaps: Snap[] }).__snaps);
      console.log(`[RUPROBE] ${saved ? 'saved' : 'none'}: ${snaps.length} samples`);
      let prev: Snap | null = null;
      for (const s of snaps) {
        const changed = !prev || s.ws !== prev.ws || s.kids.length !== prev.kids.length || s.kids.some((k, i) => k.h !== prev!.kids[i]?.h || k.txt !== prev!.kids[i]?.txt);
        if (changed) console.log(`[RUPROBE] ${saved ? 'saved' : 'none'} t=${s.t}ms ws.top=${s.ws} :: ${s.kids.map((k) => `${k.k} h=${k.h} y=${k.top} "${k.txt}"`).join(' | ')}`);
        prev = s;
      }
    } finally { await ctx.close(); }
  });
}
