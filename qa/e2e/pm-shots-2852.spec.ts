/* QA: PM's visual checks on staging, second pass (#62, #71 tour, #72, and the #70 text), 390 and 1280, dark and light. The first pass (run 45819770321) holds #43, #70 and the #71 pill.
 * Account states are MADE AT THE NETWORK for a dev-project fixture: the onboarding row is answered by the test and EVERY table write from the page is answered by the test too, so nothing is changed.
 * The service worker is blocked so the stubs hold. The liquidation events are TEST DATA placed around the live price (the shared dev database holds none from the last 24 h). Dispatch-only; prints [PM] lines. */
import { test, expect, type Browser, type Page } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';
import { createClient } from '@supabase/supabase-js';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 600_000, retries: 0 });
const SIZES = [[390, 844], [1280, 900]] as const;
const THEMES = ['dark', 'light'] as const;
const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': 'GET,POST,PATCH,DELETE' };

/* THE FIXTURE MUST END AS IT STARTED. Read under the fixture's own sign-in, before and after; any difference fails the run. */
async function fixtureRows() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? ''; expect(new URL(url).hostname.split('.')[0], 'dev project only').toBe('wdtjhrilakoitfcezxpx');
  const sb = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? '', { auth: { persistSession: false } });
  const { data, error } = await sb.auth.signInWithPassword({ email: process.env.E2E_USER_A_EMAIL ?? '', password: process.env.E2E_USER_A_PASSWORD ?? '' }); expect(error?.message ?? null).toBeNull();
  const one = async (t: string) => { const r = await sb.from(t).select('*').eq('user_id', data.user!.id).maybeSingle(); expect(r.error?.message ?? null, t).toBeNull(); return r.data; };
  return { settings: await one('lhq_dev_user_settings'), onboarding: await one('lhq_dev_user_onboarding') };
}
let before: Awaited<ReturnType<typeof fixtureRows>> | null = null;
test.beforeAll(async () => { if (AUTH_READY) before = await fixtureRows(); });
test.afterAll(async () => { if (!before) return; const after = await fixtureRows(); expect(after.settings, 'THE RUN CHANGED THE FIXTURE SETTINGS ROW').toEqual(before.settings); expect(after.onboarding, 'THE RUN CHANGED THE FIXTURE ONBOARDING ROW').toEqual(before.onboarding); console.log('[PM] fixture rows unchanged'); });

const snap = async (page: Page, name: string) => page.screenshot({ path: `qa/.shots/${name}.png`, mask: [page.locator('.tnav-drop-email'), page.locator('text=/\\S+@\\S+\\.\\w+/')], maskColor: '#000000' });
async function open(browser: Browser, width: number, height: number, theme: 'dark' | 'light', row: Record<string, unknown> | null) {
  const ctx = await signedInContext(browser, 'a', { viewport: { width, height }, theme });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('blocked by the test')); } catch { /* private */ } });
  const stubbed: string[] = [];
  if (row) {
    await ctx.route(/\/rest\/v1\/(?!rpc\/)/, async (route) => {
      const req = route.request(); const table = /\/rest\/v1\/([a-z_]+)/.exec(req.url())?.[1] ?? '?';
      if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
      if (req.method() !== 'GET' && req.method() !== 'HEAD') { stubbed.push(`${req.method()} ${table}`); return route.fulfill({ status: 201, headers: CORS, contentType: 'application/json', body: '[]' }); }
      if (!/user_onboarding$/.test(table)) return route.continue();
      const one = /vnd\.pgrst\.object/.test(req.headers().accept ?? '');
      return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify(one ? row : [row]) });
    });
    /* THE APP ALSO SAVES THROUGH ITS OWN ROUTES (/api/settings): without this the wizard really saved its answers to the fixture (run 45827918086). */
    await ctx.route(/\/api\//, async (route) => { const req = route.request(); if (req.method() === 'GET' || req.method() === 'HEAD') return route.fallback(); stubbed.push(`${req.method()} ${new URL(req.url()).pathname}`); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: [], rejected: [], settings: null }) }); });
  }
  const page = await ctx.newPage(); await installPaidAiFence(page);
  return { ctx, page, stubbed };
}
const ROW = { tour_seen: false, profile_complete: false, checklist_telegram: false, checklist_price_alert: false, checklist_grok: false, checklist_coins: false };

test('#72 what is under the country control', async ({ browser }) => {
  test.skip(!AUTH_READY, 'no fixtures');
  for (const theme of THEMES) {
    const { ctx, page } = await open(browser, 390, 844, theme, ROW);
    try {
      await page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 150_000 });
      await page.locator('[class*="obw-"]').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(3_000);
      for (let k = 0; k < 30; k++) { await page.keyboard.press('Tab'); if (await page.evaluate(() => !!document.activeElement?.closest('.obw-select'))) break; }
      const boxes: string[] = [];
      for (const [name, loc] of [['.tnav-drop-email', page.locator('.tnav-drop-email')], ['email-text', page.locator('text=/\S+@\S+\.\w+/')]] as const)
        for (const el of await loc.all()) boxes.push(name + ' ' + JSON.stringify(await el.evaluate((e) => { const r = e.getBoundingClientRect(); const c = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 60), inWizard: !!e.closest('[class*="obw"]'), box: [r.x, r.y, r.width, r.height].map(Math.round), visibility: c.visibility, display: c.display, text: (e.textContent ?? '').replace(/S+@S+.w+/g, '<address>').slice(0, 60) }; })));
      const under = await page.evaluate(() => { const sel = document.querySelector('.obw-select')!.getBoundingClientRect(); const lab = document.querySelector('#obw-acct-label')!.getBoundingClientRect(); const top = (x: number, y: number) => { const e = document.elementFromPoint(x, y) as HTMLElement | null; return e ? e.tagName.toLowerCase() + '.' + String(e.className).slice(0, 40) + (e.id ? '#' + e.id : '') : null; };
        return { select: [sel.x, sel.y, sel.width, sel.height].map(Math.round), label: [lab.x, lab.y, lab.width, lab.height].map(Math.round), topAtLabel: top(lab.x + 10, lab.y + lab.height / 2), menuOpen: !!document.querySelector('.obw-menu'), selects: document.querySelectorAll('select').length }; });
      console.log('[PM] 72 ' + theme + ': dom=' + JSON.stringify(under));
      console.log('[PM] 72 ' + theme + ': masked by my screenshot=' + JSON.stringify(boxes));
      /* the same pixels the first run saved: with and without its mask, counted in the page */
      const plain = await page.screenshot(); const masked = await page.screenshot({ mask: [page.locator('.tnav-drop-email'), page.locator('text=/\S+@\S+\.\w+/')], maskColor: '#000000' });
      const dark = async (buf: Buffer) => page.evaluate(async ([b64, y0, y1]) => { const img = new Image(); img.src = 'data:image/png;base64,' + b64; await img.decode(); const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const g = c.getContext('2d')!; g.drawImage(img, 0, 0); const k = img.width / 390; const d = g.getImageData(16 * k, (y0 as number) * k, 358 * k, ((y1 as number) - (y0 as number)) * k).data; let black = 0; for (let i = 0; i < d.length; i += 4) if (d[i] < 8 && d[i + 1] < 8 && d[i + 2] < 8) black++; return Math.round((black / (d.length / 4)) * 1000) / 10; }, [buf.toString('base64'), under.select[1] + under.select[3] + 2, under.label[1] + under.label[3] + 4] as const).catch((e) => 'unread: ' + String(e.message).slice(0, 80));
      const covering = await page.evaluate(([x, y, w, h]) => Array.from(document.querySelectorAll('body *')).filter((e) => { const r = e.getBoundingClientRect(); const cs = getComputedStyle(e); return r.width > 40 && r.height > 8 && r.left < x + w && r.right > x && r.top < y + h && r.bottom > y && cs.pointerEvents === 'none' && cs.visibility !== 'hidden' && cs.opacity !== '0'; }).map((e) => e.tagName.toLowerCase() + '.' + String(e.getAttribute('class') ?? '').slice(0, 30) + ' bg=' + getComputedStyle(e).backgroundColor).slice(0, 6), under.label);
      console.log('[PM] 72 ' + theme + ': near-black pixels between control and label %: plain=' + (await dark(plain)) + ' withMask=' + (await dark(masked)) + ' pointerless=' + JSON.stringify(covering));
      await page.screenshot({ path: 'qa/.shots/pm72-wizard-unmasked-region-' + theme + '.png', clip: { x: 0, y: Math.max(0, under.select[1] - 40), width: 390, height: 160 }, mask: [page.locator('.tnav-drop-email:visible')], maskColor: '#ff00ff' });
    } finally { await ctx.close().catch(() => {}); }
  }
});
