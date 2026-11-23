/* PROD, READ-ONLY, SIGNED OUT (QA 2026-11-22, release v2026.11.24 live as main 1109b76): GETs only, nothing is written, no sign-in, no AI. Run through the prod sweep ref (the production guard allowlists it). The one interaction is the Liq chip (a per-visitor toggle, local only).
 *   E1 /changelog: the v2026.11.24 entry sits above v2026.11.23 with its eight lines, dated 22 or 23 November 2026 (PR 2771 moves the date)
 *   E2 /arena for PEPE, BONK, sats, tag, toshi, turbo (1280; PEPE and sats also 390): the chart's own price and the Liq layer in ONE unit. The Liq chip is looked for; if it exists it is pressed on and every liquidation band the chart holds (klinecharts overlays of the group 'liq_clusters', read through React's fiber) is compared with the chart's last close: a band at a price 0.2x to 5x the close is in the chart's unit, anything else is a per-token amount next to a 1000x chart (the #2718 defect). No chip = the venues sent no cluster for that coin right now: reported, not a failure.
 *   E3 prod serves 1109b76, is not gated, not noindex */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: measures a deployed site (-f base_url=<site>); on the runner build the default suite must not run it (a long sweep once hit the 2 h cap)');

mkdirSync('qa/.shots', { recursive: true });
const V = (tag: string, msg: string) => console.log(`[R24] ${tag} ${msg}`);
const open = async (browser: Browser, width: number) => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
  await page.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private mode */ } });
  return { ctx, page };
};
const goto = async (page: Page, path: string, settle = 9_000) => { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(settle); };
const LINES = [
  'Eight data pages now explain how they work, with a short FAQ.', 'Shared links show a large Arena chart preview image.', 'A failed first chart load no longer draws a single live candle.', 'Strategy labels on the chart stay clear of support and resistance tags.',
  'Small texts on the liquidation and Arena pages are easier to read.', 'The news page lists only the sources it reads.', 'Economic calendar dates and source line follow your language.', 'The correlation page sends about 290 KB less data.',
];
const PREV_FIRST = 'Liquidation levels now show for PEPE, BONK and other low-priced coins.';

test('E1 /changelog shows the v2026.11.24 entry', async ({ browser }) => {
  test.setTimeout(120_000); const { ctx, page } = await open(browser, 1280);
  try {
    await goto(page, '/changelog', 5_000); const text = await page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' ')); const at = (s: string) => text.indexOf(s);
    const missing = LINES.filter((l) => at(l) < 0); const order = LINES.map(at); const first22 = at(PREV_FIRST); const datePos = Math.max(text.lastIndexOf('22 November 2026', at(LINES[0])), text.lastIndexOf('23 November 2026', at(LINES[0])));
    V('E1', `missing ${JSON.stringify(missing)} · in order ${order.every((v, i) => i === 0 || v > order[i - 1])} · above v2026.11.23 ${first22 < 0 || at(LINES[7]) < first22} · dated 22 or 23 November 2026 ${datePos >= 0 && at(LINES[0]) - datePos < 120}`);
    expect(missing).toEqual([]); expect(order.every((v, i) => i === 0 || v > order[i - 1])).toBe(true); expect(first22 < 0 || at(LINES[7]) < first22).toBe(true); expect(datePos).toBeGreaterThanOrEqual(0);
  } finally { await ctx.close().catch(() => {}); }
});

const CASES: Array<[string, number]> = [['pepe', 1280], ['bonk', 1280], ['sats', 1280], ['tag', 1280], ['toshi', 1280], ['turbo', 1280], ['pepe', 390], ['sats', 390]];
for (const [coin, width] of CASES) {
  test(`E2 /arena ${coin} at ${width}: the Liq layer is in the chart's unit`, async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } });
    await ctx.addInitScript(() => {
      try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private mode */ }
      const w = window as unknown as { __ft?: Array<{ t: string; x: number; y: number }> }; w.__ft = [];
      const proto = CanvasRenderingContext2D.prototype; const orig = proto.fillText;
      proto.fillText = function (this: CanvasRenderingContext2D, text: string, x: number, y: number, ...rest: number[]) { try { if (/^REALIZED/i.test(String(text))) w.__ft!.push({ t: String(text), x, y }); } catch { /* recorder only */ } return orig.call(this, text, x, y, ...(rest as [])); } as typeof proto.fillText;
    });
    const page = await ctx.newPage();
    /* the app's OWN read of the liquidation events (a GET to the data API), logged per coin: tells "no events for this coin" apart from "the runner could not read them" */
    const reads: string[] = [];
    page.on('response', async (r) => { const u = r.url(); if (!/liq_events/i.test(u) || r.request().method() !== 'GET') return; try { const j = await r.json(); const rows = Array.isArray(j) ? j as Array<{ coin?: string; symbol?: string }> : []; const mine = rows.filter((x) => String(x.coin ?? x.symbol ?? '').toLowerCase().includes(coin)); const u2 = new URL(u); reads.push(`HTTP ${r.status()} rows ${rows.length} (asked limit=${u2.searchParams.get('limit') ?? 'n/a'}, content-range ${r.headers()['content-range'] ?? 'none'}) for ${coin}: ${mine.length}`); } catch { reads.push(`HTTP ${r.status()} body unreadable`); } });
    try {
      await goto(page, `/arena?coin=${coin}&tf=1h`, 14_000);
      const chip = page.locator('button.klc-tool-btn').filter({ hasText: /^\s*liq/i }); const chipCount = await chip.count();
      let pressedBefore: string | null = null; let pressedAfter: string | null = null;
      if (chipCount) { pressedBefore = await chip.first().getAttribute('aria-pressed'); if (pressedBefore !== 'true') {
  let clickErr = ''; await chip.first().scrollIntoViewIfNeeded().catch(() => undefined);
  /* WHAT IS AT THE CHIP: the element that would receive a pointer click at its centre, and whether the chip is inside the viewport */
  const at = await chip.first().evaluate((el) => { const r = (el as HTMLElement).getBoundingClientRect(); const x = r.left + r.width / 2, y = r.top + r.height / 2; const top = document.elementFromPoint(x, y) as HTMLElement | null; return { rect: [Math.round(r.left), Math.round(r.top), Math.round(r.width), Math.round(r.height)], viewport: [window.innerWidth, window.innerHeight], topIsChip: top === el, top: top ? `${top.tagName.toLowerCase()}.${String(top.className).slice(0, 40)}` : null }; }).catch(() => null);
  reads.push(`chip at ${JSON.stringify(at)}`);
  await chip.first().click({ timeout: 10_000 }).catch((e) => { clickErr = String(e).split(String.fromCharCode(10)).map((x) => x.replace(/.\[\d+m/g, '').trim()).filter(Boolean).slice(-4).join(' / ').slice(0, 360); });
  const series: string[] = []; for (let i = 0; i < 12; i++) { series.push(String(await chip.first().getAttribute('aria-pressed'))); await page.waitForTimeout(500); }
  reads.push(`aria-pressed over 6 s after the click: ${series.join(',')}`);
  if (series[series.length - 1] !== 'true') { await chip.first().focus().catch(() => undefined); await page.keyboard.press('Enter').catch(() => undefined); await page.waitForTimeout(2_500); reads.push(`after focus + Enter: ${await chip.first().getAttribute('aria-pressed')}`); }
  await page.waitForTimeout(2_000); reads.push(`click ${clickErr ? 'error: ' + clickErr : 'ok'}`); } pressedAfter = await chip.first().getAttribute('aria-pressed'); }
      const m = await page.evaluate(() => {
        const el = document.querySelector('.klc-canvas') as HTMLElement | null; let close: number | null = null; let lo: number | null = null; let hi: number | null = null; let conv: ((y: number) => number | null) | null = null; let hasConv = false;
        if (el) { const key = Object.keys(el).find((k) => k.startsWith('__reactFiber$'));
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          let f: any = key ? (el as any)[key] : null; while (f && close == null) { let s = f.memoizedState; let n = 0; while (s && n < 300) { const q = s.memoizedState; if (q && typeof q === 'object' && q.current && typeof q.current.getDataList === 'function') { const c = q.current; const l = c.getDataList(); if (l.length) { close = l[l.length - 1].close; lo = Math.min(...l.map((k: { low: number }) => k.low)); hi = Math.max(...l.map((k: { high: number }) => k.high)); }
            hasConv = typeof c.convertFromPixel === 'function';
            conv = (y: number) => { try { const v = c.convertFromPixel([{ y }], { paneId: 'candle_pane' }); const o = Array.isArray(v) ? v[0] : v; const n2 = Number(o?.value); return Number.isFinite(n2) ? n2 : null; } catch { return null; } }; break; } s = s.next; n++; } f = f.return; } }
        const ft = (window as unknown as { __ft?: Array<{ t: string; x: number; y: number }> }).__ft ?? []; const seen = new Map<string, { t: string; y: number; price: number | null }>();
        for (const q of ft) seen.set(`${q.t}@${Math.round(q.y)}`, { t: q.t.slice(0, 40), y: Math.round(q.y), price: conv ? conv(q.y + 9) : null });
        return { close, lo, hi, hasConv, bands: Array.from(seen.values()).slice(-12), sym: (/(1000\w+|\b\w+)\/USDT/.exec(document.body.innerText) || [''])[0] };
      });
      const priced = m.bands.filter((b) => b.price != null) as Array<{ t: string; y: number; price: number }>;
      const off = m.close ? priced.filter((b) => b.price < m.close! * 0.2 || b.price > m.close! * 5) : priced;
      V('E2', `${coin} ${width}: Liq chip ${chipCount ? `present (aria-pressed ${pressedBefore} -> ${pressedAfter})` : 'ABSENT'} · app's liq-events reads ${JSON.stringify(reads.slice(0, 3))} · chart "${m.sym}" last close ${m.close} (range ${m.lo}..${m.hi}) · REALIZED bands drawn ${m.bands.length} (priced ${priced.length}, pixel-to-price ${m.hasConv}) ${JSON.stringify(m.bands.slice(0, 5).map((b) => `${b.t}@y${b.y}=${b.price == null ? 'n/a' : Number(b.price.toPrecision(4))}`))} · outside 0.2x-5x of the close ${off.length}`);
      await page.screenshot({ path: `qa/.shots/r24-liq-${coin}-${width}.png` }).catch(() => {});
      expect(m.close, 'the chart did not load').toBeTruthy();
      if (chipCount) expect(m.bands.length, 'the Liq chip is on but no REALIZED band was drawn').toBeGreaterThan(0);
      expect(off, 'a liquidation band is in another price unit than the chart').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('E3 prod serves the release and is not gated or hidden', async ({ request }) => {
  const root = await request.get('/', { maxRedirects: 3 }); const h = root.headers(); const ver = await request.get('/api/version'); const body = await ver.text();
  V('E3', `/ ${root.status()} www-authenticate ${h['www-authenticate'] ?? 'none'} x-robots-tag ${h['x-robots-tag'] ?? 'none'} · /api/version ${ver.status()} ${body.slice(0, 60)}`);
  expect(root.status()).toBe(200); expect(h['www-authenticate']).toBeUndefined(); expect(h['x-robots-tag'] ?? '').not.toMatch(/noindex/i); expect(body).toContain('1109b76');
});
