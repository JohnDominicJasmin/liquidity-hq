/* #2743 (one line, Dev): the Arena Multi-timeframe BULLISH badge text uses `--green-fg`, not `--green-2` (#1185 axe item: in the light terminal theme --green-2 on its own 10 % tint measured 4.48:1 / 4.17:1, under AA at 12 px bold).
 * THE WRITTEN RULE: the badge text reaches at least 4.5:1 against its own tinted background in the LIGHT and in the DARK theme (WCAG AA for normal text); dark must not get worse than AA either.
 * METHOD (read-only, signed out, nothing written or billed): on /arena in each theme a probe element is placed INSIDE the real `.edge-card` with the badge's exact style (the same tokens: color var(--green-fg), background color-mix(var(--green-2) 10 % over transparent), caption size, bold), so it composites over the card's real background; the computed foreground and the background composited over the nearest opaque ancestors give the contrast ratio. The REAL Multi-timeframe badge (whatever verdict the live data shows today) is measured the same way and printed. The probe is the BULLISH case because the live verdict cannot be forced.
 *   B1 dark: probe >= 4.5   B2 light: probe >= 4.5   B3 CONTROL: the same probe with the OLD token (--green-2) is measured too and printed (in light it is the 4.17-4.48 the issue names), so the method can tell the two apart */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

mkdirSync('qa/.shots', { recursive: true });

async function measure(page: Page, token: string) {
  return page.evaluate((tok) => {
    const parse = (s: string): [number, number, number, number] | null => {
      let m = /^rgba?\(\s*([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+%?))?\s*\)$/.exec(s.trim());
      if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [Number(m[1]), Number(m[2]), Number(m[3]), a]; }
      m = /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\)$/.exec(s.trim());
      if (m) { const a = m[4] === undefined ? 1 : m[4].endsWith('%') ? parseFloat(m[4]) / 100 : parseFloat(m[4]); return [Number(m[1]) * 255, Number(m[2]) * 255, Number(m[3]) * 255, a]; }
      return null;
    };
    const over = (top: [number, number, number, number], bottom: [number, number, number, number]): [number, number, number, number] => { const a = top[3] + bottom[3] * (1 - top[3]); if (a === 0) return [0, 0, 0, 0]; return [(top[0] * top[3] + bottom[0] * bottom[3] * (1 - top[3])) / a, (top[1] * top[3] + bottom[1] * bottom[3] * (1 - top[3])) / a, (top[2] * top[3] + bottom[2] * bottom[3] * (1 - top[3])) / a, a]; };
    const lum = (c: [number, number, number, number]) => { const f = (v: number) => { const x = v / 255; return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]); };
    const ratio = (a: [number, number, number, number], b: [number, number, number, number]) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
    const bgOf = (el: Element): [number, number, number, number] => { // composite the element's own bg over every ancestor's until opaque
      const chain: Array<[number, number, number, number]> = []; let n: Element | null = el;
      while (n) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c[3] > 0) { chain.push(c); if (c[3] >= 0.999) break; } n = n.parentElement; }
      let acc: [number, number, number, number] = chain.length ? chain[chain.length - 1] : [255, 255, 255, 1];
      for (let i = chain.length - 2; i >= 0; i--) acc = over(chain[i], acc); return acc;
    };
    const card = document.querySelector('.edge-card') as HTMLElement | null; if (!card) return { error: 'no .edge-card on the page' };
    const probe = document.createElement('span'); probe.textContent = 'BULLISH';
    probe.setAttribute('style', `display:inline-block;padding:2px 8px;border-radius:4px;font-size:var(--fs-caption);font-weight:700;color:var(${tok});background:color-mix(in srgb, var(--green-2) 10%, transparent);`);
    card.appendChild(probe);
    const fgRaw = getComputedStyle(probe).color; const fg = parse(fgRaw); const bg = bgOf(probe);
    const out = { token: tok, fg: fgRaw, bg: bg.map((v) => Math.round(v * 100) / 100), ratio: fg ? Math.round(ratio(over(fg, bg), bg) * 100) / 100 : null, theme: document.documentElement.getAttribute('data-theme'), design: document.documentElement.getAttribute('data-design') };
    probe.remove();
    // the real badge, whatever the live verdict is: a small bold element in the Multi-timeframe card whose text is one of the verdict labels
    const real = Array.from(document.querySelectorAll('.edge-card *')).filter((e) => e.children.length === 0 && /^(bullish|bearish|conflicting|mixed|no data)$/i.test((e.textContent || '').trim()) && /MULTI-TIMEFRAME/i.test((e.closest('.edge-card') as HTMLElement | null)?.innerText || ''))[0] as HTMLElement | undefined;
    let realOut: unknown = null; if (real) { const f = parse(getComputedStyle(real).color); const b = bgOf(real); realOut = { text: real.textContent, fg: getComputedStyle(real).color, ratio: f ? Math.round(ratio(over(f, b), b) * 100) / 100 : null }; }
    return { ...out, real: realOut };
  }, token);
}

for (const theme of ['dark', 'light'] as const) {
  test(`B ${theme}: the Multi-timeframe BULLISH badge text reaches 4.5:1 (probe with the badge's own style; the old token is measured as a control)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await ctx.addInitScript((t) => { try { localStorage.setItem('theme', t as string); localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, theme);
    const page = await ctx.newPage();
    try {
      await page.goto('/arena?coin=btc', { waitUntil: 'domcontentloaded', timeout: 90_000 });
      await page.locator('.edge-card').first().waitFor({ state: 'visible', timeout: 60_000 }); await page.waitForTimeout(8_000);
      const fixed = await measure(page, '--green-fg'); const old = await measure(page, '--green-2');
      console.log(`[B2743] ${theme} NEW token --green-fg: ${JSON.stringify(fixed)}`); console.log(`[B2743] ${theme} OLD token --green-2 (control): ${JSON.stringify(old)}`);
      await page.screenshot({ path: `qa/.shots/badge-contrast-${theme}.png` }).catch(() => {});
      expect((fixed as { ratio?: number }).ratio, `${theme}: could not measure the probe: ${JSON.stringify(fixed)}`).not.toBeNull();
      expect((fixed as { ratio: number }).ratio, `${theme}: the BULLISH badge text is ${(fixed as { ratio: number }).ratio}:1, under AA 4.5:1`).toBeGreaterThanOrEqual(4.5);
    } finally { await ctx.close().catch(() => {}); }
  });
}
