/* QA #68: the Russian Arena on a laptop screen: nothing scrolls sideways or gets cut. Signed out and Pro (dev fixture), 1280, 1366 and 1440.
 * The signed-in account's language wins over local storage, so the settings READ is answered with language 'ru'. Every write is answered by the test and the service worker is blocked. Dispatch-only; prints [RU] lines. */
import { test, expect, type Browser, type BrowserContext } from '@playwright/test';
import { AUTH_READY, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test.describe.configure({ timeout: 600_000, retries: 0 });
const SIZES = [[1280, 800], [1366, 768], [1440, 900]] as const;

async function prepare(ctx: BrowserContext, theme: string, written: string[]) {
  await ctx.addInitScript((t) => { try { localStorage.setItem('lhq_lang_v1', 'ru'); localStorage.setItem('theme', t); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); if (navigator.serviceWorker) navigator.serviceWorker.register = () => Promise.reject(new Error('blocked by the test')); } catch { /* private */ } }, theme);
  await ctx.route(/\/(rest\/v1|api)\//, async (route) => {
    const req = route.request(); const path = new URL(req.url()).pathname;
    if (req.method() !== 'GET' && req.method() !== 'HEAD' && req.method() !== 'OPTIONS' && !/\/rpc\//.test(path)) { written.push(`${req.method()} ${path}`); return route.fulfill({ status: 200, headers: { 'access-control-allow-origin': '*' }, contentType: 'application/json', body: JSON.stringify(path === '/api/settings' ? { accepted: [], rejected: [], settings: null } : []) }); }
    if (req.method() === 'GET' && /user_settings$/.test(path)) { const r = await route.fetch(); const body = await r.json().catch(() => null); const ru = (x: Record<string, unknown>) => ({ ...x, language: 'ru' }); return route.fulfill({ response: r, json: Array.isArray(body) ? body.map(ru) : body ? ru(body) : body }); }
    return route.fallback();
  });
}

async function measure(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const W = document.documentElement.clientWidth; const name = (e: Element) => `${e.tagName.toLowerCase()}.${String(e.getAttribute('class') ?? '').split(' ').slice(0, 2).join('.')}`;
    const words = (e: Element) => ((e as HTMLElement).innerText ?? '').replace(/\s+/g, ' ').trim().slice(0, 50);
    const shown = (e: Element) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.opacity !== '0' && !e.closest('[aria-hidden="true"],[inert]'); };
    const inScroller = (e: Element) => { for (let p = e.parentElement; p; p = p.parentElement) { const o = getComputedStyle(p).overflowX; if ((o === 'auto' || o === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; } return false; };
    const all = Array.from(document.querySelectorAll('body *')).filter(shown);
    const pastEdge = all.filter((e) => { const r = e.getBoundingClientRect(); return (r.right > W + 1 || r.left < -1) && !inScroller(e) && !e.closest('.news-ticker,.ticker-content,.klc-canvas'); });
    /* cut text: a box that hides its overflow and holds more than it shows, sideways or downwards, with text of its own */
    const cut = all.filter((e) => { if (e.closest('.klc-canvas,.news-ticker,.ticker-content') || !Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim())) return false; const s = getComputedStyle(e); const h = e as HTMLElement; const x = h.scrollWidth > h.clientWidth + 1 && s.overflowX !== 'visible'; const y = h.scrollHeight > h.clientHeight + 2 && s.overflowY === 'hidden'; return x || y; });
    /* text that reaches outside the card that holds it */
    const spill = all.filter((e) => { const card = e.parentElement?.closest('.card,.tpanel,.arena-ws-rail'); if (!card || !Array.from(e.childNodes).some((n) => n.nodeType === 3 && n.textContent?.trim()) || inScroller(e)) return false; const r = e.getBoundingClientRect(), c = card.getBoundingClientRect(); return r.right > c.right + 1.5; });
    const rail = document.querySelector('.arena-ws-rail')?.getBoundingClientRect();
    const cyr = (document.querySelector('main') ?? document.body).textContent?.match(/[А-Яа-я]{3,}/g)?.length ?? 0;
    const list = (a: Element[]) => a.slice(0, 6).map((e) => `${name(e)} "${words(e)}"`);
    return { client: W, scroll: document.documentElement.scrollWidth, bodyScroll: document.body.scrollWidth, russianWords: cyr, rail: rail ? [Math.round(rail.left), Math.round(rail.right)] : null, pastEdge: list(pastEdge), cut: list(cut), spill: list(spill) };
  });
}

for (const who of ['signed out', 'Pro'] as const) {
  test(`#68 Arena in Russian, ${who}`, async ({ browser }: { browser: Browser }) => {
    test.skip(who === 'Pro' && !AUTH_READY, 'no fixtures');
    for (const [width, height] of SIZES) for (const theme of ['dark', 'light'] as const) {
      const ctx = who === 'Pro' ? await signedInContext(browser, 'a', { viewport: { width, height }, theme }) : await browser.newContext({ viewport: { width, height } });
      const written: string[] = []; await prepare(ctx, theme, written);
      const page = await ctx.newPage(); await installPaidAiFence(page);
      try {
        if (who === 'Pro') await gotoSignedIn(page, '/arena'); else await page.goto('/arena', { waitUntil: 'domcontentloaded', timeout: 150_000 });
        await page.locator('.klc-canvas').first().waitFor({ state: 'visible', timeout: 90_000 }); await page.waitForTimeout(18_000);
        const m = await measure(page);
        console.log(`[RU] ${who} ${width} ${theme}: ${JSON.stringify(m)}${written.length ? ` writesAnswered=${JSON.stringify([...new Set(written)].slice(0, 4))}` : ''}`);
        expect.soft(m.russianWords, 'the page is in Russian').toBeGreaterThan(20); expect.soft(m.scroll, 'sideways').toBeLessThanOrEqual(m.client); expect.soft(m.pastEdge, 'past the edge').toEqual([]);
        await page.screenshot({ path: `qa/.shots/ru-arena-${who.replace(' ', '-')}-${width}-${theme}.png`, fullPage: true, mask: [page.locator('.tnav-drop-email')] });
      } finally { await ctx.close().catch(() => {}); }
    }
  });
}
