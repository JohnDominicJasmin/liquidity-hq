/* #1185 TICK CELLS, part A (signed out, throw-away): measures, on the deployed site, the open boxes whose fix is on staging.
 * Each cell prints `[TICK] <id> ...` evidence lines. Expectations are the BOX TEXT (the written rule), not the code. Soft assertions, so one failing line never hides the others.
 * Read-only: GETs, the paid-AI fence is installed first on every page, nothing is written, no credential is typed. */
import { test, expect, type Page } from '@playwright/test';
import { join } from 'node:path';
import { gotoGuarded } from './_shared';
import { signedOutContext, openPage, installNewsFixture, type Theme } from './_v1185';
import DEFAULT_EN from '../../lib/labelDefaults.en.json';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
const AXE = join(process.cwd(), 'node_modules', 'axe-core', 'axe.min.js');
const text = (page: Page) => page.evaluate(() => document.body.innerText);
const EN = DEFAULT_EN as Record<string, string>;

test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); });

/* ---------- in-page helpers (serialised into the page, so no imports inside) ---------- */
const leafWords = (args: { min: number; skip: string; exclude: string }) => {
  const INLINE = ['SPAN', 'B', 'I', 'EM', 'STRONG', 'A', 'SMALL', 'CODE', 'BR', 'SUP', 'SUB'];
  const out = new Map<string, { words: number; cls: string }>();
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'path'].includes(el.tagName)) continue;
    if (args.skip && el.closest(args.skip)) continue;
    if (args.exclude && el.closest(args.exclude)) continue;
    if (!Array.from(el.children).every((c) => INLINE.includes(c.tagName))) continue;
    if (!vis(el)) continue;
    const t = ((el as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim();
    const words = t.split(' ').filter((w) => /[A-Za-z0-9]/.test(w)).length;
    if (words >= args.min) { const prev = out.get(t); if (!prev) out.set(t, { words, cls: String((el as HTMLElement).className).slice(0, 40) || el.tagName }); }
  }
  return Array.from(out.entries()).map(([t, v]) => ({ t: t.slice(0, 140), words: v.words, cls: v.cls }));
};

const nonLocal = (args: { lang: string }) => {
  /* visible text nodes, titles, aria-labels and placeholders that are Latin-only (no Cyrillic, CJK, Hangul or Arabic letter) and have a 3+ letter word: the English left on a non-English page */
  const NON = /[Ѐ-ӿ぀-ヿ一-鿿가-힯؀-ۿ]/;
  const out: { t: string; k: string; c: string }[] = [];
  const seen = new Set<string>();
  const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
  const add = (t: string, k: string, el: Element) => { const key = k + '|' + t; if (seen.has(key)) return; seen.add(key); out.push({ t: t.slice(0, 90), k, c: String((el as HTMLElement).className || el.tagName).slice(0, 30) }); };
  for (const el of Array.from(document.body.querySelectorAll('*'))) {
    if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName) || el.closest('svg')) continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join(' ').replace(/\s+/g, ' ').trim();
    const v = vis(el);
    if (v && own.length >= 2 && /[A-Za-z]{2,}/.test(own) && !NON.test(own)) add(own, 'text', el);
    for (const a of ['title', 'aria-label', 'placeholder']) { const x = (el.getAttribute(a) || '').trim(); if (x && /[A-Za-z]{3,}/.test(x) && !NON.test(x) && (v || a === 'aria-label')) add(x, a, el); }
  }
  void args;
  return out;
};

async function labels(page: Page, locale: string): Promise<Record<string, string>> {
  const res = await page.request.get(`/api/labels?locale=${locale}`);
  const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  const flat: Record<string, string> = {};
  for (const [k, v] of Object.entries(j)) if (typeof v === 'string') flat[k] = v;
  return flat;
}

/* ================= A0 label tables served by the site (staging reads the DEV label table) ================= */
test('A0 labels: advice phrases (box 154), ru OI words (143), A11Y names (222), EMA row titles (128), stale notice (262)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/api/version');
    const en = await labels(page, 'en'); const ru = await labels(page, 'ru'); const ko = await labels(page, 'ko'); const zh = await labels(page, 'zh');
    T('A0', `served label counts: en ${Object.keys(en).length}, ru ${Object.keys(ru).length}, ko ${Object.keys(ko).length}, zh ${Object.keys(zh).length}; bundled English defaults ${Object.keys(EN).length}`);
    const effEn = { ...EN, ...en };
    /* box 154: the advice / prediction phrases the box names */
    const ADV: [string, RegExp][] = [['real dump', /real dump/i], ['before the pump', /before the pump/i], ['big players taking profit', /big players taking profit/i], ['price magnet', /price magnet/i],
      ['may push price down to trigger', /may push price down to trigger/i], ['Approaching danger', /approaching danger/i], ['crypto headwind', /crypto headwind/i], ['tends to hold better', /tends to hold better/i],
      ['wait for rally into value zone', /wait for rally into (the )?value zone/i], ['Trade now or wait', /trade now or wait/i], ['Is now a good time', /is now a good time/i], ['stay out of the chop', /stay out of the chop/i],
      ['Good time to trade', /good time to trade/i], ['better to wait', /better to wait/i], ['Be picky with entries', /be picky with entries/i], ['expect a volatility spike', /expect a volatility spike/i], ['reduce size or wait', /reduce size or wait/i],
      ['often drifts toward', /often drifts toward/i], ['becomes more likely', /becomes more likely/i], ['mild bullish tell', /mild bullish tell/i]];
    const hits: string[] = [];
    for (const [name, re] of ADV) for (const [k, v] of Object.entries(effEn)) if (re.test(v)) hits.push(`${name} => ${k}: "${v.slice(0, 90)}"`);
    T('A0-154', `English label values (served over defaults) containing an advice/forecast phrase: ${hits.length} ${JSON.stringify(hits)}`);
    expect.soft(hits, 'advice phrases still in the English label table').toEqual([]);
    /* box 143: Russian words for the OI hour */
    const effRu = { ...EN, ...ru };
    const oiKeys = Object.keys(EN).filter((k) => k.startsWith('OI_1H_SIGNAL_'));
    const oi = oiKeys.map((k) => `${k}: ru="${effRu[k]}" served=${k in ru} sameAsEn=${effRu[k] === EN[k]}`);
    T('A0-143', `OI_1H_SIGNAL_* in ru (${oiKeys.length} keys): ${JSON.stringify(oi)}`);
    expect.soft(oiKeys.filter((k) => effRu[k] === EN[k]), 'OI hour words that are still English in ru').toEqual([]);
    /* box 222: A11Y_ names */
    const a11y = Object.keys(EN).filter((k) => k.startsWith('A11Y_'));
    for (const [nm, tbl] of [['ru', ru], ['ko', ko], ['zh', zh]] as const) {
      const miss = a11y.filter((k) => !(k in tbl) || tbl[k] === EN[k]);
      T('A0-222', `${nm}: ${a11y.length} A11Y_* keys, ${miss.length} not translated (absent from the served table or equal to English): ${JSON.stringify(miss.slice(0, 30))}`);
    }
    expect.soft(a11y.filter((k) => !(k in ru) || ru[k] === EN[k]), 'A11Y_* names still English in ru').toEqual([]);
    /* box 128: EMA row titles */
    const ema = Object.keys(EN).filter((k) => k.startsWith('EMA_ROW_'));
    for (const [nm, tbl] of [['ru', ru], ['ko', ko], ['zh', zh]] as const) {
      const miss = ema.filter((k) => !(k in tbl) || tbl[k] === EN[k]);
      T('A0-128', `${nm}: ${ema.length} EMA_ROW_* keys, ${miss.length} not translated (absent or equal to English)`);
    }
    expect.soft(ema.filter((k) => !(k in ru) || ru[k] === EN[k]).length, 'EMA row titles not translated in ru').toBe(0);
    /* box 262: the stale notice */
    const stale = effEn['ARENA_STALE_SETTINGS_NOTICE'] ?? '';
    T('A0-262', `ARENA_STALE_SETTINGS_NOTICE = "${stale}" (${stale.split(/\s+/).length} words)`);
    expect.soft(stale.split(/\s+/).length, 'stale notice over 15 words').toBeLessThan(16);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A1 dashboard copy (159, 214, 272, 213, 264) ================= */
test('A1 /dashboard en 1280 dark: weekday tile, Smart money, Market read, OI cards, Playbook card', async ({ browser }) => {
  test.setTimeout(180_000);
  const ctx = await signedOutContext(browser, { width: 1280, theme: 'dark' }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/dashboard');
    await page.waitForSelector('.mr-verdict', { state: 'visible', timeout: 60_000 }).catch(() => T('A1', 'UNMEASURED: .mr-verdict never rendered'));
    await page.waitForFunction(() => document.querySelectorAll('.mr-factor').length > 0, undefined, { timeout: 45_000 }).catch(() => T('A1', 'no .mr-factor rendered within 45 s'));
    await page.waitForTimeout(8_000);
    const mr = await page.evaluate(() => ({
      verdict: (document.querySelector('.mr-verdict') as HTMLElement | null)?.innerText ?? null, sub: (document.querySelector('.mr-sub') as HTMLElement | null)?.innerText ?? null,
      score: (document.querySelector('.mr-score') as HTMLElement | null)?.innerText ?? null,
      factors: Array.from(document.querySelectorAll('.mr-factor')).map((f) => ({ k: (f.querySelector('.mr-factor-k') as HTMLElement | null)?.innerText ?? '', v: (f.querySelector('.mr-factor-v') as HTMLElement | null)?.innerText ?? '', s: (f.querySelector('.mr-factor-s') as HTMLElement | null)?.innerText ?? '' })),
    }));
    T('A1', `market read: ${JSON.stringify(mr)}`);
    const body = await text(page);
    /* 159 */
    const dayK = mr.factors.filter((f) => /^\s*day\s*$/i.test(f.k)).length; const weekday = mr.factors.filter((f) => /weekday effect/i.test(f.k)).length;
    T('A1-159', `factor labelled "Day": ${dayK} · labelled "Weekday effect": ${weekday} · weekday-name tile in body: ${/\bDAY\b[^\n]{0,3}\n?\s*(Mon|Tues|Wednes|Thurs|Fri|Satur|Sun)day/i.test(body)}`);
    expect.soft(mr.factors.length, 'UNMEASURED: the market read rendered no factor tiles (inputs never loaded)').toBeGreaterThan(0);
    expect.soft(dayK, 'a tile is still labelled just "Day"').toBe(0); expect.soft(weekday, 'no tile is labelled "Weekday effect"').toBe(1);
    /* 214 */
    const sm = mr.factors.filter((f) => /smart money/i.test(f.k));
    T('A1-214', `Smart money tile(s): ${JSON.stringify(sm)}`);
    expect.soft(sm.length, 'no Smart money tile rendered').toBeGreaterThan(0);
    expect.soft(sm.filter((f) => /[+\-−]?\d+\s*\/\s*\d+/.test(f.v + ' ' + f.s)), 'Smart money still shows an N/M count').toEqual([]);
    /* 272 */
    const adv = body.match(/good time to trade|better to wait|be picky|be selective|decent conditions|weak setup/gi) ?? [];
    T('A1-272', `advice words in the dashboard text: ${JSON.stringify(adv)} · verdict "${mr.verdict}" · sub "${mr.sub}" (${(mr.sub ?? '').split(/\s+/).length} words)`);
    expect.soft(adv, 'advice wording on the dashboard').toEqual([]);
    expect.soft((mr.sub ?? '').split(/\s+/).filter(Boolean).length, 'Market read sub-line over 12 words').toBeLessThanOrEqual(12);
    /* 213: the OI cards */
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.edge-card')).map((c) => ({ l: (c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText.trim() ?? '', v: (c.querySelector('.edge-card-value') as HTMLElement | null)?.innerText.trim() ?? '', s: (c.querySelector('.edge-card-signal') as HTMLElement | null)?.innerText.trim() ?? '' })));
    T('A1-213', `edge cards: ${JSON.stringify(cards)}`);
    const oiCard = cards.find((c) => /open interest/i.test(c.l) && !/hour|1h/i.test(c.l)); const oi1 = cards.find((c) => /open interest/i.test(c.l) && /hour|1h/i.test(c.l));
    if (oiCard && oi1 && /^[+-]?\d/.test(oi1.v)) {
      const pct = parseFloat(oi1.v.replace('+', '')); const up = /new buyers|new sellers/i.test(oiCard.v);
      const down = /short covering|long exits/i.test(oiCard.v);
      T('A1-213', `OI trend card says "${oiCard.v}" / "${oiCard.s}" · OI last hour says ${oi1.v} "${oi1.s}" -> trend card is ${up ? 'OI-rising' : down ? 'OI-falling' : 'neither'} while the 1h figure is ${pct >= 0 ? 'up' : 'down'}`);
      if (up) expect.soft(pct, 'trend card says OI rising, the 1h figure is negative').toBeGreaterThanOrEqual(0);
      if (down) expect.soft(pct, 'trend card says OI falling, the 1h figure is positive').toBeLessThanOrEqual(0);
    } else T('A1-213', `UNMEASURED: OI cards did not both carry data (trend ${JSON.stringify(oiCard)}, 1h ${JSON.stringify(oi1)})`);
    /* 264: Playbook card */
    const pb = await page.evaluate(() => {
      const el = document.querySelector('.sotd-text') as HTMLElement | null; if (!el) return null;
      const lh = parseFloat(getComputedStyle(el).lineHeight); const h0 = el.getBoundingClientRect().height; const more = document.querySelector('.sotd-more') as HTMLButtonElement | null;
      const words = (el.textContent || '').trim().split(/\s+/).length; const clampedCls = el.classList.contains('sotd-text-clamped');
      const foot = Array.from(document.querySelectorAll('.sotd-footer, .sotd-footer > span')).map((f) => ((f as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim());
      return { lh, h0, lines: Math.round(h0 / lh), words, clampedCls, hasMore: !!more, moreText: more?.innerText ?? null, foot };
    });
    T('A1-264', `Playbook card: ${JSON.stringify(pb)}`);
    expect.soft(pb, 'no .sotd-text on the dashboard').not.toBeNull();
    if (pb) {
      expect.soft(pb.lines, 'Playbook body is more than 2 lines before "More"').toBeLessThanOrEqual(2);
      const footWords = pb.foot.map((f) => f.split(/\s+/).filter(Boolean).length); T('A1-264', `footnote word counts (whole footer, then its first span) ${JSON.stringify(footWords)}`);
      const noteW = footWords[1] ?? 0; const restW = (footWords[0] ?? 0) - noteW;
      expect.soft(pb.foot.length, 'no .sotd-footer found').toBeGreaterThan(0);
      expect.soft(noteW, 'first Playbook footnote is 16 words or more').toBeLessThan(16);
      expect.soft(restW, 'second Playbook footnote is 16 words or more').toBeLessThan(16);
      if (pb.hasMore) {
        await page.locator('.sotd-more').click(); await page.waitForTimeout(500);
        const h1 = await page.evaluate(() => (document.querySelector('.sotd-text') as HTMLElement).getBoundingClientRect().height);
        T('A1-264', `control: after "More" the body is ${Math.round(h1)} px high (was ${Math.round(pb.h0)}) -> the clamp measurement can see a taller body`);
        expect.soft(h1, 'control: pressing More did not make the body taller, so "2 lines" proves nothing').toBeGreaterThan(pb.h0 + 2);
      } else T('A1-264', 'no More link: the body fits in 2 lines on its own (control not available)');
    }
    await page.screenshot({ path: 'qa/.shots/tick-a1-dashboard.png', fullPage: false }).catch(() => {});
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A2 glossary (172) ================= */
test('A2 /learn glossary: RSI, VWAP and Contrarian entries do not state outcomes', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/learn');
    await page.waitForSelector('text=/RSI/', { timeout: 40_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    const body = await text(page);
    const ents = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 || Array.from(e.children).every((c) => ['SPAN', 'B', 'I', 'CODE', 'A'].includes(c.tagName))).map((e) => (e as HTMLElement).innerText || '').filter((t) => /\b(RSI|VWAP|contrarian)\b/i.test(t) && t.length > 40).map((t) => t.replace(/\s+/g, ' ').slice(0, 200)));
    T('A2', `page has "RSI": ${/RSI/.test(body)} "VWAP": ${/VWAP/.test(body)} · entries mentioning them: ${JSON.stringify(ents.slice(0, 8))}`);
    const bad = body.match(/more likely|mild bullish tell|bounce becomes|reversal down becomes/gi) ?? [];
    T('A2', `outcome phrases in the glossary page: ${JSON.stringify(bad)}`);
    expect.soft(/RSI/.test(body) && /VWAP/.test(body), 'CONTROL: the glossary did not render RSI and VWAP, so absence proves nothing').toBe(true);
    expect.soft(bad, 'glossary entries still state outcomes').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A3 advice wording on the rendered pages (154) ================= */
test('A3 advice wording: rendered text of the named pages and the Ask AI quick prompts', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  const RE = /real dump|before the pump|big players taking profit|price magnet|may push price down|approaching danger|crypto headwind|tends to hold better|wait for rally|trade now or wait|is now a good time|stay out of the chop|expect a volatility spike|reduce size or wait|good time to trade|better to wait/gi;
  try {
    for (const path of ['/dashboard', '/scanner', '/liq', '/correlation', '/econ-calendar', '/arena?coin=btc&tf=1h']) {
      await gotoGuarded(page, path); await page.waitForTimeout(path === '/liq' ? 18_000 : 14_000);
      const body = await text(page);
      const hits = body.match(RE) ?? [];
      T('A3', `${path}: ${body.length} chars of text, advice phrases ${JSON.stringify(hits)}`);
      expect.soft(body.length, `${path}: no text rendered`).toBeGreaterThan(500);
      expect.soft(hits, `${path}: advice wording still rendered`).toEqual([]);
      if (path === '/dashboard') {
        await page.locator('[data-testid="grok-launcher"]').first().click({ timeout: 10_000 }).catch(() => T('A3', 'could not open the Ask AI panel'));
        await page.waitForTimeout(1500);
        const panel = await page.evaluate(() => (document.querySelector('[data-testid="grok-panel"]') as HTMLElement | null)?.innerText ?? '');
        const q = panel.match(RE) ?? [];
        T('A3', `Ask AI panel text (${panel.length} chars): quick prompts ${JSON.stringify(panel.split('\n').filter((l) => /\?$/.test(l.trim())).slice(0, 10))} · advice phrases ${JSON.stringify(q)}`);
        expect.soft(panel.length, 'CONTROL: the Ask AI panel did not open').toBeGreaterThan(50);
        expect.soft(q, 'Ask AI quick prompts still advise').toEqual([]);
      }
    }
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A4 wordy text (263, 264, 267) + correlation tint (132) ================= */
test('A4 /liq wordy text and no forecast note (263)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/liq'); await page.waitForTimeout(20_000);
    const long = await page.evaluate(leafWords, { min: 16, skip: '.news-ticker, footer, .pf-footer, .ncard, .wf-row', exclude: '[class*=ticker]' });
    const body = await text(page);
    const drift = /often drifts toward|expiry nears/i.test(body); const model = /model only/i.test(body);
    const disc = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /modeled from open interest|approximate/i.test((e as HTMLElement).innerText || '')).map((e) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ').slice(0, 120)));
    T('A4-263', `/liq leaf texts of 16+ words: ${JSON.stringify(long)} · forecast note present ${drift} · "Model only" present ${model} · disclaimer/approximate lines ${JSON.stringify(disc)} · body ${body.length} chars`);
    expect.soft(body.length, 'CONTROL: /liq rendered nothing').toBeGreaterThan(500);
    expect.soft(long, '/liq still has leaf texts of 16 or more words').toEqual([]);
    expect.soft(drift, 'the max-pain forecast note is still on /liq').toBe(false);
  } finally { await ctx.close().catch(() => {}); }
});

test('A4 /dashboard footnotes and other long lines (264)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/dashboard'); await page.waitForTimeout(15_000);
    const long = await page.evaluate(leafWords, { min: 16, skip: '.news-ticker, footer, .pf-footer, .ncard, .sotd-text', exclude: '[class*=ticker]' });
    T('A4-264', `/dashboard leaf texts of 16+ words (Playbook body excluded, measured as a clamp in A1): ${JSON.stringify(long)}`);
    expect.soft(long, '/dashboard has leaf texts of 16 or more words').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

for (const theme of ['dark', 'light'] as Theme[]) {
  test(`A4 /correlation ${theme}: legend one short line, no scale line, heatmap tint (267, 132)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedOutContext(browser, { width: 1280, theme }); const page = await openPage(ctx);
    try {
      await gotoGuarded(page, '/correlation');
      await page.waitForSelector('.corr-grid', { timeout: 60_000 }).catch(() => T('A4-267', 'UNMEASURED: .corr-grid never rendered'));
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.corr-cell')).filter((c) => /^-?\d\.\d\d$/.test((c.textContent || '').trim())).length >= 6, undefined, { timeout: 70_000 }).catch(() => T('A4-132', 'fewer than 6 numeric correlation cells within 70 s'));
      await page.waitForTimeout(1500);
      const body = await text(page);
      const long = await page.evaluate(leafWords, { min: 14, skip: '.news-ticker, footer, .pf-footer, .ncard', exclude: '[class*=ticker]' });
      const legend = await page.evaluate(() => { const l = document.querySelector('.corr-legend') as HTMLElement | null; return l ? l.innerText.replace(/\s+/g, ' ').trim() : null; });
      T('A4-267', `${theme}: legend "${legend}" (${legend ? legend.split(/\s+/).length : 0} words) · scale line ("perfect sync") present ${/perfect sync/i.test(body)} · leaf texts of 14+ words ${JSON.stringify(long)}`);
      expect.soft(legend, 'no .corr-legend rendered').not.toBeNull();
      expect.soft((legend ?? '').split(/\s+/).filter(Boolean).length, 'legend over 15 words').toBeLessThan(16);
      expect.soft(/perfect sync|no relation/i.test(body), 'the separate scale line is still on the page').toBe(false);
      const cells = await page.evaluate(() => Array.from(document.querySelectorAll('.corr-cell')).map((c) => {
        const el = c as HTMLElement; const m = /: (-?\d+\.\d+)$/.exec(el.getAttribute('title') || ''); const p = /var\(--(green|red)\)\s+([\d.]+)%/.exec(el.getAttribute('style') || '');
        return { r: m ? parseFloat(m[1]) : null, col: p ? p[1] : null, pct: p ? parseFloat(p[2]) : null };
      }).filter((x) => x.r != null));
      const weak = cells.filter((c) => c.r! >= 0 && c.r! <= 0.34); const strong = cells.filter((c) => c.r! >= 0.37); const neg = cells.filter((c) => c.r! < -0.005);
      T('A4-132', `${theme}: ${cells.length} numeric cells · r in [0,0.34]: n=${weak.length}, tint % ${JSON.stringify([...new Set(weak.map((c) => c.pct))])} · r>=0.37: n=${strong.length}, tint % ${JSON.stringify([...new Set(strong.map((c) => c.pct))].slice(0, 6))} · negative: n=${neg.length}, min tint ${neg.length ? Math.min(...neg.map((c) => c.pct ?? 0)) : null} · zero r cells ${cells.filter((c) => c.r === 0).length}`);
      expect.soft(cells.length, 'UNMEASURED: no numeric correlation cells (the price history did not reach this site)').toBeGreaterThan(0);
      expect.soft(weak.filter((c) => c.pct !== 0), 'weak positive / zero cells that still carry a tint').toEqual([]);
      if (strong.length) expect.soft(strong.filter((c) => !(c.pct! > 0)), 'CONTROL: strong cells without a tint, so "0% on the weak ones" proves nothing').toEqual([]);
      await page.locator('.corr-grid-wrap').first().screenshot({ path: `qa/.shots/tick-a4-corr-${theme}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================= A5 landing widths (47) and /research at 390 (47) ================= */
for (const [w, theme] of [[768, 'dark'], [900, 'dark'], [1024, 'dark'], [1024, 'light'], [1100, 'dark'], [1160, 'dark'], [1280, 'dark']] as [number, Theme][]) {
  test(`A5 landing ${w} ${theme}: no sideways scroll, nothing clipped, Live Read panel inside the screen`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: w, height: 900, theme }); const page = await openPage(ctx);
    try {
      await gotoGuarded(page, '/');
      await page.waitForSelector('.lpt-root', { state: 'attached', timeout: 50_000 }).catch(() => T('A5', 'UNMEASURED: .lpt-root never rendered'));
      await page.waitForTimeout(7_000);
      const m = await page.evaluate((vw) => {
        const d = document.documentElement; const root = document.querySelector('.lpt-root') as HTMLElement | null;
        const vis = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
        const clipped: string[] = [];
        if (root) for (const e of Array.from(root.querySelectorAll('*'))) {
          if (e.closest('[class*=ticker]') || e.closest('svg')) continue;
          const own = Array.from(e.childNodes).filter((n) => n.nodeType === 3).map((n) => n.textContent || '').join('').trim();
          if (!own || !vis(e)) continue; const r = e.getBoundingClientRect();
          if (r.right > vw + 1 || r.left < -1) clipped.push(`${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(' ')[0]} "${own.slice(0, 24)}" L${Math.round(r.left)} R${Math.round(r.right)}`);
        }
        const lr = Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /live read/i.test((e as HTMLElement).innerText || '') && vis(e))[0] as HTMLElement | undefined;
        let panel: { left: number; right: number; w: number } | null = null;
        for (let a: HTMLElement | null = lr ?? null; a; a = a.parentElement) { const r = a.getBoundingClientRect(); if (r.width >= 280) { panel = { left: Math.round(r.left), right: Math.round(r.right), w: Math.round(r.width) }; break; } }
        const ctas = Array.from(document.querySelectorAll('a,button')).filter((b) => /start for free|see live briefing/i.test((b as HTMLElement).innerText || '') && vis(b)).map((b) => ({ t: (b as HTMLElement).innerText.trim().slice(0, 24), h: Math.round(b.getBoundingClientRect().height) }));
        return { docSW: d.scrollWidth, bodySW: document.body.scrollWidth, rootSW: root ? root.scrollWidth : null, rootCW: root ? root.clientWidth : null, hasLiveRead: !!lr, panel, clipped: clipped.slice(0, 6), nClipped: clipped.length, ctas };
      }, w);
      T('A5', `${w} ${theme}: document scrollWidth ${m.docSW} (requested ${w}) · body ${m.bodySW} · .lpt-root ${m.rootSW}/${m.rootCW} · Live Read found ${m.hasLiveRead}, panel ${JSON.stringify(m.panel)} · clipped text elements ${m.nClipped} ${JSON.stringify(m.clipped)} · CTAs ${JSON.stringify(m.ctas)}`);
      await page.screenshot({ path: `qa/.shots/tick-a5-landing-${w}-${theme}.png` }).catch(() => {});
      expect.soft(m.rootSW, 'UNMEASURED: .lpt-root absent').not.toBeNull();
      expect.soft(m.docSW, `landing scrolls sideways at ${w}`).toBeLessThanOrEqual(w);
      expect.soft(m.nClipped, `landing content runs past the screen at ${w}`).toBe(0);
      if (m.panel) expect.soft(m.panel.right, `Live Read panel right edge past ${w}`).toBeLessThanOrEqual(w);
      expect.soft(m.hasLiveRead, 'no LIVE READ text found (cannot say the panel is inside the screen)').toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
}

test('A5 /research at 390: the top pair is one column and no value is clipped', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 390, height: 844 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/research');
    await page.waitForSelector('.research-pair', { state: 'attached', timeout: 50_000 }).catch(() => T('A5-47b', 'UNMEASURED: .research-pair never rendered'));
    await page.waitForTimeout(8_000);
    const m = await page.evaluate(() => {
      const p = document.querySelector('.research-pair') as HTMLElement | null; if (!p) return null;
      const cols = getComputedStyle(p).gridTemplateColumns.split(' ').length; const pr = p.getBoundingClientRect();
      const clipped: string[] = [];
      for (const e of Array.from(p.querySelectorAll('*'))) { const h = e as HTMLElement; if ((h.innerText || '').trim() && h.scrollWidth > h.clientWidth + 1 && getComputedStyle(h).overflow !== 'visible') clipped.push(`${h.tagName.toLowerCase()}.${String(h.className).split(' ')[0]} sw${h.scrollWidth}>cw${h.clientWidth} "${(h.innerText || '').slice(0, 20)}"`); }
      const kids = Array.from(p.children).map((c) => Math.round(c.getBoundingClientRect().width));
      return { cols, left: Math.round(pr.left), right: Math.round(pr.right), kids, clipped, docSW: document.documentElement.scrollWidth };
    });
    T('A5-47b', `/research 390: ${JSON.stringify(m)}`);
    expect.soft(m, 'UNMEASURED: no .research-pair').not.toBeNull();
    if (m) { expect.soft(m.cols, 'research pair still two columns at 390').toBe(1); expect.soft(m.clipped, 'clipped values inside the research pair').toEqual([]); expect.soft(m.docSW, 'sideways scroll at 390').toBeLessThanOrEqual(390); }
    await page.screenshot({ path: 'qa/.shots/tick-a5-research-390.png' }).catch(() => {});
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A6 slow 3G (186, 187) ================= */
async function throttled(browser: import('@playwright/test').Browser, path: string, o: { blockFonts?: boolean; throttle: boolean }) {
  const ctx = await signedOutContext(browser, { width: 390, height: 844 });
  await ctx.addInitScript(() => {
    const s: { lcp: number; sw: [number, number][] } = { lcp: 0, sw: [] }; (window as unknown as { __tk: typeof s }).__tk = s;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* none */ }
    const t0 = performance.now(); const tick = () => { const d = document.documentElement; if (d) s.sw.push([Math.round(performance.now() - t0), d.scrollWidth]); if (performance.now() - t0 < 42_000) setTimeout(tick, 400); }; tick();
  });
  const page = await openPage(ctx);
  await gotoGuarded(page, '/api/version'); /* sets the gate cookie while still unthrottled */
  if (o.blockFonts) await page.route(/\.(woff2?|ttf|otf)(\?|$)/, (r) => r.abort());
  if (o.throttle) { const cdp = await ctx.newCDPSession(page); await cdp.send('Network.enable'); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: (500 * 1024) / 8, uploadThroughput: (500 * 1024) / 8 }); }
  const t0 = Date.now();
  await page.goto(path, { waitUntil: 'commit', timeout: 60_000 }).catch(() => {});
  await page.waitForTimeout(44_000);
  const r = await page.evaluate(() => (window as unknown as { __tk?: { lcp: number; sw: [number, number][] } }).__tk ?? null).catch(() => null);
  const body = await page.evaluate(() => document.body?.innerText.length ?? 0).catch(() => -1);
  void t0; await ctx.close().catch(() => {});
  return { r, body };
}
for (const path of ['/about', '/faq', '/']) {
  test(`A6 slow 3G (500 kbit/s, 400 ms) at 390 on ${path}: main content time (box 186) and sideways width (box 187)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const { r, body } = await throttled(browser, path, { throttle: true });
    const sw = r?.sw ?? []; const maxSW = sw.length ? Math.max(...sw.map((x) => x[1])) : null;
    const over = sw.filter((x) => x[1] > 390);
    T('A6', `${path}: LCP ${r?.lcp} ms · body text ${body} chars after 44 s · document scrollWidth max ${maxSW} over ${sw.length} samples (requested 390) · samples over 390: ${over.length} ${JSON.stringify(over.slice(0, 5))} · series ${JSON.stringify(sw.filter((_, i) => i % 12 === 0))}`);
    expect.soft(r?.lcp ?? 0, `${path}: no LCP recorded within 44 s`).toBeGreaterThan(0);
    expect.soft(r?.lcp ?? 1e9, `${path}: main content at or above 11.4 s on slow 3G (box 186 floor)`).toBeLessThan(11_400);
    if (path === '/') expect.soft(maxSW ?? 9999, 'landing scrolls sideways at 390 on slow 3G').toBeLessThanOrEqual(390);
  });
}
test('A6 landing at 390 with every font request refused (late fonts, no throttle): sideways width', async ({ browser }) => {
  test.setTimeout(120_000);
  const { r } = await throttled(browser, '/', { blockFonts: true, throttle: false });
  const sw = r?.sw ?? []; const maxSW = sw.length ? Math.max(...sw.map((x) => x[1])) : null;
  T('A6-fonts', `/ with fonts refused: document scrollWidth max ${maxSW} over ${sw.length} samples (requested 390) · LCP ${r?.lcp}`);
  expect.soft(sw.length, 'UNMEASURED: no samples').toBeGreaterThan(5);
  expect.soft(maxSW ?? 9999, 'landing scrolls sideways at 390 with fonts refused').toBeLessThanOrEqual(390);
});

/* ================= A7 Russian / Korean leftovers (118, 143, 222, 128) ================= */
const NAMED_EN: [string, RegExp][] = [['Levels', /^Levels$/], ['SL', /^SL$/], ['Entry', /^Entry$/], ['TP', /^TP$/], ['Fast avg', /Fast avg/i], ['Mid avg', /Mid avg/i], ['Slow avg', /Slow avg/i], ['candles held', /candles held/i],
  ['Explain signal', /Explain signal/i], ['Strategy', /^Strategy$/], ['Draw', /^Draw$/], ['Clear all', /^Clear all$/i], ['S/R', /^S\/R$/], ['Structure', /^Structure$/], ['Liq', /^Liq$/], ['estimated', /estimated/i], ['Spot Absorption', /Spot Absorption/i],
  ['All neutral', /All neutral/i], ['Refund Policy', /Refund Policy/i], ['Security & data', /Security & data/i], ['Stable', /^Stable$/], ['Perps vs Spot', /Perps vs Spot/i], ['Install', /install/i]];
for (const [lang, path] of [['ru', '/arena?coin=btc&tf=1h'], ['ru', '/dashboard'], ['ru', '/correlation'], ['ru', '/econ-calendar'], ['ru', '/upgrade'], ['ru', '/settings'], ['ko', '/arena?coin=btc&tf=1h'], ['zh', '/arena?coin=btc&tf=1h']] as const) {
  test(`A7 ${lang} ${path}: English left on the page`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedOutContext(browser, { width: 1280, lang }); const page = await openPage(ctx);
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(path.startsWith('/arena') ? 22_000 : 14_000);
      /* the labels load after first paint: wait until the page body holds a non-Latin letter */
      await page.waitForFunction(() => /[Ѐ-ӿ぀-ヿ一-鿿가-힯]/.test(document.body.innerText), undefined, { timeout: 20_000 }).catch(() => T('A7', `${lang} ${path}: the page never showed ${lang} letters (labels not applied)`));
      const en = await page.evaluate(nonLocal, { lang });
      const named = NAMED_EN.filter(([, re]) => en.some((x) => re.test(x.t))).map(([n]) => n);
      const titles = en.filter((x) => x.k !== 'text' && x.t.length > 25).map((x) => `${x.k}:${x.t}`);
      T('A7', `${lang} ${path}: ${en.length} Latin-only strings (text/title/aria/placeholder) · named English strings from the box still present: ${JSON.stringify(named)} · long titles/aria ${JSON.stringify(titles.slice(0, 14))} · all ${JSON.stringify(en.slice(0, 70).map((x) => `${x.k}:${x.t}`))}`);
      if (path === '/dashboard' && lang === 'ru') {
        const oi1 = await page.evaluate(() => Array.from(document.querySelectorAll('.edge-card')).map((c) => ((c as HTMLElement).innerText || '').replace(/\s+/g, ' ').trim()).filter((t) => /\d/.test(t)).slice(0, 12));
        T('A7-143', `ru dashboard edge cards: ${JSON.stringify(oi1)}`);
        expect.soft(oi1.join(' ').match(/\bStable\b/g) ?? [], 'the English word "Stable" on the ru dashboard').toEqual([]);
      }
      expect.soft(named, `${lang} ${path}: English strings the box lists`).toEqual([]);
      await page.screenshot({ path: `qa/.shots/tick-a7-${lang}-${path.replace(/[^a-z]/g, '')}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================= A8 sign-up error wiring (220) ================= */
test('A8 /login?signup=1: a mismatched password gives an alert tied to the fields', async ({ browser }) => {
  test.setTimeout(100_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/login?signup=1');
    await page.waitForSelector('[data-testid="login-email"], #pw-email', { state: 'attached', timeout: 40_000 });
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /use password|password/i.test(x.textContent || '') && !/sign in|create/i.test(x.textContent || '')); (b as HTMLElement | undefined)?.click(); });
    await page.waitForSelector('#pw-email', { state: 'visible', timeout: 20_000 });
    await page.evaluate(() => { const t = Array.from(document.querySelectorAll('.login-pw-tab')).find((x) => /sign ?up|create|register/i.test(x.textContent || '')); (t as HTMLElement | undefined)?.click(); });
    await page.waitForTimeout(600);
    const pw = page.locator('input[type=password]'); const n = await pw.count();
    T('A8', `password inputs on the signup tab: ${n}`);
    await page.fill('#pw-email', 'qa-tick1185-nobody@example.invalid');
    if (n >= 2) { await pw.nth(0).fill('Tick-1185-aaaa1'); await pw.nth(1).fill('Tick-1185-bbbb2'); }
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /create account|sign up|register/i.test(x.textContent || '') && !x.classList.contains('login-pw-tab')); (b as HTMLElement | undefined)?.click(); });
    await page.waitForFunction(() => ((document.querySelector('#pw-error') as HTMLElement | null)?.textContent || '').trim() !== '', undefined, { timeout: 15_000 }).catch(() => {});
    const s = await page.evaluate(() => {
      const err = document.querySelector('#pw-error') as HTMLElement | null;
      const ins = ['#pw-email', ...Array.from(document.querySelectorAll('input[type=password]')).map((_, i) => `input[type=password]:nth-of-type(${i + 1})`)];
      return { text: (err?.textContent || '').trim(), role: err?.getAttribute('role') ?? null, inputs: [['#pw-email', document.querySelector('#pw-email')], ...Array.from(document.querySelectorAll('input[type=password]')).map((e, i) => [`password#${i + 1}`, e])].map(([n, e]) => ({ n: n as string, invalid: (e as Element).getAttribute('aria-invalid'), described: (e as Element).getAttribute('aria-describedby') })), ins };
    });
    T('A8', `signup error: ${JSON.stringify(s)}`);
    expect.soft(s.text, 'no error text appeared on a mismatched signup (cannot verify the wiring)').not.toBe('');
    expect.soft(s.role, 'error container is not role=alert').toBe('alert');
    for (const i of s.inputs) { expect.soft(i.invalid, `${i.n} has no aria-invalid`).toBe('true'); expect.soft(i.described ?? '', `${i.n} not described by the error`).toContain('pw-error'); }
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A9 contrast / axe (192, 257) ================= */
async function axeContrast(page: Page) {
  await page.addScriptTag({ path: AXE });
  return page.evaluate(async () => {
    // @ts-expect-error axe is injected
    const r = await window.axe.run(document, { runOnly: ['color-contrast'] });
    return r.violations.flatMap((v: { nodes: { target: string[]; any: { message: string }[]; html: string }[] }) => v.nodes.map((n) => ({ t: n.target.join(' ').slice(0, 90), m: (n.any[0]?.message || '').replace(/\s+/g, ' ').slice(0, 130), h: n.html.slice(0, 70) })));
  });
}
for (const [path, theme, wait, fixture] of [['/liq', 'dark', 20_000, false], ['/liq', 'light', 20_000, false], ['/funding', 'dark', 16_000, false], ['/briefing', 'dark', 14_000, true], ['/briefing', 'light', 14_000, true], ['/news', 'dark', 12_000, false], ['/news', 'light', 12_000, false], ['/arena?coin=btc&tf=1h', 'light', 20_000, false], ['/arena?coin=btc&tf=1h', 'dark', 20_000, false]] as [string, Theme, number, boolean][]) {
  test(`A9 axe color-contrast ${path} ${theme}`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 1280, theme }); const page = await openPage(ctx);
    if (fixture) await installNewsFixture(page);
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(wait);
      const th = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      const v = await axeContrast(page);
      const named = v.filter((x: { t: string; h: string }) => /liq-section-est|mb-event-tag|edge-card|ncard-empty|empty|wf-row|fund.*nodata|no-data/i.test(x.t + ' ' + x.h));
      T('A9', `${path} ${theme} (data-theme=${th}): ${v.length} contrast violations ${JSON.stringify(v.slice(0, 12))} · matching the box's named elements: ${JSON.stringify(named)}`);
      expect.soft(th === 'light' ? th : 'ok', 'the page is not on the requested theme').toBe(theme === 'light' ? 'light' : 'ok');
      expect.soft(v, `${path} ${theme}: serious contrast violations`).toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ================= A10 failure shown as a value (46) ================= */
test('A10 data feeds killed: no confident empty/zero values at the 7 audited sites', async ({ browser }) => {
  test.setTimeout(240_000);
  const kill = async (page: Page) => { await page.route(/\/api\/(proxy|market|oi|cmc|liq)/, (r) => r.abort()); await page.routeWebSocket(/.*/, (ws) => ws.close()); };
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await kill(page);
    /* /scanner: SetupScanner, AccumulationTracker, DistributionTracker */
    await gotoGuarded(page, '/scanner'); await page.waitForTimeout(40_000);
    let body = await text(page);
    const bad = body.match(/No setups match|No strong setups|No coins match|No stealth accumulation detected|No distribution detected/gi) ?? [];
    T('A10', `/scanner with feeds refused: ${body.length} chars · confident-empty phrases ${JSON.stringify(bad)} · headings present ${JSON.stringify(body.match(/Setup Scanner|Accumulation|Distribution/gi)?.slice(0, 6) ?? [])}`);
    expect.soft(body.length, 'CONTROL: /scanner rendered nothing').toBeGreaterThan(300);
    expect.soft(bad, '/scanner shows an empty result as if the read had succeeded').toEqual([]);
    await page.screenshot({ path: 'qa/.shots/tick-a10-scanner.png' }).catch(() => {});
    /* /arena: Multi-timeframe card and Confluence */
    await gotoGuarded(page, '/arena?coin=btc&tf=1h'); await page.waitForTimeout(40_000);
    body = await text(page);
    const mtf = body.match(/Mixed Signals|No clear directional bias|No data|unavailable/gi) ?? [];
    const pcts = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^0%$/.test(((e as HTMLElement).innerText || '').trim())).length);
    T('A10', `/arena btc with feeds refused: multi-timeframe phrases ${JSON.stringify(mtf)} · bare "0%" leaf elements ${pcts} · confluence mentions ${JSON.stringify(body.match(/Confluence[^\n]{0,40}/gi)?.slice(0, 3) ?? [])}`);
    expect.soft(body.match(/Mixed Signals|No clear directional bias/gi) ?? [], '/arena claims "Mixed Signals" with no readings').toEqual([]);
    await page.screenshot({ path: 'qa/.shots/tick-a10-arena.png' }).catch(() => {});
    /* landing: "Setup 0" */
    await gotoGuarded(page, '/'); await page.waitForTimeout(30_000);
    body = await text(page);
    const s0 = body.match(/Setup\s*0\b|NO READ/gi) ?? [];
    T('A10', `landing with feeds refused: ${body.length} chars · "Setup 0" / "NO READ" ${JSON.stringify(s0)}`);
    expect.soft(s0, 'landing hero shows "Setup 0" / "NO READ" as a reading').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

test('A10 /news All tab with the news read refused: no endless Loading', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await page.route((u) => u.href.includes('/rest/v1/') && /news\b/i.test(u.pathname), (r) => r.abort());
    await gotoGuarded(page, '/news'); await page.waitForTimeout(35_000);
    const m = await page.evaluate(() => ({ text: document.body.innerText.slice(0, 600).replace(/\s+/g, ' '), skeletons: document.querySelectorAll('[class*=skeleton], [class*=Skeleton], [aria-busy=true]').length, loading: (document.body.innerText.match(/loading/gi) ?? []).length }));
    T('A10-news', `news read refused, after 35 s: skeleton-ish elements ${m.skeletons} · "loading" words ${m.loading} · text start "${m.text.slice(0, 300)}"`);
    expect.soft(m.skeletons + m.loading, 'the News page is still loading after its read failed').toBe(0);
  } finally { await ctx.close().catch(() => {}); }
});

/* ================= A11 news tags (156) ================= */
test('A11 /news: a "presidential" headline is not tagged TRUMP/TARIFF, a real tariff headline still is (control)', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  await installNewsFixture(page);
  try {
    await gotoGuarded(page, '/news');
    await page.waitForSelector('.ncard-grid', { state: 'attached', timeout: 40_000 });
    const tabCount = await page.locator('.ntab-btn').count(); const seen = new Map<string, { headline: string; tag: string }>();
    for (let ti = 0; ti < tabCount; ti++) {
      await page.locator('.ntab-btn').nth(ti).click(); await page.waitForTimeout(1_200);
      for (const c of await page.evaluate(() => Array.from(document.querySelectorAll('article.ncard-grid')).map((a) => ({ headline: (a.querySelector('.ncard-grid-headline')?.textContent || '').trim(), tag: Array.from(a.querySelectorAll('.ncard-tags span')).map((s) => (s.textContent || '').trim()).join(' | ') })))) seen.set(c.headline, c);
    }
    const cards = [...seen.values()];
    const vance = cards.filter((c) => /presidential/i.test(c.headline)); const tariff = cards.filter((c) => /tariff/i.test(c.headline));
    T('A11', `tags: presidential headline(s) ${JSON.stringify(vance)} · tariff control ${JSON.stringify(tariff)} · ${cards.length} cards`);
    expect.soft(vance.length, 'the fixture "presidential" headline did not render').toBeGreaterThan(0);
    expect.soft(tariff.some((c) => /trump|tariff/i.test(c.tag)), 'CONTROL: the tariff headline is not tagged TRUMP/TARIFF').toBe(true);
    expect.soft(vance.filter((c) => /trump|tariff/i.test(c.tag)), '"presidential" alone tags a headline TRUMP/TARIFF').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});
