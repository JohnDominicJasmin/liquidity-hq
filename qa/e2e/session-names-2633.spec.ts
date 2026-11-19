/* #2633 / #1113: NO PLACE SHOWS THE OLD WINDOW NAMES ("God Tier", "Prime", "Dead Zone"); the internal names stay (getCurrentWindow().name, what the journal stores). Run against a CI build of the PR head (the clock is faked in the browser, nothing is written).
 * The window is chosen by the browser clock (lib/session.ts, UTC): Sunday 16:00 = God Tier -> "Sunday window"; Tuesday 19:00 = Prime -> "US session"; Wednesday 05:00 = Dead Zone -> "Quiet hours".
 *   SN1 /hours at 390 and 1280 under each of the three clocks: the page text holds the plain name and none of the three old names; the "now" dot (span.hour) reads the plain name
 *   SN2 the nav status (phone header .tnav-m at 390, the desktop pill .tnav-session at 1280) reads the plain name, on /hours and on /arena
 *   SN3 the Journal: a trade stored with session "God Tier" / "Prime" / "Dead Zone" reads "Sunday window" / "US session" / "Quiet hours" in its row (Pro fixture, the trades read stubbed, signed-in so the real clock is kept and only Date's UTC day/hour getters are shifted)
 *   SN4 a Quick read request body carries "Sunday window" in its context and never "God Tier" (Pro fixture, /api/grok stubbed: nothing is billed)
 * Prints [SN] lines with what is on screen. */
import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

mkdirSync('qa/.shots', { recursive: true });
const CLOCKS = [
  { id: 'god', iso: '2026-11-22T16:00:00Z', plain: 'Sunday window', old: 'God Tier' },
  { id: 'prime', iso: '2026-11-24T19:00:00Z', plain: 'US session', old: 'Prime' },
  { id: 'dead', iso: '2026-11-25T05:00:00Z', plain: 'Quiet hours', old: 'Dead Zone' },
] as const;
const OLD = /God Tier|Dead Zone|\bPrime\b/;
const textOf = (page: Page) => page.evaluate(() => (document.body.innerText || '').replace(/\s+/g, ' '));
const lang = (ctxPage: Page) => ctxPage.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'en'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); localStorage.setItem('theme', 'dark'); } catch { /* private */ } });

for (const width of [390, 1280]) for (const c of CLOCKS) {
  test(`SN1+SN2 signed out, ${width}, clock ${c.id}: /hours and /arena say "${c.plain}" and never "${c.old}"`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await browser.newContext({ viewport: { width, height: 900 } }); const page = await ctx.newPage(); await lang(page); await page.clock.install({ time: new Date(c.iso) });
    try {
      for (const path of ['/hours', '/arena?coin=btc']) {
        await page.goto(path, { waitUntil: 'domcontentloaded' }); await page.waitForTimeout(3_000); await page.clock.resume(); await page.waitForTimeout(9_000);
        const text = await textOf(page); const old = OLD.exec(text);
        const nav = await page.evaluate(() => { const m = document.querySelector('.tnav-mstatus') as HTMLElement | null, s = document.querySelector('.tnav-session') as HTMLElement | null, h = document.querySelector('.hours-now-win, span.hour') as HTMLElement | null; return { m: m?.innerText?.trim() ?? null, s: s?.innerText?.replace(/\s+/g, ' ').trim() ?? null, hour: h?.innerText?.replace(/\s+/g, ' ').trim() ?? null }; });
        console.log(`[SN] ${path} ${width} ${c.id}: plain "${c.plain}" on page ${text.includes(c.plain)} · old names ${old ? old[0] : 'none'} · .tnav-mstatus "${nav.m}" · .tnav-session "${nav.s}" · now-dot "${nav.hour}"`);
        await page.screenshot({ path: `qa/.shots/sn-${path.replace(/[^a-z]/g, '')}-${width}-${c.id}.png` }).catch(() => {});
        expect(old, `${path} at ${width} (${c.id}) still shows an old window name: ${old?.[0]}`).toBeNull();
        if (width < 600) expect(nav.m ?? '', `${path} at ${width} (${c.id}): the phone header status (.tnav-mstatus) is not "${c.plain}"`).toContain(c.plain); else expect(nav.s ?? '', `${path} at ${width} (${c.id}): the desktop nav pill (.tnav-session) is not "${c.plain}"`).toContain(c.plain);
        if (path === '/hours') expect(text.includes(c.plain), `/hours at ${width} (${c.id}) does not say "${c.plain}"`).toBe(true);
      }
    } finally { await ctx.close().catch(() => {}); }
  });
}

test.describe('signed in', () => {
  test.skip(!AUTH_READY, 'no fixtures');
  const shiftUtc = (day: number, hour: number) => ({ day, hour });
  test('SN3 the Journal: a trade stored with the old name reads the plain one', async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await lang(page); await installPaidAiFence(page);
    const mk = (i: number, session: string) => ({ id: `qa-${i}`, created_at: new Date(Date.now() - i * 3_600_000).toISOString(), coin: 'BTC', direction: 'LONG', setup_type: 'Breakout', entry_price: 60000 + i, stop_loss: 59000, take_profit: 62000, result: 'OPEN', notes: `qa row ${i}`, session });
    const rows = [mk(1, 'God Tier'), mk(2, 'Prime'), mk(3, 'Dead Zone'), mk(4, 'London Open')];
    await page.route(/\/rest\/v1\/lhq_(dev_)?trades\?/, async (route) => (route.request().method() === 'GET' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(rows) }) : route.fulfill({ status: 204, body: '' })));
    try {
      await gotoSignedIn(page, '/journal'); await page.waitForTimeout(8_000); await page.getByTestId('journal-tab').nth(1).click(); await page.waitForTimeout(3_000);   // the second tab is History: the trade rows
      const text = await textOf(page); const old = OLD.exec(text);
      console.log(`[SN] SN3 journal: Sunday window ${text.includes('Sunday window')} · US session ${text.includes('US session')} · Quiet hours ${text.includes('Quiet hours')} · London Open ${text.includes('London Open')} · old names ${old ? old[0] : 'none'}`); await page.screenshot({ path: 'qa/.shots/sn-journal.png' }).catch(() => {});
      expect(text.includes('qa row 1') || /Breakout/.test(text), 'the stubbed trades did not render: the journal read did not use the stub').toBe(true);
      expect(old, `the journal still shows an old name: ${old?.[0]}`).toBeNull();
      for (const n of ['Sunday window', 'US session', 'Quiet hours']) expect(text.includes(n), `the journal does not show "${n}"`).toBe(true);
      expect(text.includes('London Open'), 'a name outside the three must pass through unchanged').toBe(true);
    } finally { await ctx.close().catch(() => {}); }
  });
  test('SN4 a Quick read request carries "Sunday window" in its context and never "God Tier"', async ({ browser }) => {
    test.setTimeout(180_000);
    const ctx = await signedInContext(browser, 'a', { viewport: { width: 1280, height: 900 } }); const page = await ctx.newPage(); await lang(page); await installPaidAiFence(page);
    const { day, hour } = shiftUtc(0, 16);
    await page.addInitScript(([d, h]) => { const P = Date.prototype as unknown as Record<string, (...a: unknown[]) => number>; const gd = P.getUTCDay, gh = P.getUTCHours; P.getUTCDay = function (this: Date) { return Number.isFinite(this.getTime()) ? (d as number) : gd.call(this); }; P.getUTCHours = function (this: Date) { return Number.isFinite(this.getTime()) ? (h as number) : gh.call(this); }; }, [day, hour]);
    const bodies: string[] = []; await page.route('**/api/grok', async (route) => { if (route.request().method() === 'POST') { bodies.push(route.request().postData() ?? ''); return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'qa stub' }) }); } return route.fallback(); });
    try {
      await gotoSignedIn(page, '/arena?coin=btc&tf=1h'); await expect(page.locator('.plan-badge-pro').first(), 'the Pro plan never resolved').toBeVisible({ timeout: 60_000 }); await page.waitForTimeout(6_000);
      await page.locator('button.arena-quick-btn').first().click(); await expect.poll(() => bodies.length, { timeout: 60_000, message: 'the Quick click never reached /api/grok' }).toBeGreaterThan(0);
      const b = bodies[0]; const m = /"session"\s*:\s*"([^"]*)"/.exec(b); console.log(`[SN] SN4 request context.session = ${m ? JSON.stringify(m[1]) : '(not found)'} · "God Tier" in body: ${b.includes('God Tier')} · "Sunday window" in body: ${b.includes('Sunday window')}`);
      expect(b.includes('God Tier'), 'the read request still carries "God Tier"').toBe(false); expect(m?.[1], 'the request context.session is not the plain name').toBe('Sunday window');
    } finally { await ctx.close().catch(() => {}); }
  });
});
