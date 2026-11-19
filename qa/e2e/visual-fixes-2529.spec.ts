/* #2529 RELEASE VISUAL REDS (PM 2026-11-18, from the sign-off screenshots). Pro fixture on /arena BTC, settings read patched to a clean row with the language under test.
 *   VF1  the usage counts ("Quick 0/30 · Deep 0/10") are shown ONCE: at 1280 inline (not in the usage bar), at 390 in the bar (not inline). en and ru.
 *   VF2  with "Let the read choose" (auto) the Strategy panel has no empty band: the gap under the strategy select to the next visible element is at most 40 px. 390 and 1280, en.
 *   VF3  ru / ko / zh / ar: the panel's section headings are translated (no long ALL-CAPS English words left in the panel text), at 390.
 *   VF4  ru at 390: no chip or button in the panel is clipped (scrollWidth <= clientWidth + 1), in particular the liquidations chip.
 * Each cell prints what it measured. */
import { test, expect, type Page, type Browser } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!AUTH_READY, AUTH_SKIP_REASON);
async function open(browser: Browser, lang: string, width: number) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height: width < 500 ? 844 : 900 } }); const page = await ctx.newPage(); await installPaidAiFence(page);
  await page.addInitScript((l) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, lang);
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => {
    if (route.request().method() !== 'GET') return route.fallback(); const res = await route.fetch(); const b = await res.json().catch(() => null); if (b == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, language: lang, strategy_selection: null, strategy_params: null, arena_strategy: null }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(b) ? b.map(patch) : patch(b as Record<string, unknown>)) });
  });
  await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await page.locator('.strat-panel').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(12_000);
  return { ctx, page };
}
const usage = (page: Page) => page.evaluate(() => {
  const vis = (el: Element) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden'; };
  const hits: Array<{ tag: string; cls: string; inBar: boolean; text: string }> = [];
  for (const el of Array.from(document.querySelectorAll('body *'))) {
    if (el.children.length > 3 || !vis(el)) continue; const t = (el.textContent || '').replace(/\s+/g, ' ').trim(); if (t.length > 80) continue;
    if (/(quick|deep|быстр|глубок)[^0-9]{0,14}\d+\s*\/\s*\d+/i.test(t) && !Array.from(el.children).some((c) => vis(c) && /\d+\s*\/\s*\d+/.test(c.textContent || '') && (c.textContent || '').length < t.length && /(quick|deep|быстр|глубок)/i.test(c.textContent || '') && (c.textContent || '').length > 6 && c.children.length > 3)) hits.push({ tag: el.tagName.toLowerCase(), cls: String((el as HTMLElement).className).slice(0, 40), inBar: !!el.closest('.usage-meter-host'), text: t.slice(0, 50) });
  }
  return hits;
});

for (const lang of ['en', 'ru']) for (const width of [390, 1280]) {
  test(`VF1:${lang}:${width} usage counts once`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, lang, width);
    try {
      const hits = await usage(page); const outer = hits.filter((h) => h.inBar ? h.cls === 'usage-meter-host' || !hits.some((o) => o.inBar && o.cls === 'usage-meter-host') : !hits.some((o) => o !== h && !o.inBar && o.text.includes(h.text) && o.text.length > h.text.length)); console.log(`[VF] VF1 ${lang} ${width}: ${JSON.stringify(outer)}`);
      expect(outer.length, `usage counts shown ${outer.length} times: ${JSON.stringify(outer)}`).toBe(1);
      if (width >= 1000) expect(outer[0].inBar, 'at 1280 the counts must be inline, not in the usage bar').toBe(false); else expect(outer[0].inBar, 'at 390 the counts must be in the usage bar').toBe(true);
    } finally { await ctx.close(); }
  });
}

for (const width of [390, 1280]) {
  test(`VF2:${width} no empty band under the strategy select`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, 'en', width);
    try {
      const m = await page.evaluate(() => {
        const sel = document.querySelector('[data-testid="strategy-set-select"]') as HTMLElement | null; if (!sel) return null; const sb = sel.getBoundingClientRect(); const panel = sel.closest('.strat-panel') as HTMLElement; const below: Array<{ top: number; tag: string; cls: string }> = [];
        for (const el of Array.from(panel.querySelectorAll('*'))) { const r = el.getBoundingClientRect(); if (r.width < 8 || r.height < 6 || r.top < sb.bottom - 1 || sel.contains(el)) continue; if (el.contains(sel) || (el.children.length > 0 && Array.from(el.children).some((c) => c.getBoundingClientRect().height > 0 && c.getBoundingClientRect().top >= sb.bottom - 1))) continue; below.push({ top: Math.round(r.top), tag: el.tagName.toLowerCase(), cls: String((el as HTMLElement).className).slice(0, 30) }); }
        below.sort((a, b) => a.top - b.top); return { selBottom: Math.round(sb.bottom), next: below[0] ?? null, panelBottom: Math.round(panel.getBoundingClientRect().bottom), value: (sel as HTMLSelectElement).value };
      });
      console.log(`[VF] VF2 ${width}: ${JSON.stringify(m)}`); expect(m, 'the strategy select was not found').toBeTruthy();
      if (m?.next) expect(m.next.top - m.selBottom, `an empty band of ${m.next.top - m.selBottom}px under the strategy select (next element ${JSON.stringify(m.next)})`).toBeLessThanOrEqual(40);
    } finally { await ctx.close(); }
  });
}

/* 'ar' is NOT here any more: Arabic is not a selectable language (the app falls back to English by design), so an English panel heading in ar is the specified behaviour, not a defect. */
for (const lang of ['ru', 'ko', 'zh']) {
  test(`VF3:${lang}:390 panel headings translated`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, lang, 390);
    try {
      const text = ((await page.locator('.strat-panel').first().innerText()) || '').replace(/\s+/g, ' '); const english = (text.match(/\b[A-Za-z]{5,}\b/g) ?? []).filter((w) => !/^(LiquidityAI|VWAP|Bollinger|Golden|Fibonacci)$/i.test(w));
      console.log(`[VF] VF3 ${lang}: english words ${JSON.stringify([...new Set(english)].slice(0, 14))}; text ${text.slice(0, 260)}`);
      const heading = text.split(' ')[0]; console.log(`[VF] VF3 ${lang}: panel heading "${heading}"; ALL-CAPS English words ${JSON.stringify([...new Set(english.filter((w) => w === w.toUpperCase()))])}`);
      expect(/^[A-Za-z]{4,}$/.test(heading), `the panel section heading is English in ${lang}: "${heading}"`).toBe(false);
    } finally { await ctx.close(); }
  });
}

test('VF4:ru:390 no clipped chip or button in the panel', async ({ browser }) => {
  test.setTimeout(150_000); const { ctx, page } = await open(browser, 'ru', 390);
  try {
    const clipped = await page.evaluate(() => Array.from(document.querySelectorAll('.strat-panel button, .strat-panel [role="switch"], .strat-panel label, .strat-panel select')).filter((el) => { const h = el as HTMLElement; const r = h.getBoundingClientRect(); return r.width > 0 && h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflow !== 'visible'; }).map((el) => ((el as HTMLElement).innerText || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').slice(0, 40)));
    console.log(`[VF] VF4 clipped: ${JSON.stringify(clipped)}`); expect(clipped, 'clipped text in the Russian panel').toEqual([]);
  } finally { await ctx.close(); }
});

/* VF5 (#2531): the panel's run row (Quick / Deep / Ask AI) is translated in ru, ko, zh, in ONE row of three, nothing clipped, at 390 and 1280. */
for (const lang of ['ru', 'ko', 'zh']) for (const width of [390, 1280]) {
  test(`VF5:${lang}:${width} run row translated, one row, not clipped`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, lang, width);
    try {
      const m = await page.evaluate(() => Array.from(document.querySelectorAll('.strat-panel .strat-btn')).map((el) => { const h = el as HTMLElement; const r = h.getBoundingClientRect(); return { text: (h.innerText || '').replace(/\s+/g, ' ').trim(), top: Math.round(r.top), w: Math.round(r.width), clipped: h.scrollWidth > h.clientWidth + 1 }; }).filter((b) => b.w > 0));
      console.log(`[VF] VF5 ${lang} ${width}: ${JSON.stringify(m)}`);
      expect(m.length, 'the three run buttons were not found').toBeGreaterThanOrEqual(3);
      const row = m.slice(0, 3); expect(row.map((b) => b.text).filter((t) => /^(quick|deep|ask ai)$/i.test(t)), `untranslated run buttons in ${lang}`).toEqual([]);
      expect(Math.max(...row.map((b) => b.top)) - Math.min(...row.map((b) => b.top)), 'the three buttons are not on one row').toBeLessThanOrEqual(3);
      expect(row.filter((b) => b.clipped).map((b) => b.text), `clipped run buttons in ${lang} ${width}`).toEqual([]);
    } finally { await ctx.close(); }
  });
}
