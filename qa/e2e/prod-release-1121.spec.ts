/* PROD, READ-ONLY, SIGNED OUT (QA 2026-11-20, release v2026.11.21 live as main 4cb9ccd): GETs only, nothing is written, no sign-in, no AI. Run through the prod sweep ref (the production guard allowlists it).
 *   F1 facts-not-advice (#2655): the signed-out pages (/news /briefing /dashboard /markets /arena /) carry none of the dropped claims or advice phrases (carry trade, coincided, selloff, risk appetite, watch for, avoid chasing, pullback, smart money, intervention); wider forecast words are PRINTED with context, not asserted
 *   E1 EMA hover titles (#2663) in ko / zh / ru: every title attribute on /arena?coin=btc is classified: in the language's own script, or Latin-only English. English sentences (6+ words, no own-script letter) are the finding
 *   O1 390 px: no sideways scroll, no element past the right edge without a clipping ancestor, on /arena?coin=btc /dashboard /markets /briefing / (the Draw Structure and Supply/Demand overlays are Pro: signed out they cannot be drawn, so this checks the page around them, not the canvas labels)
 *   C1 contrast: axe color-contrast (serious + critical) on / /dashboard /arena?coin=btc /markets /briefing /news, dark and light, at 390 and 1280
 *   H1 /changelog: the v2026.11.21 entry is dated 20 November 2026 and the v2026.11.20 entry 19 November 2026 (the tags' commit dates, rule 22) */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { readFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

mkdirSync('qa/.shots', { recursive: true });
const V = (tag: string, msg: string) => console.log(`[R21] ${tag} ${msg}`);
const AXE = readFileSync(join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js'), 'utf8');
const open = async (browser: Browser, width: number, lang = 'en', theme = 'dark') => {
  const ctx = await browser.newContext({ viewport: { width, height: width < 600 ? 844 : 900 } }); const page = await ctx.newPage();
  await page.addInitScript(([l, t]) => { try { localStorage.setItem('lhq_lang_v1', l); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', t); } catch { /* private mode */ } }, [lang, theme]);
  return { ctx, page };
};
const goto = async (page: Page, path: string, settle = 9_000) => { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 90_000 }); await page.waitForTimeout(settle); };
const text = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));

const DROPPED = /carry[- ]trade|coincided|sell-?off|risk appetite|watch for|avoid chasing|pullback|smart money|intervention|likely to|expect(ed)? to/i;
const WIDER = /\b(dump\w*|pump\w*|fake|risk-?off|risk-?on|violent\w*|exaggerat\w*|revers(al|e)\w*|should|typically|usually|always|hawkish|overreact\w*)\b/gi;
test('F1 signed-out pages state facts: none of the dropped claims or advice phrases', async ({ browser }) => {
  test.setTimeout(280_000); const { ctx, page } = await open(browser, 1280); const bad: string[] = [];
  try {
    for (const path of ['/news', '/briefing', '/dashboard', '/markets', '/arena?coin=btc', '/']) {
      await goto(page, path); const t = await text(page);
      const m = DROPPED.exec(t); const wide = [...t.matchAll(WIDER)].slice(0, 6).map((x) => `${x[0]}: "${t.slice(Math.max(0, (x.index ?? 0) - 40), (x.index ?? 0) + 50)}"`);
      V('F1', `${path}: ${t.length} chars · dropped claim ${m ? `"${t.slice(Math.max(0, m.index - 50), m.index + 60)}"` : 'none'} · wider words ${wide.length ? JSON.stringify(wide) : 'none'}`);
      if (m) bad.push(`${path}: ${m[0]}`);
    }
  } finally { await ctx.close().catch(() => {}); }
  expect(bad, 'a dropped claim or advice phrase is live on prod').toEqual([]);
});

const SCRIPT: Record<string, RegExp> = { ko: /[가-힣]/, zh: /[一-鿿]/, ru: /[Ѐ-ӿ]/ };
for (const lang of ['ko', 'zh', 'ru']) {
  test(`E1 /arena in ${lang}: hover titles are in the reader's language`, async ({ browser }) => {
    test.setTimeout(150_000); const { ctx, page } = await open(browser, 1280, lang);
    try {
      await goto(page, '/arena?coin=btc', 14_000);
      const rows = await page.evaluate(() => Array.from(document.querySelectorAll('[title]')).map((e) => ((e as HTMLElement).title || '').replace(/\s+/g, ' ').trim()).filter((t) => t.length > 3));
      const own = rows.filter((t) => SCRIPT[lang === 'zh' ? 'zh' : lang].test(t)); const english = rows.filter((t) => !SCRIPT[lang].test(t) && t.split(' ').length >= 6 && /^[\x20-\x7e]+$/.test(t));
      const body = await text(page); V('E1', `${lang}: page language marks ${SCRIPT[lang].test(body) ? 'present' : 'ABSENT'} · titles ${rows.length} · own script ${own.length} · English sentences ${english.length} ${JSON.stringify(english.slice(0, 8))}`);
      await page.screenshot({ path: `qa/.shots/r21-arena-${lang}.png` }).catch(() => {});
      expect(SCRIPT[lang].test(body), `the ${lang} page is not in ${lang}: nothing here measures its titles`).toBe(true);
      expect(english, `English sentences in hover titles under ${lang}`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('O1 390 px: no sideways scroll or element past the edge', async ({ browser }) => {
  test.setTimeout(250_000); const { ctx, page } = await open(browser, 390); const wide: string[] = [];
  try {
    for (const path of ['/arena?coin=btc', '/dashboard', '/markets', '/briefing', '/']) {
      await goto(page, path);
      const m = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth; const out: string[] = [];
        const clip = (el: Element) => { for (let a = el.parentElement; a && a !== document.documentElement; a = a.parentElement) if (/hidden|clip|auto|scroll/.test(getComputedStyle(a).overflowX)) return true; return false; };
        for (const el of Array.from(document.querySelectorAll('body *'))) { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); if (r.width > 0 && cs.display !== 'none' && cs.visibility !== 'hidden' && cs.position !== 'fixed' && r.right > vw + 1 && !clip(el)) out.push(`${el.tagName.toLowerCase()}.${String((el as HTMLElement).className).split(/\s+/)[0].slice(0, 24)} right ${Math.round(r.right)}`); }
        return { vw, sw: document.documentElement.scrollWidth, out: out.slice(0, 5), n: out.length };
      });
      V('O1', `${path} 390: scrollWidth ${m.sw} vs ${m.vw} · elements past the edge ${m.n} ${JSON.stringify(m.out)}`); if (m.sw > m.vw + 1) wide.push(`${path} scrollWidth ${m.sw}`);
      await page.screenshot({ path: `qa/.shots/r21-390-${path.replace(/[^a-z]/g, '') || 'home'}.png` }).catch(() => {});
    }
  } finally { await ctx.close().catch(() => {}); }
  expect(wide, 'sideways scroll at 390').toEqual([]);
});

for (const theme of ['dark', 'light']) for (const width of [390, 1280]) {
  test(`C1 contrast ${theme} ${width}: axe color-contrast on the signed-out pages`, async ({ browser }) => {
    test.setTimeout(280_000); const { ctx, page } = await open(browser, width, 'en', theme); const bad: string[] = [];
    try {
      for (const path of ['/', '/dashboard', '/arena?coin=btc', '/markets', '/briefing', '/news']) {
        await goto(page, path, 8_000); await page.evaluate((src) => { const s = document.createElement('script'); s.textContent = src; document.head.appendChild(s); }, AXE);
        const res = await page.evaluate(async () => { const ax = (window as unknown as { axe: { run: (c: unknown, o: unknown) => Promise<{ violations: Array<{ id: string; impact: string; nodes: Array<{ target: unknown[]; html: string }> }> }> } }).axe; const r = await ax.run(document, { runOnly: { type: 'rule', values: ['color-contrast'] } }); return r.violations.flatMap((v) => v.nodes.map((n) => ({ impact: v.impact, sel: String(n.target[0]).slice(0, 70), html: n.html.slice(0, 80) }))); });
        V('C1', `${theme} ${width} ${path}: ${res.length} failing nodes ${JSON.stringify(res.slice(0, 4))}`); if (res.length) bad.push(`${path} ${res.length}`);
      }
    } finally { await ctx.close().catch(() => {}); }
    expect(bad, `contrast failures (${theme} ${width})`).toEqual([]);
  });
}

test('H1 /changelog dates for v2026.11.21 and v2026.11.20', async ({ browser }) => {
  test.setTimeout(120_000); const { ctx, page } = await open(browser, 1280);
  try {
    await goto(page, '/changelog', 5_000); const t = await text(page);
    const at = (needle: string) => { const i = t.indexOf(needle); return i < 0 ? '' : t.slice(Math.max(0, i - 40), i); };
    const a = at('Markets: very small coin prices keep their digits.'); const b = at('Research: the AI summary now loads instantly.');
    V('H1', `v2026.11.21 first line preceded by "${a}" · v2026.11.20 first line preceded by "${b}"`);
    expect(a, 'the v2026.11.21 entry is not dated 20 November 2026').toMatch(/20 November 2026/); expect(b, 'the v2026.11.20 entry is not dated 19 November 2026').toMatch(/19 November 2026/);
  } finally { await ctx.close().catch(() => {}); }
});
