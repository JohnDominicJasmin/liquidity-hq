/* AUDIT MATRIX (owner, 2026-11-17: "audit EVERY page in EVERY scenario"). One cell = page x persona x theme x width x network. NOT a gate: it never fails on a finding; it prints ONE [MATRIX] JSON line per cell and
 * saves a SETTLED full-page screenshot, and fails only when the harness could not load the page at all.
 *   page      the 26 pages of the explore pass
 *   persona   out (signed out) | free (fixture B) | pro (fixture A); on production (E2E_ALLOW_PRODUCTION=1) only `out` runs
 *   theme     light | dark          width  390 | 768 | 1280          net  normal | slow (CDP: 400 kbps down, 200 kbps up, 400 ms RTT; slow runs 390 and 1280 only)
 * Per cell: LCP; ms until no skeleton / "Loading…" text is left (cap 30 s, STUCK when it is not); docW vs viewport and the non-fixed elements past the edge; text clipped by its own box; tap targets under 24 px (phone widths);
 * console errors; failed / 4xx / 5xx requests; raw label keys; NaN / undefined / null / Infinity; any "unavailable / couldn't load / —" line; low-contrast text (computed contrast under 4.5:1 for text under 18 px, solid backgrounds only).
 * OFFLINE cells (title M:offline:...): load, go offline mid-session for 8 s, record what the page says and whether it recovers when the network returns.
 * Every title starts "M:persona:theme:width:net:path" with no spaces, so a shard is a --grep: gh workflow run ci.yml --ref <ref> -f e2e=true -f base_url=<url> -f project=desktop -f screenshots=true -f "spec=--grep=M:out:dark:"
 * Paid-AI fence on, writes stubbed, nothing is clicked. Screenshots: qa/.shots/matrix-<persona>-<theme>-<width>-<net>-<page>.png (normal network only), any email on the page masked. */
import { test } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY } from './_auth';
import { settleForShot } from './_settle';
import { PAGES, PROD, open, arm, watch, untilSettled, measure } from './_matrix';

const _unused = ['/', '/dashboard', '/arena', '/markets', '/liq', '/scanner', '/funding', '/correlation', '/news', '/research', '/briefing', '/hours', '/econ-calendar', '/calc', '/journal', '/alerts', '/settings', '/playbook', '/upgrade', '/learn', '/faq', '/help', '/about', '/changelog', '/status', '/login'] as const;
void _unused;
const PERSONAS = ['out', 'free', 'pro'] as const;
const THEMES = ['light', 'dark'] as const;
const WIDTHS = [390, 768, 1280] as const;
const NETS = ['normal', 'slow'] as const;
const OFFLINE_PAGES = ['/dashboard', '/arena', '/markets', '/news', '/funding'] as const;

mkdirSync('qa/.shots', { recursive: true });

for (const persona of PERSONAS) for (const theme of THEMES) for (const width of WIDTHS) for (const net of NETS) for (const path of PAGES) {
  if (net === 'slow' && width === 768) continue;
  test(`M:${persona}:${theme}:${width}:${net}:${path}`, async ({ browser }) => {
    test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run (signed out only)');
    test.setTimeout(net === 'slow' ? 240_000 : 150_000);
    const ctx = await open(browser, persona, theme, width); const page = await ctx.newPage(); const log = watch(page); await arm(page, net);
    try {
      const t0 = Date.now(); let ready = -1;
      try { await page.goto(path, { waitUntil: 'domcontentloaded', timeout: net === 'slow' ? 120_000 : 60_000 }); ready = Date.now() - t0; } catch (e) { console.log(`[MATRIX] ${JSON.stringify({ persona, theme, width, net, path, error: `LOAD-FAILED ${String(e).slice(0, 120)}` })}`); throw e; }
      const landed = new URL(page.url()).pathname;
      const settled = await untilSettled(page, 30_000);
      await page.waitForTimeout(net === 'slow' ? 2_500 : 1_500);
      const m = await measure(page, width <= 480);
      const rec = { persona, theme, width, net, path, landed: landed === path ? undefined : landed, ready, settledMs: settled.stuck.length ? null : settled.ms, STUCK: settled.stuck.length ? settled.stuck : undefined, lcp: m.lcp, docW: m.docW, vw: m.vw, sideways: m.docW > m.vw ? m.docW - m.vw : 0, past: m.past || undefined, pastList: m.past ? m.pastList : undefined, clipped: m.clipped || undefined, clippedList: m.clipped ? m.clippedList : undefined, tapUnder24: m.small || undefined, tapList: m.small ? m.smallList : undefined, runnerGeoWS: log.geo.length || undefined, errs: log.errs.length ? Array.from(new Set(log.errs)).slice(0, 3) : undefined, http: log.bad.length ? Array.from(new Set(log.bad)).slice(0, 5) : undefined, failed: log.failed.length ? Array.from(new Set(log.failed)).slice(0, 3) : undefined, raw: m.raw.length ? m.raw : undefined, badText: m.bad.length ? m.bad : undefined, unavailable: m.un.length ? m.un : undefined, lowContrast: m.lowN || undefined, lowList: m.lowN ? m.low : undefined, shot: undefined as string | undefined };
      if (net === 'normal' && (width === 390 || width === 1280)) {
        const name = `matrix-${persona}-${theme}-${width}-${net}-${path === '/' ? 'home' : path.replace(/\//g, '_').replace(/^_/, '')}.png`;
        await settleForShot(page, name).catch(() => {});
        await page.screenshot({ path: `qa/.shots/${name}`, fullPage: true, mask: [page.locator('text=/@/')], maskColor: '#000000', timeout: 20_000 }).then(() => { rec.shot = name; }).catch(() => {});
      }
      console.log(`[MATRIX] ${JSON.stringify(rec)}`);
    } finally { await ctx.close(); }
  });
}

/* OFFLINE MID-SESSION: the page is loaded and settled, the network goes away for 8 s, then returns. Recorded: what the page SAYS while offline (any "offline / connection / couldn't load" text), whether it went blank, the errors, and whether it settled again within 25 s of the network coming back. */
for (const persona of ['out', 'free'] as const) for (const path of OFFLINE_PAGES) {
  test(`M:offline:${persona}:light:390:normal:${path}`, async ({ browser }) => {
    test.skip(persona !== 'out' && (!AUTH_READY || PROD), 'fixture accounts are not configured, or this is a production run (signed out only)');
    test.setTimeout(180_000);
    const ctx = await open(browser, persona, 'light', 390); const page = await ctx.newPage(); const log = watch(page); await arm(page, 'normal');
    try {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 }); await untilSettled(page, 30_000); await page.waitForTimeout(2_000);
      const lenBefore = (await page.evaluate(() => document.body.innerText.length));
      const errs0 = log.errs.length; await ctx.setOffline(true); await page.waitForTimeout(8_000);
      const off = await page.evaluate(() => { const t = document.body.innerText || ''; return { len: t.length, says: t.split('\n').filter((l) => /(offline|no connection|connection|couldn.?t load|could not load|unavailable|reconnect)/i.test(l) && l.length < 140).slice(0, 4), skeletons: Array.from(document.querySelectorAll('.skel-bar')).filter((e) => (e as HTMLElement).offsetParent !== null).length }; });
      await ctx.setOffline(false); const back = await untilSettled(page, 25_000);
      console.log(`[MATRIX] ${JSON.stringify({ kind: 'offline', persona, path, width: 390, textBefore: lenBefore, textWhileOffline: off.len, blankedWhileOffline: off.len < lenBefore * 0.3, saysWhileOffline: off.says, skeletonsWhileOffline: off.skeletons, errorsWhileOffline: Array.from(new Set(log.errs.slice(errs0))).slice(0, 3), recoveredMs: back.stuck.length ? null : back.ms, STUCK_AFTER_RECONNECT: back.stuck.length ? back.stuck : undefined })}`);
    } finally { await ctx.close(); }
  });
}
