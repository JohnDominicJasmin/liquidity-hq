/* #1640 dead-button pass: on every page (Pro A for app pages, signed out for public ones), 1280 dark, writes OFF, every AI request answered locally.
 * Clicks each visible, enabled control (button, role=button/tab/switch) except a deny list (sign out, delete/remove, password, Google, payments,
 * Telegram connect), one at a time, and records what changed within 1.2 s: URL, new requests, a dialog, or DOM mutations on nodes that were NOT
 * already changing on their own (a 2.5 s baseline per load filters live tickers). A control with none of these is listed as "no visible effect" for a
 * human look; it is not called dead until a photo or the source agrees. Internal links are checked separately (every same-origin href found by the
 * page sweep, one GET each, status recorded).
 * usage: node regress-buttons.mjs [pages csv=all] [maxPerPage=60] [links=1]                                                                       */
import { chromium, open, quiet, sleep, BASE, ROOT } from './rlib.mjs';
import { PAGES } from './pages.mjs';
import { mkdirSync, appendFileSync, readFileSync, existsSync, writeFileSync } from 'node:fs';
const pages = process.argv[2] && process.argv[2] !== 'all' ? process.argv[2].split(',') : PAGES.filter((p) => !['/ko', '/zh', '/reset-password'].includes(p));
const MAX = Number(process.argv[3] || 60); const doLinks = (process.argv[4] ?? '1') === '1';
const LOG = `${ROOT}/_sweep/buttons.jsonl`; mkdirSync(`${ROOT}/_sweep`, { recursive: true });
const say = (o) => { console.log(JSON.stringify(o).slice(0, 500)); appendFileSync(LOG, JSON.stringify({ at: new Date().toISOString(), ...o }) + '\n'); };
const PUBLIC = new Set(['/', '/login', '/login?signup=1', '/forgot-password', '/about', '/contact', '/faq', '/disclaimer', '/privacy', '/terms', '/refund', '/offline']);
const DENY = /sign ?out|log ?out|delete|remove|unlink|disconnect|cancel|password|google|pay|join|buy|subscribe|checkout|connect telegram|ban|revoke|reset/i;
/* Installed into the page after every load: window.__qaCands() lists the candidate controls in document order. */
const INSTALL = (deny) => { const rx = new RegExp(deny, 'i'); window.__qaCands = () => [...document.querySelectorAll('button, [role="button"], [role="tab"], [role="switch"]')].filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); if (!(r.width > 0 && r.height > 0) || s.visibility === 'hidden' || s.display === 'none' || parseFloat(s.opacity) < 0.1) return false; if (e.disabled || e.getAttribute('aria-disabled') === 'true') return false; const label = ((e.innerText || '') + ' ' + (e.getAttribute('aria-label') || '')).trim(); return !rx.test(label); }); };
const browser = await chromium.launch();
try {
  console.log('build', (await (await fetch(BASE + '/api/version')).json()).commit, new Date().toISOString());
  for (const p of pages) {
    const acct = PUBLIC.has(p) ? 'anon' : 'A';
    const ctx = await open(browser, { acct, w: 1280, theme: 'dark' }); const page = await ctx.newPage(); const inflight = new Map(); let reqs = 0; let dialogs = 0;
    page.on('request', (r) => { inflight.set(r, Date.now()); if (!/\.(png|jpg|svg|woff2?|css)(\?|$)/.test(r.url())) reqs++; }); page.on('requestfinished', (r) => inflight.delete(r)); page.on('requestfailed', (r) => inflight.delete(r));
    page.on('dialog', (d) => { dialogs++; d.dismiss().catch(() => {}); }); page.on('popup', (pp) => pp.close().catch(() => {}));
    const fresh = async () => { await page.goto(BASE + p, { waitUntil: 'load', timeout: 90_000 }); await quiet(page, inflight, 2000, 20_000); await sleep(1000);
      await page.evaluate(() => { const st = { mode: 'base', base: new Set(), after: 0 }; window.__qaMut = st; new MutationObserver((list) => { for (const m of list) { const n = m.target.nodeType === 1 ? m.target : m.target.parentElement; if (!n) continue; if (st.mode === 'base') st.base.add(n); else { let x = n, known = false; for (let i = 0; i < 3 && x; i++, x = x.parentElement) if (st.base.has(x)) { known = true; break; } if (!known) st.after++; } } }).observe(document.body, { subtree: true, childList: true, attributes: true, characterData: true }); });
      await sleep(2500); await page.evaluate(() => { window.__qaMut.mode = 'after'; }); await page.evaluate(INSTALL, DENY.source); };
    const results = [];
    try {
      await fresh(); const startUrl = page.url();
      const total = await page.evaluate(() => window.__qaCands().length);
      for (let i = 0; i < Math.min(MAX, total); i++) {
        const info = await page.evaluate((idx) => { const c = window.__qaCands ? window.__qaCands()[idx] : null; if (!c) return null; c.setAttribute('data-qa-click', '1'); return { label: ((c.innerText || '').trim() || c.getAttribute('aria-label') || c.getAttribute('data-testid') || c.tagName).replace(/\s+/g, ' ').slice(0, 50), role: c.getAttribute('role') || c.tagName.toLowerCase(), testid: c.getAttribute('data-testid') }; }, i);
        if (!info) break;
        await page.evaluate(() => { window.__qaMut.after = 0; }); const r0 = reqs, d0 = dialogs, u0 = page.url();
        await page.locator('[data-qa-click="1"]').first().click({ timeout: 3000, trial: false }).catch((e) => { info.clickError = e.message.slice(0, 60); });
        await sleep(1200);
        const mut = await page.evaluate(() => window.__qaMut ? window.__qaMut.after : -1).catch(() => -1);
        const eff = { url: page.url() !== u0, reqs: reqs - r0, dialog: dialogs - d0, mutations: mut };
        const none = !eff.url && eff.reqs === 0 && eff.dialog === 0 && mut === 0 && !info.clickError;
        results.push({ ...info, ...eff, noVisibleEffect: none });
        await page.evaluate(() => document.querySelectorAll('[data-qa-click]').forEach((e) => e.removeAttribute('data-qa-click'))).catch(() => {});
        await page.keyboard.press('Escape').catch(() => {});
        if (page.url() !== startUrl || mut < 0) { await fresh(); }
      }
      say({ page: p, acct, controlsTried: results.length, noVisibleEffect: results.filter((r) => r.noVisibleEffect).map((r) => `${r.label} (${r.role}${r.testid ? ' ' + r.testid : ''})`), clickErrors: results.filter((r) => r.clickError).map((r) => `${r.label}: ${r.clickError}`).slice(0, 6) });
      writeFileSync(`${ROOT}/_sweep/buttons-${p === '/' ? 'landing' : p.replace(/^\//, '').replace(/[^a-z0-9-]+/gi, '-')}.json`, JSON.stringify(results, null, 1));
    } catch (e) { say({ page: p, acct, ERROR: String(e.message).slice(0, 160) }); }
    await ctx.close();
  }
  if (doLinks && existsSync(`${ROOT}/_sweep/results.jsonl`)) {
    const links = new Set(); for (const l of readFileSync(`${ROOT}/_sweep/results.jsonl`, 'utf8').split('\n').filter(Boolean)) { try { for (const h of (JSON.parse(l).dark?.links || [])) links.add(h.split('#')[0]); } catch { /* */ } }
    const bad = []; let n = 0;
    for (const h of [...links].sort()) { if (/^\/(admin|ops)/.test(h)) continue; n++; try { const r = await fetch(BASE + h, { redirect: 'manual' }); if (r.status >= 400) bad.push(`${h} -> ${r.status}`); } catch (e) { bad.push(`${h} -> ${e.message}`); } await sleep(150); }
    say({ part: 'internal links', checked: n, broken: bad });
  }
} finally { await browser.close(); }
