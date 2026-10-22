/* Lists the interactive controls a page renders (text, aria-label, testid, role, disabled, box) so the #1640 feature scripts can name real controls
 * instead of guessing. Writes OFF (rlib fence). usage: node dump-controls.mjs <path> [acct=A] [w=1280] [clickText]   clickText: click the first button
 * whose text matches (regexp, case-insensitive) after load and dump again (to see a menu or panel it opens). */
import { chromium, open, quiet, sleep, BASE } from './rlib.mjs';
const [, , path = '/arena', acct = 'A', wArg = '1280', clickText] = process.argv;
const browser = await chromium.launch();
const DUMP = () => [...document.querySelectorAll('button, a[href], input, select, textarea, [role="button"], [role="tab"], [role="switch"], [role="checkbox"], [role="combobox"], [role="menuitem"], [role="option"]')]
  .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; })
  .map((e) => { const r = e.getBoundingClientRect(); return [e.tagName.toLowerCase() + (e.type ? ':' + e.type : ''), e.getAttribute('role') || '', (e.innerText || e.value || '').trim().replace(/\s+/g, ' ').slice(0, 40), e.getAttribute('aria-label') || '', e.getAttribute('data-testid') || '', e.getAttribute('name') || e.getAttribute('placeholder') || '', e.disabled || e.getAttribute('aria-disabled') === 'true' ? 'DISABLED' : '', e.getAttribute('aria-checked') ?? e.getAttribute('aria-pressed') ?? (e.checked === undefined ? '' : String(e.checked)), `${Math.round(r.left)},${Math.round(r.top)} ${Math.round(r.width)}x${Math.round(r.height)}`, e.tagName === 'A' ? (e.getAttribute('href') || '').slice(0, 50) : ''].join(' | '); });
try {
  const ctx = await open(browser, { acct, w: Number(wArg) }); const page = await ctx.newPage(); const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now())); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
  await page.goto(BASE + path, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(1500);
  console.log(`== ${acct} ${path} -> ${page.url().replace(BASE, '')}`); for (const l of await page.evaluate(DUMP)) console.log(l);
  if (clickText) {
    const b = page.locator('button, [role="button"], a').filter({ hasText: new RegExp(clickText, 'i') }).first();
    if (await b.count()) { await b.click({ timeout: 5000 }).catch((e) => console.log('click failed', e.message.slice(0, 80))); await sleep(1500); console.log(`== after clicking /${clickText}/i -> ${page.url().replace(BASE, '')}`); for (const l of await page.evaluate(DUMP)) console.log(l); }
    else console.log(`no control matching /${clickText}/i`);
  }
  await ctx.close();
} finally { await browser.close(); }
