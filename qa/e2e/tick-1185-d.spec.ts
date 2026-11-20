/* #1185 TICK CELLS, part D (signed out, throw-away): second pass on the cells that part A could not settle. Read-only, paid-AI fence on, nothing written, no credential typed.
 * The correlation cell feeds SYNTHETIC candles to the real deployed page (the klines read is answered in the browser) so that weak, zero and negative correlations exist to be measured. */
import { test, expect, type Page } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { signedOutContext, openPage, installNewsFixture, contrastProbe, type Theme } from './_v1185';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
const text = (page: Page) => page.evaluate(() => document.body.innerText);
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); });

/* ---------- D1: the dashboard once the market read has settled (159, 214, 272, 213) ---------- */
test('D1 /dashboard settled: Market read lines, Weekday effect, Smart money word, OI cards agree', async ({ browser }) => {
  test.setTimeout(240_000);
  const ctx = await signedOutContext(browser, { width: 1280, theme: 'dark' }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/dashboard');
    await page.waitForFunction(() => { const v = (document.querySelector('.mr-verdict') as HTMLElement | null)?.innerText ?? ''; return v !== '' && !/reading/i.test(v); }, undefined, { timeout: 110_000 }).catch(() => T('D1', 'the market read never left "Reading the market" within 110 s'));
    await page.waitForFunction(() => Array.from(document.querySelectorAll('.edge-card')).some((c) => /open interest/i.test((c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText ?? '') && !/hour|1h/i.test((c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText ?? '') && ((c.querySelector('.edge-card-value, .edge-card-signal') as HTMLElement | null)?.innerText ?? '').trim().length > 2), undefined, { timeout: 60_000 }).catch(() => T('D1', 'the OI trend card never carried text within 60 s'));
    await page.waitForTimeout(3_000);
    const mr = await page.evaluate(() => ({
      verdict: (document.querySelector('.mr-verdict') as HTMLElement | null)?.innerText ?? null, sub: (document.querySelector('.mr-sub') as HTMLElement | null)?.innerText ?? null, score: (document.querySelector('.mr-score') as HTMLElement | null)?.innerText ?? null,
      dir: (document.querySelector('[data-testid="mr-direction"]') as HTMLElement | null)?.innerText ?? null,
      factors: Array.from(document.querySelectorAll('.mr-factor')).map((f) => ({ k: (f.querySelector('.mr-factor-k') as HTMLElement | null)?.innerText ?? '', v: (f.querySelector('.mr-factor-v') as HTMLElement | null)?.innerText ?? '', s: (f.querySelector('.mr-factor-s') as HTMLElement | null)?.innerText ?? '' })),
    }));
    T('D1', `market read: ${JSON.stringify(mr)}`);
    const body = await text(page);
    const adv = body.match(/good time to trade|better to wait|be picky|be selective|decent conditions|weak setup/gi) ?? [];
    T('D1-272', `settled: ${!/reading/i.test(mr.verdict ?? 'reading')} · verdict "${mr.verdict}" · sub "${mr.sub}" (${(mr.sub ?? '').split(/\s+/).filter(Boolean).length} words) · advice words ${JSON.stringify(adv)}`);
    expect.soft(/reading/i.test(mr.verdict ?? 'reading'), 'UNMEASURED: the verdict is still the pending line, so a settled verdict was not observed').toBe(false);
    expect.soft(adv, 'advice words on the dashboard').toEqual([]);
    expect.soft((mr.sub ?? '').split(/\s+/).filter(Boolean).length, 'Market read sub-line over 12 words').toBeLessThanOrEqual(12);
    const sm = mr.factors.find((f) => /smart money/i.test(f.k)); const wd = mr.factors.find((f) => /weekday effect/i.test(f.k));
    T('D1-214', `Smart money tile ${JSON.stringify(sm)} · Weekday effect tile ${JSON.stringify(wd)} (control: the weekday tile's sub-line has the N/M shape the old Smart money value had)`);
    expect.soft(sm, 'no Smart money tile').toBeTruthy();
    if (sm) expect.soft(/\d+\s*\/\s*\d+/.test(sm.v + ' ' + sm.s), 'Smart money still shows N/M').toBe(false);
    const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.edge-card')).map((c) => ({ l: (c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '', v: (c.querySelector('.edge-card-value') as HTMLElement | null)?.innerText.trim() ?? '', s: (c.querySelector('.edge-card-signal') as HTMLElement | null)?.innerText.trim() ?? '' })));
    T('D1-213', `edge cards: ${JSON.stringify(cards)}`);
    const oiCard = cards.find((c) => /open interest/i.test(c.l) && !/hour|1h/i.test(c.l)); const oi1 = cards.find((c) => /open interest|oi/i.test(c.l) && /hour|1h/i.test(c.l));
    if (oiCard && oi1 && /^[+-]?\d/.test(oi1.v) && (oiCard.v || oiCard.s)) {
      const pct = parseFloat(oi1.v.replace('+', '')); const up = /new buyers|new sellers/i.test(oiCard.v); const down = /short covering|long exits/i.test(oiCard.v);
      T('D1-213', `trend card "${oiCard.v}" / "${oiCard.s}" · 1h card ${oi1.v} "${oi1.s}" -> trend card says OI ${up ? 'rising' : down ? 'falling' : 'flat/other'}, 1h figure ${pct >= 0 ? 'up' : 'down'}`);
      if (up) expect.soft(pct, 'trend card says OI rising while the 1h figure is negative').toBeGreaterThanOrEqual(0);
      if (down) expect.soft(pct, 'trend card says OI falling while the 1h figure is positive').toBeLessThanOrEqual(0);
    } else T('D1-213', `UNMEASURED: trend card ${JSON.stringify(oiCard)} · 1h card ${JSON.stringify(oi1)}`);
  } finally { await ctx.close().catch(() => {}); }
});

/* ---------- D2: Playbook card clamp where the text is long enough to need it (264) ---------- */
for (const w of [390, 768]) {
  test(`D2 /dashboard Playbook card at ${w}: body clamped to two lines, a More link, and More really expands`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: w, height: 900, theme: 'dark' }); const page = await openPage(ctx);
    try {
      await gotoGuarded(page, '/dashboard'); await page.waitForSelector('.sotd-text', { state: 'attached', timeout: 60_000 }); await page.waitForTimeout(4_000);
      const m = await page.evaluate(() => { const el = document.querySelector('.sotd-text') as HTMLElement; const lh = parseFloat(getComputedStyle(el).lineHeight); const more = document.querySelector('.sotd-more') as HTMLButtonElement | null; return { lines: Math.round(el.getBoundingClientRect().height / lh), h: Math.round(el.getBoundingClientRect().height), scrollH: el.scrollHeight, clamped: el.classList.contains('sotd-text-clamped'), words: (el.textContent || '').trim().split(/\s+/).length, more: more ? { text: more.innerText, expanded: more.getAttribute('aria-expanded') } : null }; });
      T('D2', `${w}: ${JSON.stringify(m)}`);
      expect.soft(m.lines, `Playbook body is ${m.lines} lines at ${w}`).toBeLessThanOrEqual(2);
      if (m.scrollH > m.h + 4) {
        expect.soft(m.more, 'text is longer than the clamp but no More link').not.toBeNull();
        if (m.more) { await page.locator('.sotd-more').click(); await page.waitForTimeout(500); const h1 = await page.evaluate(() => Math.round((document.querySelector('.sotd-text') as HTMLElement).getBoundingClientRect().height)); const ex = await page.evaluate(() => document.querySelector('.sotd-more')?.getAttribute('aria-expanded')); T('D2', `${w}: control, after More: body ${h1} px (was ${m.h}), aria-expanded ${ex}`); expect.soft(h1, 'More did not expand the body').toBeGreaterThan(m.h + 2); }
      } else T('D2', `${w}: the text fits in ${m.lines} line(s); no clamp needed (control unavailable at this width)`);
      await page.screenshot({ path: `qa/.shots/tick-d2-playbook-${w}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ---------- D3: correlation heatmap tint with synthetic candles (132) ---------- */
const hash = (s: string) => { let x = 2166136261; for (const c of s) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };
const prng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());
function candles(sym: string, n: number): string[][] {
  const common = prng(12345); const idio = prng(hash(sym)); const grouped = hash(sym) % 3 === 0; let p = 100; const out: string[][] = []; const t0 = Date.UTC(2026, 10, 1);
  for (let i = 0; i < n; i++) { const c = gauss(common), d = gauss(idio); const r = (grouped ? 0.9 * c + 0.44 * d : d) * 0.01; const o = p; p = p * Math.exp(r); out.push([String(t0 + i * 3600_000), String(o), String(Math.max(o, p)), String(Math.min(o, p)), String(p), '1000']); }
  return out;
}
for (const theme of ['dark', 'light'] as Theme[]) {
  test(`D3 /correlation ${theme} with synthetic candles: no tint at or near zero, tint on strong, red on negative (box 132)`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedOutContext(browser, { width: 1280, theme }); const page = await openPage(ctx);
    await page.route('**/api/market/klines**', (route) => { const u = new URL(route.request().url()); const n = Math.min(300, Number(u.searchParams.get('limit')) || 100); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(candles(u.searchParams.get('symbol') ?? 'X', n)) }); });
    try {
      await gotoGuarded(page, '/correlation');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.corr-cell')).filter((c) => /^-?\d\.\d\d$/.test((c.textContent || '').trim())).length >= 20, undefined, { timeout: 90_000 }).catch(() => T('D3', 'fewer than 20 numeric cells within 90 s'));
      await page.waitForTimeout(2_000);
      const cells = await page.evaluate(() => Array.from(document.querySelectorAll('.corr-cell')).map((c) => { const el = c as HTMLElement; const m = /: (-?\d+\.\d+)$/.exec(el.getAttribute('title') || ''); const p = /var\(--(green|red)\)\s+([\d.]+)%/.exec(el.getAttribute('style') || ''); return { r: m ? parseFloat(m[1]) : null, shown: (el.textContent || '').trim(), col: p ? p[1] : null, pct: p ? parseFloat(p[2]) : null }; }).filter((x) => x.r != null));
      const weak = cells.filter((c) => c.r! >= 0 && c.r! <= 0.34); const zero = cells.filter((c) => Math.abs(c.r!) < 0.005); const strong = cells.filter((c) => c.r! >= 0.37); const neg = cells.filter((c) => c.r! < -0.005);
      const pcts = (a: typeof cells) => JSON.stringify([...new Set(a.map((c) => c.pct))].slice(0, 8));
      T('D3', `${theme}: ${cells.length} numeric cells · r in [0,0.34] n=${weak.length} tint% ${pcts(weak)} · |r|<0.005 n=${zero.length} tint% ${pcts(zero)} · r>=0.37 n=${strong.length} tint% ${pcts(strong)} · r<0 n=${neg.length} tint% ${pcts(neg)} colours ${JSON.stringify([...new Set(neg.map((c) => c.col))])}`);
      expect.soft(weak.length, 'UNMEASURED: no cell in the weak band even with synthetic data').toBeGreaterThan(0);
      expect.soft(weak.filter((c) => c.pct !== 0), 'weak positive / zero cells that still carry a tint').toEqual([]);
      expect.soft(strong.length, 'CONTROL: no strong cell').toBeGreaterThan(0);
      expect.soft(strong.filter((c) => !(c.pct! > 0)), 'CONTROL: strong cells without a tint').toEqual([]);
      await page.locator('.corr-grid-wrap').first().screenshot({ path: `qa/.shots/tick-d3-corr-${theme}.png` }).catch(() => {});
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ---------- D4: auth error wiring on login and forgot-password (220) ---------- */
const BAD_EMAIL = 'qa-tick1185-nobody@example.invalid';
async function authShape(page: Page, errSel: string, inputs: string[]) {
  return page.evaluate(([e, ins]) => { const err = document.querySelector(e as string) as HTMLElement | null; return { present: !!err, role: err?.getAttribute('role') ?? null, text: (err?.textContent || '').trim(), id: err?.id ?? '', inputs: (ins as string[]).map((s) => { const el = document.querySelector(s); return { sel: s, invalid: el?.getAttribute('aria-invalid') ?? null, describedby: el?.getAttribute('aria-describedby') ?? null }; }) }; }, [errSel, inputs] as [string, string[]]);
}
test('D4 /login (password): the alert exists empty, then the fields are invalid and described by it', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/login'); await page.waitForSelector('[data-testid="login-email"]', { state: 'visible', timeout: 40_000 });
    await page.evaluate(() => { const b = Array.from(document.querySelectorAll('button')).find((x) => /use password/i.test(x.textContent || '')); (b as HTMLElement | undefined)?.click(); });
    await page.waitForSelector('input[type=password]', { state: 'visible', timeout: 20_000 });
    const ins = ['#pw-email', 'input[type=password]']; const before = await authShape(page, '#pw-error', ins);
    await page.fill('#pw-email', BAD_EMAIL); await page.fill('input[type=password]', 'not-a-real-password-1'); await page.press('input[type=password]', 'Enter');
    await page.waitForFunction(() => ((document.querySelector('#pw-error') as HTMLElement | null)?.textContent || '').trim() !== '', undefined, { timeout: 25_000 }).catch(() => {});
    const after = await authShape(page, '#pw-error', ins);
    T('D4', `/login password: before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);
    expect.soft(before.present && before.role === 'alert' && before.text === '', 'role=alert container must exist and be empty before the error').toBe(true);
    expect.soft(after.text, 'no error text appeared (cannot verify the linking)').not.toBe('');
    for (const i of after.inputs) { expect.soft(i.invalid, `${i.sel} has no aria-invalid`).toBe('true'); expect.soft(i.describedby ?? '', `${i.sel} is not linked to the error`).toContain(after.id); }
  } finally { await ctx.close().catch(() => {}); }
});
test('D4 /forgot-password: same shape', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/forgot-password'); await page.waitForSelector('[data-testid="login-email"]', { state: 'visible', timeout: 40_000 });
    const ins = ['[data-testid="login-email"]']; const before = await authShape(page, '#forgot-error', ins);
    await page.fill('[data-testid="login-email"]', BAD_EMAIL); await page.press('[data-testid="login-email"]', 'Enter');
    await page.waitForFunction(() => ((document.querySelector('#forgot-error') as HTMLElement | null)?.textContent || '').trim() !== '', undefined, { timeout: 25_000 }).catch(() => {});
    const after = await authShape(page, '#forgot-error', ins);
    T('D4', `/forgot-password: before ${JSON.stringify(before)} · after ${JSON.stringify(after)}`);
    expect.soft(before.present && before.role === 'alert' && before.text === '', 'role=alert container must exist and be empty before the error').toBe(true);
    expect.soft(after.text, 'no error appeared for an invalid email: linking not observable').not.toBe('');
    expect.soft(after.inputs[0].invalid, 'email input has no aria-invalid').toBe('true'); expect.soft(after.inputs[0].describedby ?? '', 'email input not linked').toContain(after.id);
  } finally { await ctx.close().catch(() => {}); }
});

/* ---------- D5: Vance headline tags on /news and in the Briefing events (156) ---------- */
test('D5 news fixture: every tab headline with its tags, and the Briefing events row for the Vance headline', async ({ browser }) => {
  test.setTimeout(150_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx); await installNewsFixture(page);
  try {
    await gotoGuarded(page, '/news'); await page.waitForSelector('.ncard-grid, .ncard', { state: 'attached', timeout: 40_000 }).catch(() => T('D5', 'no cards'));
    const tabs = await page.locator('.ntab-btn').count(); const all = new Map<string, string>();
    for (let i = 0; i < tabs; i++) {
      await page.locator('.ntab-btn').nth(i).click(); await page.waitForTimeout(1_200);
      const label = ((await page.locator('.ntab-btn').nth(i).textContent()) ?? '').replace(/\s+/g, ' ').trim();
      const cs = await page.evaluate(() => Array.from(document.querySelectorAll('article, .ncard, .ncard-grid')).map((a) => ({ h: ((a.querySelector('[class*=headline]') as HTMLElement | null)?.innerText ?? '').trim(), tags: Array.from(a.querySelectorAll('[class*=tags] span, [class*=tag]')).map((s) => (s.textContent || '').trim()).filter(Boolean).join(' | ') })).filter((x) => x.h));
      T('D5', `tab "${label}": ${JSON.stringify(cs)}`); for (const c of cs) all.set(c.h, c.tags);
    }
    const vance = [...all.entries()].filter(([h]) => /presidential/i.test(h)); const tariff = [...all.entries()].filter(([h]) => /tariff/i.test(h));
    T('D5-156', `presidential headline(s) ${JSON.stringify(vance)} · tariff control ${JSON.stringify(tariff)}`);
    await gotoGuarded(page, '/briefing'); await page.waitForTimeout(14_000);
    const ev = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /presidential/i.test((e as HTMLElement).innerText || '')).map((e) => { let r: HTMLElement | null = e as HTMLElement; for (let i = 0; i < 4 && r && !r.querySelector('.mb-event-tag'); i++) r = r.parentElement; return { h: (e as HTMLElement).innerText.slice(0, 70), row: r ? r.innerText.replace(/\s+/g, ' ').slice(0, 160) : null }; }));
    T('D5-156', `briefing rows containing the presidential headline: ${JSON.stringify(ev)}`);
    expect.soft(tariff.some(([, t]) => /trump|tariff/i.test(t)), 'CONTROL: the tariff headline is not tagged').toBe(true);
    expect.soft(vance.length, 'the presidential headline did not render on /news (cannot say how it is tagged)').toBeGreaterThan(0);
    expect.soft(vance.filter(([, t]) => /trump|tariff/i.test(t)), '"presidential" tags a headline TRUMP/TARIFF').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ---------- D6: slow 3G with the audit matrix's own profile (400 kbit/s down, 200 up, 400 ms) (186, 187) ---------- */
async function slow(browser: import('@playwright/test').Browser, path: string, throttle: boolean) {
  const ctx = await signedOutContext(browser, { width: 390, height: 844 });
  await ctx.addInitScript(() => {
    const s: { lcp: number; sw: [number, number][] } = { lcp: 0, sw: [] }; (window as unknown as { __tk: typeof s }).__tk = s;
    try { new PerformanceObserver((l) => { for (const e of l.getEntries()) s.lcp = Math.round(e.startTime); }).observe({ type: 'largest-contentful-paint', buffered: true }); } catch { /* none */ }
    const t0 = performance.now(); const tick = () => { const d = document.documentElement; if (d) s.sw.push([Math.round(performance.now() - t0), d.scrollWidth]); if (performance.now() - t0 < 38_000) setTimeout(tick, 400); }; tick();
  });
  const page = await openPage(ctx); await gotoGuarded(page, '/api/version');
  if (throttle) { const c = await ctx.newCDPSession(page); await c.send('Network.enable'); await c.send('Network.emulateNetworkConditions', { offline: false, latency: 400, downloadThroughput: Math.round((400 * 1024) / 8), uploadThroughput: Math.round((200 * 1024) / 8) }); }
  await page.goto(path, { waitUntil: 'commit', timeout: 60_000 }).catch(() => {}); await page.waitForTimeout(40_000);
  const r = await page.evaluate(() => (window as unknown as { __tk?: { lcp: number; sw: [number, number][] } }).__tk ?? null).catch(() => null);
  await ctx.close().catch(() => {}); return r;
}
for (const path of ['/about', '/', '/liq', '/news']) {
  test(`D6 slow 3G (matrix profile) at 390 on ${path}: LCP and sideways width`, async ({ browser }) => {
    test.setTimeout(150_000);
    const r = await slow(browser, path, true); const sw = r?.sw ?? []; const maxSW = sw.length ? Math.max(...sw.map((x) => x[1])) : null;
    T('D6', `${path}: LCP ${r?.lcp} ms · scrollWidth max ${maxSW} over ${sw.length} samples (requested 390), samples over 390: ${sw.filter((x) => x[1] > 390).length}`);
    expect.soft(r?.lcp ?? 0, 'no LCP').toBeGreaterThan(0);
    expect.soft(r?.lcp ?? 1e9, `${path}: main content at or above 11.4 s`).toBeLessThan(11_400);
    expect.soft(maxSW ?? 9999, `${path}: sideways scroll`).toBeLessThanOrEqual(390);
  });
}
test('D6 control: /about with no throttle', async ({ browser }) => {
  test.setTimeout(100_000);
  const r = await slow(browser, '/about', false); T('D6', `/about unthrottled: LCP ${r?.lcp} ms`); expect.soft(r?.lcp ?? 0).toBeGreaterThan(0);
});

/* ---------- D7: the named small-text items (192, 257): presence first, then contrast ---------- */
for (const [path, theme, fixture] of [['/liq', 'dark', false], ['/liq', 'light', false], ['/briefing', 'dark', true], ['/briefing', 'light', true], ['/funding', 'dark', false], ['/news', 'dark', false], ['/news', 'light', false]] as [string, Theme, boolean][]) {
  test(`D7 named elements ${path} ${theme}: present, and their contrast`, async ({ browser }) => {
    test.setTimeout(120_000);
    const ctx = await signedOutContext(browser, { width: 1280, theme }); const page = await openPage(ctx); if (fixture) await installNewsFixture(page);
    try {
      await gotoGuarded(page, path); await page.waitForTimeout(path === '/liq' ? 22_000 : 14_000);
      const named = path === '/liq' ? [{ label: 'whale price', sel: '.wf-row-price' }, { label: 'whale time', sel: '.wf-row-time' }, { label: 'Estimated', sel: '.liq-section-est' }, { label: 'gex meta', sel: '.gex-meta span' }]
        : path === '/briefing' ? [{ label: 'event tag', sel: '.mb-event-tag' }] : path === '/funding' ? [{ label: 'venue badge', sel: '[data-testid="funding-venue-bybit"], [data-testid^="funding-venue"]' }, { label: 'frh price', sel: '.frh-price, .frh-px' }] : [{ label: 'empty caption', sel: '[class*=empty] p, [class*=empty] span, .news-empty, .ncard-empty' }];
      const r = await page.evaluate(contrastProbe, { maxPx: 14, named });
      const parts = Object.entries(r.named).map(([k, v]) => `${k}: n=${v.count} min=${v.min}`);
      const noData = await page.evaluate(() => Array.from(document.querySelectorAll('*')).filter((e) => e.children.length === 0 && /^no data$/i.test(((e as HTMLElement).innerText || '').trim())).length);
      T('D7', `${path} ${theme} (data-theme=${r.theme}): ${parts.join(' · ')} · "No data" leaf elements ${noData} · sweep under 14px: ${r.scanned} measured, ${r.skipped} skipped, ${r.failTotal} under 4.5:1 · worst ${JSON.stringify(r.worst.slice(0, 4).map((w) => `${w.sel} "${w.text}" ${w.ratio}`))}`);
      const fails = Object.entries(r.named).flatMap(([k, v]) => v.failing.map((x) => `${k}: ${x.sel} "${x.text}" ${x.ratio}`));
      expect.soft(fails, 'named elements under 4.5:1').toEqual([]);
    } finally { await ctx.close().catch(() => {}); }
  });
}

/* ---------- D8: every accessible name on a Russian page (222) ---------- */
test('D8 ru /dashboard with the Ask AI panel open: Latin-only aria-labels and titles', async ({ browser }) => {
  test.setTimeout(120_000);
  const ctx = await signedOutContext(browser, { width: 1280, lang: 'ru' }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/dashboard'); await page.waitForFunction(() => /[Ѐ-ӿ]/.test(document.body.innerText), undefined, { timeout: 40_000 }).catch(() => {}); await page.waitForTimeout(8_000);
    await page.locator('[data-testid="grok-launcher"]').first().click({ timeout: 8_000 }).catch(() => {}); await page.waitForTimeout(1_500);
    const names = await page.evaluate(() => { const NON = /[Ѐ-ӿ]/; const out: string[] = []; for (const e of Array.from(document.querySelectorAll('[aria-label], [title]'))) for (const a of ['aria-label', 'title']) { const v = (e.getAttribute(a) || '').trim(); if (v && /[A-Za-z]{3,}/.test(v) && !NON.test(v)) out.push(`${a}:${v.slice(0, 50)} <${e.tagName.toLowerCase()}.${String((e as HTMLElement).className).split(' ')[0]}>`); } return [...new Set(out)]; });
    const all = await page.evaluate(() => document.querySelectorAll('[aria-label]').length);
    T('D8', `ru dashboard: ${all} aria-label attributes, Latin-only names (aria-label/title): ${JSON.stringify(names)}`);
    const clos = names.filter((n) => /close|menu|pause|hide|language|open|expand|collapse|ask ai|ticker/i.test(n));
    expect.soft(clos, 'English accessible names for menus / ticker / chat close on the ru page').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});

/* ---------- D9: the glossary entries named in the box (172) ---------- */
test('D9 /learn: the RSI, VWAP and Contrarian entries as served', async ({ browser }) => {
  test.setTimeout(90_000);
  const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
  try {
    await gotoGuarded(page, '/learn'); await page.waitForTimeout(5_000);
    const ents = await page.evaluate(() => Array.from(document.querySelectorAll('p, dd, li, div')).filter((e) => e.children.length < 4 && /overbought|oversold|VWAP|contrarian/i.test((e as HTMLElement).innerText || '') && ((e as HTMLElement).innerText || '').length > 50 && ((e as HTMLElement).innerText || '').length < 500).map((e) => ((e as HTMLElement).innerText || '').replace(/\s+/g, ' ')).slice(0, 12));
    const body = await text(page);
    T('D9', `entries: ${JSON.stringify(ents)}`);
    T('D9', `phrase counts: "more likely" ${(body.match(/more likely/gi) ?? []).length} · "mild bullish tell" ${(body.match(/mild bullish tell/gi) ?? []).length} · "oversold" ${(body.match(/oversold/gi) ?? []).length} (control: the RSI text is on the page)`);
    expect.soft((body.match(/oversold/gi) ?? []).length, 'CONTROL: no RSI text').toBeGreaterThan(0);
    expect.soft((body.match(/more likely|mild bullish tell/gi) ?? []), 'outcome wording').toEqual([]);
  } finally { await ctx.close().catch(() => {}); }
});
