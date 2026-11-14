/* #2302 (the AI-processor disclosure reads its legal key in both places) and #2303 (hero wide breakpoint 1024 -> 1100). Signed out, reads only.
 *   D1  #2302  / and /ru /ko /zh at 390 and 1280, dark and light: the "AI Analysis" risk-disclosure paragraph on the landing page is word for word a paragraph of the /disclaimer page (the legal key's sentence), is not clipped (right edge inside the viewport) and the page does not scroll sideways; shots
 *   D2  #2302  an expanded platform footer carries the same paragraph; /disclaimer renders
 *   D3  #2302  no "powered by xAI" literal is left in components/ or app/ (source guard)
 *   W1  #2303  / at 1024, 1060 and 1099: ONE column (the LIVE READ panel starts at the left edge of the content and sits below the CTAs), both CTAs on one line, the panel and its STOP / TARGET inside the viewport; shots
 *   W2  #2303  / at 1100 and 1160: TWO columns as before (panel to the right of the copy); 768 and 1280 unchanged (768 one column, 1280 two)
 * A cell that finds nothing to measure fails. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { mkdirSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { gotoGuarded } from './_shared';

mkdirSync('qa/.shots', { recursive: true });
async function open(browser: Browser, width: number, theme: 'dark' | 'light', loc = 'en') {
  const ctx = await browser.newContext({ viewport: { width, height: 900 } });
  await ctx.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, [loc, theme]);
  await ctx.routeWebSocket(/binance\.com/, () => { /* silent */ });
  return ctx;
}
const norm = (s: string) => s.replace(/\s+/g, ' ').trim();

/* ---------- D1 / D2 ---------- */
for (const loc of ['en', 'ru']) for (const width of [390, 1280]) for (const th of ['dark', 'light'] as const) {
  test(`D1. landing ${loc} ${width} ${th}: the AI Analysis paragraph is the legal sentence, whole`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await open(browser, width, th, loc); const page = await ctx.newPage();
    try {
      const path = loc === 'en' ? '/' : `/${loc}`;
      await gotoGuarded(page, path); await page.waitForTimeout(9_000);
      const land = await page.evaluate(() => {
        /* the risk-disclosure label has a paragraph beside it; the stat tile that also reads "AI analysis" does not */
        const label = Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && /^(AI Analysis|AI-анализ|AI 분석|AI分析|Анализ ИИ|ИИ-анализ)/i.test((e.textContent || '').trim())).find(e => !!e.parentElement?.querySelector('p')) as HTMLElement | undefined;
        const row = label ? (label.parentElement as HTMLElement | null) : null; if (row) row.setAttribute('data-qa-ai-row', '1');
        const para = row ? ((row.querySelector('p') as HTMLElement | null)?.textContent || '').trim() : null;
        const r = row ? row.getBoundingClientRect() : null;
        return { found: !!row, label: label ? (label.textContent || '').trim() : null, para, right: r ? Math.round(r.right) : null, docSw: document.documentElement.scrollWidth, vw: window.innerWidth };
      });
      console.log(`[D1] ${loc} ${width} ${th} ${JSON.stringify({ ...land, para: land.para ? land.para.slice(0, 90) + '…(' + land.para.length + ')' : null })}`);
      await page.locator('[data-qa-ai-row]').first().scrollIntoViewIfNeeded(); await page.locator('[data-qa-ai-row]').first().screenshot({ path: `qa/.shots/landing-ai-${loc}-${width}-${th}.png` });
      expect(land.found, `no "AI Analysis" disclosure row on the landing page in ${loc}`).toBe(true);
      expect(land.para && land.para.length > 60, `the AI Analysis row has no paragraph: ${land.para}`).toBe(true);
      expect(land.right!, 'the paragraph runs past the viewport').toBeLessThanOrEqual(land.vw + 1);
      expect(land.docSw, 'page scrolls sideways').toBeLessThanOrEqual(land.vw);
      const dPage = await ctx.newPage(); await gotoGuarded(dPage, loc === 'en' ? '/disclaimer' : `/${loc}/disclaimer`); await dPage.waitForFunction(() => document.body.innerText.length > 800, null, { timeout: 25_000 }).catch(() => { /* judged below */ });
      const dtext = norm(await dPage.evaluate(() => document.body.innerText));
      expect(dtext.length, '/disclaimer did not render').toBeGreaterThan(500);
      expect(dtext.includes(norm(land.para!)) || norm(land.para!).split(/(?<=[.!?。])\s+/).filter(s => s.length > 25).every(s => dtext.includes(norm(s))),
        `the landing paragraph is not the /disclaimer legal text:\n${land.para}`).toBe(true);
    } finally { await ctx.close(); }
  });
}

test('D2. an expanded footer carries the same AI paragraph as the landing page', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await open(browser, 1280, 'dark'); const page = await ctx.newPage();
  try {
    await gotoGuarded(page, '/'); await page.waitForTimeout(9_000);
    const land = norm(await page.evaluate(() => { const l = Array.from(document.querySelectorAll('*')).filter(e => e.children.length === 0 && /^AI analysis$/i.test((e.textContent || '').trim())).find(e => !!e.parentElement?.querySelector('p')) as HTMLElement | undefined; return ((l?.parentElement?.querySelector('p') as HTMLElement | null)?.textContent || ''); }));
    expect(land.length, 'no landing AI paragraph').toBeGreaterThan(60);
    const f = await ctx.newPage(); await gotoGuarded(f, '/faq'); await f.waitForTimeout(8_000);
    const btn = f.getByText(/show full risk disclosures?/i).first(); await expect(btn, 'no "Show full risk disclosures" control in the footer').toBeVisible({ timeout: 30_000 });
    await btn.click(); await f.waitForTimeout(800);
    const ft = norm(await f.evaluate(() => document.body.innerText));
    console.log(`[D2] landing paragraph (${land.length} chars): ${land.slice(0, 100)}; in expanded footer: ${ft.includes(land)}`);
    expect(ft.includes(land), 'the expanded footer does not carry the landing AI paragraph word for word').toBe(true);
  } finally { await ctx.close(); }
});

test('D3. no "powered by xAI" literal is left in components/ or app/ (source guard)', () => {
  const hits: string[] = [];
  const walk = (dir: string) => { for (const f of readdirSync(dir)) { if (f === 'node_modules' || f.startsWith('.')) continue; const p = join(dir, f); const s = statSync(p); if (s.isDirectory()) walk(p); else if (/\.(tsx?|json)$/.test(f) && /powered by xAI/i.test(readFileSync(p, 'utf8'))) hits.push(p); } };
  walk('components'); walk('app');
  expect(hits, `a hardcoded "powered by xAI" string is left in: ${hits.join(', ')}`).toEqual([]);
});

/* ---------- W1 / W2 ---------- */
const hero = (page: Page) => page.evaluate(() => {
  const vw = window.innerWidth;
  const leaf = (re: RegExp) => Array.from(document.querySelectorAll('span,div,a,button,p')).filter(e => e.children.length === 0 && re.test((e.textContent || '').trim()) && (e as HTMLElement).offsetParent !== null) as HTMLElement[];
  const title = leaf(/LIVE READ/i)[0]; const panel = title ? ((title.parentElement?.parentElement) as HTMLElement | null) : null; const pr = panel ? panel.getBoundingClientRect() : null;
  const ctas = Array.from(document.querySelectorAll('a,button')).filter(e => /START FOR FREE|SEE LIVE BRIEFING/i.test((e.textContent || '').trim())) as HTMLElement[];
  const lines = (c: HTMLElement) => { const rg = document.createRange(); rg.selectNodeContents(c); return new Set(Array.from(rg.getClientRects()).filter(x => x.width > 0).map(x => Math.round(x.top / 4))).size; };
  const cr = ctas.map(c => c.getBoundingClientRect()); const ctaBottom = cr.length ? Math.max(...cr.map(r => r.bottom)) : null; const ctaLeft = cr.length ? Math.min(...cr.map(r => r.left)) : null;
  const stop = leaf(/^STOP$/i)[0], tgt = leaf(/^TARGET$/i)[0];
  return { vw, docSw: document.documentElement.scrollWidth, panel: pr ? { l: Math.round(pr.left), r: Math.round(pr.right), t: Math.round(pr.top) } : null, ctaBottom: ctaBottom && Math.round(ctaBottom), ctaLeft: ctaLeft && Math.round(ctaLeft), ctaLines: ctas.map(lines), nCtas: ctas.length, stopRight: stop ? Math.round(stop.getBoundingClientRect().right) : null, tgtRight: tgt ? Math.round(tgt.getBoundingClientRect().right) : null };
});
for (const width of [1024, 1060, 1099]) for (const th of ['dark', 'light'] as const) {
  test(`W1. / at ${width} ${th}: one column, CTAs on one line, panel whole`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await open(browser, width, th); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(9_000);
      const m = await hero(page); console.log(`[W1] ${width} ${th} ${JSON.stringify(m)}`);
      await page.screenshot({ path: `qa/.shots/hero-${width}-${th}.png` });
      expect(m.panel, 'the LIVE READ panel was not found').not.toBeNull(); expect(m.nCtas).toBeGreaterThanOrEqual(2);
      expect(m.docSw, 'page scrolls sideways').toBeLessThanOrEqual(m.vw);
      expect(m.panel!.t, 'the panel is not below the CTAs: still two columns').toBeGreaterThanOrEqual(m.ctaBottom!);
      expect(m.panel!.l, 'the panel does not start at the content edge: still two columns').toBeLessThanOrEqual(m.ctaLeft! + 8);
      for (const l of m.ctaLines) expect(l, 'a CTA wraps').toBeLessThanOrEqual(1);
      expect(m.panel!.r).toBeLessThanOrEqual(m.vw); expect(m.stopRight!).toBeLessThanOrEqual(m.vw); expect(m.tgtRight!).toBeLessThanOrEqual(m.vw);
    } finally { await ctx.close(); }
  });
}
for (const [width, two] of [[1100, true], [1160, true], [1280, true], [768, false]] as Array<[number, boolean]>) {
  test(`W2. / at ${width}: ${two ? 'two columns as before' : 'one column as before'}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await open(browser, width, 'dark'); const page = await ctx.newPage();
    try {
      await gotoGuarded(page, '/'); await page.waitForTimeout(9_000);
      const m = await hero(page); console.log(`[W2] ${width} ${JSON.stringify(m)}`);
      if (width === 1100 || width === 768) await page.screenshot({ path: `qa/.shots/hero-${width}-dark.png` });
      expect(m.panel).not.toBeNull(); expect(m.docSw).toBeLessThanOrEqual(m.vw); expect(m.panel!.r).toBeLessThanOrEqual(m.vw);
      if (two) expect(m.panel!.l, `${width}: the panel is not to the right of the copy`).toBeGreaterThan(m.vw / 3);
      else expect(m.panel!.l, `${width}: the panel is not stacked`).toBeLessThanOrEqual(m.ctaLeft! + 8);
      for (const l of m.ctaLines) expect(l, 'a CTA wraps').toBeLessThanOrEqual(1);
    } finally { await ctx.close(); }
  });
}
