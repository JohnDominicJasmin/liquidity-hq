/* AUDIT CELLS, part 2 of the owner's "audit EVERY page in EVERY scenario" (part 1 = audit-matrix.spec.ts). The same [MATRIX] measurements, over the other axes. Informational: it never fails on a finding, only when a page cannot load.
 *   R:<persona>:<theme>:<width>:<route>     the routes the matrix does not cover (legal, auth, locale roots, offline, 404, backtest, live-tracking) plus /ops, /ops/status and /admin, which a signed-out or Free account must NOT be shown (the record carries the first 160 characters shown and a DENIED / SHOWN verdict)
 *   L:<persona>:<lang>:<theme>:<width>:<path>  the 12 main pages in en / ko / zh / ru (baseline + three offered translations) and ONE stored-preference "ar" fallback set (Arabic is not offered; it must fall back cleanly with no RTL breakage): html lang / dir, English sentences left in the visible text, plus every matrix measurement
 *   W:<persona>:<theme>:<width>:<path>      the 12 main pages at 320 / 360 / 390 / 640 (= 200% zoom of 1280) / 768 / 1024 / 1280 / 1440 / 1920
 *   P:<plan>:<theme>:<width>:<path>         Trial (the plan read stubbed as an active trial on fixture B) and "plan still checking" (the plan read held 5 s) on the 12 main pages
 *   D:<persona>:<theme>:<width>:<path>      UPSTREAM DOWN: every exchange host unreachable, sockets closed, our own market-data routes answering 503: every panel must say "unavailable" honestly, never blank, NaN, a stuck skeleton or a stale number
 * Each prints one [MATRIX] JSON line (plus lang fields) and saves a settled full-page screenshot at 390 and 1280 (qa/.shots/audit-<title>.png). Shard with --grep=R: / L:out:ko: / W:out:light: / P:trial: / D:out: .
 * Paid-AI fence on, writes stubbed, nothing is clicked. On production only the signed-out persona runs. */
import { test, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY } from './_auth';
import { settleForShot } from './_settle';
import { MAIN12, PROD, open, arm, watch, untilSettled, measure, langCheck, slug, type Persona } from './_matrix';

mkdirSync('qa/.shots', { recursive: true });
const THEMES = ['light', 'dark'] as const;
const ROUTES = ['/ru', '/ko', '/zh', '/privacy', '/terms', '/refund', '/security', '/disclaimer', '/accessibility', '/contact', '/forgot-password', '/reset-password', '/offline', '/backtest', '/live-tracking', '/this-page-does-not-exist-qa'] as const;
const DENY = ['/ops', '/ops/status', '/admin'] as const;

async function cell(title: string, persona: Persona, theme: string, width: number, path: string, o: { net?: string; lang?: string; down?: boolean; browser: import('@playwright/test').Browser; extra?: (page: Page) => Promise<Record<string, unknown>> }) {
  const ctx = await open(o.browser, persona, theme, width, o.lang ?? 'en'); const page = await ctx.newPage(); const log = watch(page);
  await arm(page, o.net ?? 'normal', { persona, down: o.down });
  if (o.lang && persona !== 'out') await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async (route) => { if (route.request().method() !== 'GET') return route.fulfill({ status: 204, body: '' }); const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res }); const patch = (r: Record<string, unknown>) => ({ ...r, language: o.lang }); return route.fulfill({ response: res, body: JSON.stringify(Array.isArray(body) ? body.map(patch) : patch(body)) }); });
  try {
    const t0 = Date.now(); let ready = -1;
    try { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); ready = Date.now() - t0; } catch (e) { console.log(`[MATRIX] ${JSON.stringify({ title, error: `LOAD-FAILED ${String(e).slice(0, 120)}` })}`); throw e; }
    const landed = new URL(page.url()).pathname; const settled = await untilSettled(page, 30_000); await page.waitForTimeout(1_500);
    let m = await measure(page, width <= 480);
    if (o.lang && o.lang !== 'en') { await page.reload({ waitUntil: 'domcontentloaded' }).catch(() => {}); await page.waitForTimeout(4_000); m = await measure(page, width <= 480); }
    const lc = o.lang ? await langCheck(page, o.lang) : null; const extra = o.extra ? await o.extra(page) : {};
    const rec = { title, landed: landed === path ? undefined : landed, ready, settledMs: settled.stuck.length ? null : settled.ms, STUCK: settled.stuck.length ? settled.stuck : undefined, lcp: m.lcp, docW: m.docW, vw: m.vw, sideways: m.docW > m.vw ? m.docW - m.vw : 0, past: m.past || undefined, pastList: m.past ? m.pastList : undefined, clipped: m.clipped || undefined, clippedList: m.clipped ? m.clippedList : undefined, tapUnder24: m.small || undefined, tapList: m.small ? m.smallList : undefined, errs: log.errs.length ? Array.from(new Set(log.errs)).slice(0, 3) : undefined, http: log.bad.length ? Array.from(new Set(log.bad)).slice(0, 5) : undefined, failed: log.failed.length ? Array.from(new Set(log.failed)).slice(0, 3) : undefined, raw: m.raw.length ? m.raw : undefined, badText: m.bad.length ? m.bad : undefined, unavailable: m.un.length ? m.un : undefined, lowContrast: m.lowN || undefined, lowList: m.lowN ? m.low : undefined, lang: lc ?? undefined, ...extra, shot: undefined as string | undefined };
    if ((width === 390 || width === 1280) && (o.net ?? 'normal') === 'normal') {
      const name = `audit-${title.replace(/[:/]/g, '_')}.png`; await settleForShot(page, name).catch(() => {});
      await page.screenshot({ path: `qa/.shots/${name}`, fullPage: true, mask: [page.locator('text=/@/')], maskColor: '#000000', timeout: 20_000 }).then(() => { rec.shot = name; }).catch(() => {});
    }
    console.log(`[MATRIX] ${JSON.stringify(rec)}`);
  } finally { await ctx.close(); }
}

for (const theme of THEMES) for (const width of [390, 1280]) for (const route of ROUTES) {
  const title = `R:out:${theme}:${width}:${route}`;
  test(title, async ({ browser }) => { test.setTimeout(150_000); await cell(title, 'out', theme, width, route, { browser }); });
}
for (const persona of ['out', 'free'] as const) for (const route of DENY) for (const width of [390, 1280]) {
  const title = `R:${persona}:light:${width}:${route}`;
  test(title, async ({ browser }) => {
    test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run (signed out only)'); test.setTimeout(150_000);
    await cell(title, persona, 'light', width, route, { browser, extra: async (page) => { const txt = (await page.evaluate(() => document.body.innerText).catch(() => '')).replace(/\s+/g, ' ').trim(); const here = new URL(page.url()).pathname; const shown = here.startsWith(route) && txt.length > 400 && !/(not found|forbidden|sign in|log in|denied|not authori)/i.test(txt); return { verdict: shown ? 'SHOWN? (the page rendered content for a non-admin)' : 'DENIED', url: here, first160: txt.slice(0, 160) }; } });
  });
}

const LANGS = ['en', 'ko', 'zh', 'ru'] as const;
for (const lang of LANGS) for (const theme of THEMES) for (const width of [390, 1280]) for (const path of MAIN12) {
  const title = `L:out:${lang}:${theme}:${width}:${path}`;
  test(title, async ({ browser }) => { test.setTimeout(150_000); await cell(title, 'out', theme, width, path, { browser, lang }); });
}
for (const lang of LANGS) for (const width of [390, 1280]) for (const path of ['/dashboard', '/arena', '/settings', '/upgrade']) {
  const title = `L:pro:${lang}:light:${width}:${path}`;
  test(title, async ({ browser }) => { test.skip(!AUTH_READY || PROD, 'fixture accounts are not configured, or this is a production run'); test.setTimeout(150_000); await cell(title, 'pro', 'light', width, path, { browser, lang }); });
}
for (const theme of THEMES) for (const path of ['/', '/dashboard', '/arena', '/news']) {
  const title = `L:out:ar:${theme}:390:${path}`;   /* a STORED PREFERENCE of Arabic: must fall back to a clean LTR English page */
  test(title, async ({ browser }) => { test.setTimeout(150_000); await cell(title, 'out', theme, 390, path, { browser, lang: 'ar' }); });
}

const WIDTHS = [320, 360, 390, 640, 768, 1024, 1280, 1440, 1920] as const;
for (const theme of THEMES) for (const width of WIDTHS) for (const path of MAIN12) {
  const title = `W:out:${theme}:${width}:${path}`;
  test(title, async ({ browser }) => { test.setTimeout(150_000); await cell(title, 'out', theme, width, path, { browser }); });
}
for (const width of WIDTHS) for (const path of ['/dashboard', '/arena', '/settings']) {
  const title = `W:pro:light:${width}:${path}`;
  test(title, async ({ browser }) => { test.skip(!AUTH_READY || PROD, 'fixture accounts are not configured, or this is a production run'); test.setTimeout(150_000); await cell(title, 'pro', 'light', width, path, { browser }); });
}

for (const plan of ['trial', 'checking'] as const) for (const theme of THEMES) for (const width of [390, 1280]) for (const path of MAIN12) {
  const title = `P:${plan}:${theme}:${width}:${path}`;
  test(title, async ({ browser }) => { test.skip(!AUTH_READY || PROD, 'fixture accounts are not configured, or this is a production run'); test.setTimeout(150_000); await cell(title, plan, theme, width, path, { browser }); });
}

for (const persona of ['out', 'pro'] as const) for (const theme of THEMES) for (const width of [390, 1280]) for (const path of MAIN12) {
  const title = `D:${persona}:${theme}:${width}:${path}`;
  test(title, async ({ browser }) => { test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run'); test.setTimeout(150_000); await cell(title, persona, theme, width, path, { browser, down: true, extra: async (page) => { const t = (await page.evaluate(() => document.body.innerText).catch(() => '')); return { honest: /(unavailable|couldn.?t load|could not load|try again|no data|offline|retry)/i.test(t), blankish: t.replace(/\s+/g, ' ').length < 200 }; } }); });
}
void slug;
