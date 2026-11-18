/* #2602 TOOLBAR FACTS (RU 360, signed out): is the two-row reserve APPLIED, and is the language cookie the difference? For each variant, 3 loads, sampled at 100 / 300 / 500 / 2000 ms after navigation starts:
 *   the computed style of .klc-toolbar (minHeight, height, display, alignContent, boxSizing, flexWrap), its rect and the canvas-wrap's rect, the parent chain of the canvas-wrap (tag.class + rect), every stylesheet's rules whose selector mentions klc-toolbar (so the build's own CSS is shown),
 * and the load's layout-shift total with each shift's top sources.
 *   V1  lhq_lang_v1=ru in localStorage only (a returning user from before the cookie existed)     V2  the lhq_lang=ru COOKIE set as well (d2: /arena rendered in ru from the server)
 * Informational: prints facts, fails only when a load is over 0.1 AFTER printing. */
import { test, expect } from '@playwright/test';

const OBS = () => {
  const w = window as unknown as { __cls: number; __ls: string[]; __samples: unknown[]; __t0: number };
  w.__cls = 0; w.__ls = []; w.__samples = []; w.__t0 = performance.now();
  const d = (n: Node | null) => { const el = n && n.nodeType === 1 ? (n as HTMLElement) : (n && n.parentElement) || null; if (!el) return '(gone)'; const cls = (typeof el.className === 'string' ? el.className : '').split(/\s+/).slice(0, 2).join('.'); return `${el.tagName.toLowerCase()}${cls ? '.' + cls : ''}`; };
  try { new PerformanceObserver((l) => { for (const e of l.getEntries() as unknown as Array<{ value: number; startTime: number; hadRecentInput: boolean; sources?: Array<{ node: Node | null; previousRect: DOMRectReadOnly; currentRect: DOMRectReadOnly }> }>) { if (e.hadRecentInput) continue; w.__cls += e.value; w.__ls.push(`+${e.value.toFixed(4)} at ${Math.round(e.startTime)}ms: ` + (e.sources || []).slice(0, 4).map((s) => `${d(s.node)} [${Math.round(s.previousRect.x)},${Math.round(s.previousRect.y)},${Math.round(s.previousRect.width)},${Math.round(s.previousRect.height)}]->[${Math.round(s.currentRect.x)},${Math.round(s.currentRect.y)},${Math.round(s.currentRect.width)},${Math.round(s.currentRect.height)}]`).join(' | ')); } }).observe({ type: 'layout-shift', buffered: true }); } catch { /* unsupported */ }
  const rc = (el: Element | null) => { if (!el) return null; const r = el.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
  const sample = () => {
    const tb = document.querySelector('.klc-toolbar'); const cw = document.querySelector('.klc-canvas-wrap'); const cs = tb ? getComputedStyle(tb) : null;
    const chain: string[] = []; for (let n: Element | null = cw; n && chain.length < 6; n = n.parentElement) chain.push(`${n.tagName.toLowerCase()}${(typeof n.className === 'string' && n.className) ? '.' + n.className.split(/\s+/).slice(0, 2).join('.') : ''} ${JSON.stringify(rc(n))}`);
    (w.__samples as unknown[]).push({ t: Math.round(performance.now() - w.__t0), toolbar: tb ? { minHeight: cs!.minHeight, height: cs!.height, display: cs!.display, alignContent: cs!.alignContent, boxSizing: cs!.boxSizing, flexWrap: cs!.flexWrap, rect: rc(tb) } : null, canvasWrap: rc(cw), chain });
  };
  for (const ms of [100, 300, 500, 2000]) setTimeout(sample, ms);
};

for (const variant of ['V1 localStorage only', 'V2 cookie lhq_lang=ru']) {
  test(`TP ${variant}: ru 360 signed out, 3 loads`, async ({ browser, baseURL }) => {
    test.setTimeout(300_000); let worst = 0;
    for (let i = 1; i <= 3; i++) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 800 } });
      await ctx.addInitScript(OBS); await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private */ } });
      if (variant.startsWith('V2') && baseURL) await ctx.addCookies([{ name: 'lhq_lang', value: 'ru', url: baseURL }]);
      const page = await ctx.newPage();
      try {
        await page.goto('/arena', { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(6_000);
        const r = await page.evaluate(() => {
          const w = window as unknown as { __cls: number; __ls: string[]; __samples: unknown[] };
          const rules: string[] = []; const hrefs: string[] = [];
          for (const sh of Array.from(document.styleSheets)) { hrefs.push(sh.href || '(inline)'); try { for (const rule of Array.from(sh.cssRules)) { const walk = (x: CSSRule, prefix: string) => { const t = x.cssText; if (/klc-toolbar/.test(t) && t.length < 400) rules.push(prefix + t); if ((x as CSSGroupingRule).cssRules) for (const y of Array.from((x as CSSGroupingRule).cssRules)) walk(y, prefix + ((x as CSSMediaRule).conditionText ? `@media ${(x as CSSMediaRule).conditionText} ` : '')); }; walk(rule, ''); } } catch { /* cross-origin sheet */ } }
          return { cls: +w.__cls.toFixed(4), ls: w.__ls, samples: w.__samples, rules, hrefs, htmlLang: document.documentElement.lang, cookie: document.cookie.includes('lhq_lang') };
        });
        worst = Math.max(worst, r.cls);
        console.log(`[TP] ${variant} load ${i}: CLS ${r.cls} htmlLang=${r.htmlLang} cookie=${r.cookie}`);
        for (const s of r.ls) console.log(`[TP]   shift ${s}`);
        for (const s of r.samples as unknown[]) console.log(`[TP]   sample ${JSON.stringify(s)}`);
        if (i === 1) { for (const x of r.rules) console.log(`[TP]   css ${x}`); console.log(`[TP]   sheets ${r.hrefs.join(' ; ')}`); }
      } finally { await ctx.close(); }
    }
    expect(worst, `${variant}: worst CLS`).toBeLessThanOrEqual(0.1);
  });
}
