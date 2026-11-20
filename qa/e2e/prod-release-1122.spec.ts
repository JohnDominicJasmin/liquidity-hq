/* PROD, READ-ONLY, SIGNED OUT (QA 2026-11-20, release v2026.11.22 live as main 29bb379): GETs only, nothing is written, no sign-in, no AI. Run through the prod sweep ref (the production guard allowlists it).
 *   D1 /changelog: the v2026.11.22 entry sits above v2026.11.21, dated 20 November 2026, with its seven lines; the dropped liquidation line and the SAR claim are absent
 *   D2 one price unit on /arena for PEPE and BONK at 390 and 1280: the chart's last close (klinecharts instance through React's fiber) and EVERY $ amount on the page: none far below it (a per-token amount next to a 1000x chart) and the chart symbol reads 1000PEPE / 1000BONK
 *   D3 the Arena Multi-timeframe card has no "-" placeholder for BTC at 390 and 1280 (the release's fix of the known prod hit)
 *   D4 prod serves 29bb379, is not gated, not noindex, an unknown path is a real 404 */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });
const V = (tag: string, msg: string) => console.log(`[R22] ${tag} ${msg}`);
const open = async (browser: Browser, width: number) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private mode */ } });
  return { ctx, page };
};
const goto = async (page: Page, path: string, settle = 9_000) => { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(settle); };
const LINES = [
  'Every strategy now draws on the chart, even with no setup.', 'Strategy lines off the visible price range show an edge label.', "Pages keep the last good value instead of 'unavailable' text.",
  'PEPE, BONK and other 1000x coins use one price unit.', 'The SMA line is now a true simple moving average.', "Stock VWAP reclaim keeps the last session's line when the market closes.", "The Setup card no longer covers the Arena's strategy panel.",
];
const amounts = (s: string) => [...s.matchAll(/\$\s?([0-9][0-9,]*\.?[0-9]*)(\s?[KMBkmb]\b)?/g)].filter((m) => !m[2]).map((m) => ({ text: m[0], value: Number(m[1].replace(/,/g, '')) })).filter((a) => Number.isFinite(a.value) && a.value > 0);

test('D1 /changelog shows the v2026.11.22 entry', async ({ browser }) => {
  test.setTimeout(120_000); const { ctx, page } = await open(browser, 1280);
  try {
    await goto(page, '/changelog', 5_000); const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')); const at = (s: string) => text.indexOf(s);
    const missing = LINES.filter((l) => at(l) < 0); const order = LINES.map(at); const first21 = at('Markets: very small coin prices keep their digits.'); const datePos = text.lastIndexOf('20 November 2026', at(LINES[0]));
    V('D1', `missing ${JSON.stringify(missing)} · in order ${order.every((v, i) => i === 0 || v > order[i - 1])} · above v2026.11.21 ${first21 < 0 || at(LINES[6]) < first21} · dated 20 November 2026 ${datePos >= 0 && at(LINES[0]) - datePos < 60} · dropped liquidation line absent ${at('Liquidation levels hidden') < 0} · SAR claim absent ${at('Parabolic SAR and SMA') < 0}`);
    expect(missing).toEqual([]); expect(order.every((v, i) => i === 0 || v > order[i - 1])).toBe(true); expect(first21 < 0 || at(LINES[6]) < first21).toBe(true); expect(at('Liquidation levels hidden')).toBeLessThan(0); expect(at('Parabolic SAR and SMA')).toBeLessThan(0); expect(datePos >= 0 && at(LINES[0]) - datePos < 60).toBe(true);
  } finally { await ctx.close().catch(() => {}); }
});

for (const coin of ['pepe', 'bonk']) for (const width of [1280, 390]) {
  test(`D2 /arena ${coin} at ${width}: one price unit`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, width);
    try {
      await goto(page, `/arena?coin=${coin}&tf=1h`, 14_000);
      const m = await page.evaluate(() => {
        const el = document.querySelector('.klc-canvas') as HTMLElement | null; let close: number | null = null;
        if (el) { const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let f: any = key ? (el as any)[key] : null; while (f && close == null) { let s = f.memoizedState; let n = 0; while (s && n < 300) { const q = s.memoizedState; if (q && typeof q === 'object' && q.current && typeof q.current.getDataList === 'function') { const l = q.current.getDataList(); if (l.length) close = l[l.length - 1].close; break; } s = s.next; n++; } f = f.return; } }
        const t = document.body.innerText; return { close, text: t, sym: (/(1000\w+)\/USDT/.exec(t) || [''])[0] };
      });
      const close = m.close; const tiny = close ? m.text.split(String.fromCharCode(10)).flatMap((l) => amounts(l).filter((a) => a.value < close * 0.02).map((a) => `${a.text} in "${l.trim().slice(0, 80)}"`)) : ['chart not found'];
      V('D2', `${coin} ${width}: chart last close ${close} · symbol "${m.sym}" · amounts far below the close ${tiny.length} ${JSON.stringify(tiny.slice(0, 6))}`);
      await page.screenshot({ path: `qa/.shots/r22-${coin}-${width}.png` }).catch(() => {});
      expect(close, 'the chart did not load').toBeTruthy(); expect(m.sym).toMatch(coin === 'pepe' ? /1000PEPE/ : /1000BONK/); expect(tiny, 'per-token amounts next to the 1000x chart').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

for (const width of [1280, 390]) {
  test(`D3 /arena btc at ${width}: the multi-timeframe card has no "-" placeholder`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, width);
    try {
      await goto(page, '/arena?coin=btc', 12_000);
      const r = await page.evaluate(() => { const hs = Array.from(document.querySelectorAll('h1,h2,h3,div,span')).filter((e) => /MULTI-TIMEFRAME ALIGNMENT/i.test((e as HTMLElement).innerText || '') && (e as HTMLElement).innerText.length < 40); const card = hs[0]?.closest('section, article, div[class*="card"], div') as HTMLElement | null; const root = (card?.parentElement ?? card) as HTMLElement | null; const txt = (root?.innerText || '').replace(/\s+/g, ' '); const dashes = Array.from(root?.querySelectorAll('*') ?? []).filter((e) => e.children.length === 0 && /^(-|—|–)$/.test((e.textContent || '').trim())).length; return { found: !!card, dashes, sample: txt.slice(0, 160) }; });
      V('D3', `btc ${width}: card found ${r.found} · bare "-" cells ${r.dashes} · "${r.sample}"`); expect(r.found, 'the MTF card was not found').toBe(true); expect(r.dashes, 'a "-" placeholder is in the MTF card').toBe(0);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('D4 prod serves the release, is not gated or hidden, and 404s a missing page', async ({ request }) => {
  const root = await request.get('/', { maxRedirects: 3 }); const h = root.headers(); const ver = await request.get('/api/version'); const nf = await request.get('/this-page-does-not-exist-qa-1122'); const body = await ver.text();
  V('D4', `/ ${root.status()} www-authenticate ${h['www-authenticate'] ?? 'none'} x-robots-tag ${h['x-robots-tag'] ?? 'none'} · /api/version ${ver.status()} ${body.slice(0, 60)} · missing page ${nf.status()}`);
  expect(root.status()).toBe(200); expect(h['www-authenticate']).toBeUndefined(); expect(h['x-robots-tag'] ?? '').not.toMatch(/noindex/i); expect(body).toContain('29bb379'); expect(nf.status()).toBe(404);
});
