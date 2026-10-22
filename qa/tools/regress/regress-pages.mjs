/* #1640 page sweep: every page x account x width, dark and then light, writes OFF (rlib fence).
 * Light is the app's own theme switch applied in-page (rlib.flipTheme = lib/theme.ts applyTheme); a separate control run compares it with a full light reload.
 * Per (account, page, width) it records: final URL, document status, title, first h1, error-boundary text, console errors and page errors, failed
 * requests (fence blocks and refused Supabase writes kept apart from real failures), HTTP >= 400 answers, sideways scroll (document scrollWidth vs the
 * REQUESTED width) with the outermost elements causing it, the Ask AI button covering a control (phone), time to quiet; photos: viewport and full
 * page, dark and light, in <ROOT>/<page>/.
 * One JSON line per (account, page, width) is appended to <ROOT>/_sweep/results.jsonl; a re-run skips lines already there (resume after a reap).
 * usage: node regress-pages.mjs [accts=anon,B,T,A] [widths=1280,390] [pages csv=all]                                                                  */
import { chromium, open, quiet, sleep, flipTheme, dirFor, BASE, ROOT } from './rlib.mjs';
import { PAGES } from './pages.mjs';
import { mkdirSync, existsSync, readFileSync, appendFileSync } from 'node:fs';
const accts = (process.argv[2] || 'anon,B,T,A').split(',');
const widths = (process.argv[3] || '1280,390').split(',').map(Number);
const pages = process.argv[4] ? process.argv[4].split(',') : PAGES;
mkdirSync(`${ROOT}/_sweep`, { recursive: true });
const OUTF = `${ROOT}/_sweep/results.jsonl`;
/* A row that ended in an error (e.g. the sign-in mint failed) does not count as done: a re-run tries it again, and readers take the LAST row per key. */
const done = new Set(existsSync(OUTF) ? readFileSync(OUTF, 'utf8').split('\n').filter(Boolean).map((l) => { try { const j = JSON.parse(l); return j.error ? null : j.key; } catch { return null; } }) : []);
/* RERUN="A|/terms|390,..." forces those keys again (a row taken during an outage or a crash); the new row is appended and readers take the last one. */
for (const k of (process.env.RERUN || '').split(',').filter(Boolean)) done.delete(k);

const MEASURE = (W) => {
  const de = document.documentElement; const body = document.body; const text = body ? body.innerText : '';
  const boundary = /Something went wrong|Application error|client-side exception|This page could not be found|Internal Server Error|Unhandled Runtime Error/i.exec(text);
  const sw = Math.max(de.scrollWidth, body ? body.scrollWidth : 0);
  const offenders = [];
  if (sw > W + 1 && body) {
    const clipped = (el) => { for (let p = el.parentElement; p && p !== body; p = p.parentElement) { const ox = getComputedStyle(p).overflowX; if (ox === 'auto' || ox === 'scroll' || ox === 'hidden' || ox === 'clip') return true; } return false; };
    const hits = new Set();
    for (const el of body.querySelectorAll('*')) { const r = el.getBoundingClientRect(); if (r.width > 0 && r.right > W + 1 && !clipped(el)) hits.add(el); if (hits.size > 400) break; }
    for (const el of hits) { if (hits.has(el.parentElement)) continue; const r = el.getBoundingClientRect(); offenders.push({ tag: el.tagName.toLowerCase(), cls: typeof el.className === 'string' ? el.className.slice(0, 70) : '', testid: el.getAttribute('data-testid'), right: Math.round(r.right), w: Math.round(r.width), text: (el.innerText || '').trim().replace(/\s+/g, ' ').slice(0, 50) }); if (offenders.length >= 8) break; }
  }
  const fabCovers = [];
  const fab = document.querySelector('.gchat-fab');
  if (fab && W < 500) {
    const cs = getComputedStyle(fab); const fr = fab.getBoundingClientRect();
    if (cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.1 && fr.width > 0) {
      for (const el of document.querySelectorAll('input, select, textarea, button, a[href], [role="button"], [role="tab"]')) {
        if (fab.contains(el) || el.contains(fab)) continue; const r = el.getBoundingClientRect(); if (!r.width || !r.height) continue;
        const ix = Math.max(0, Math.min(r.right, fr.right) - Math.max(r.left, fr.left)); const iy = Math.max(0, Math.min(r.bottom, fr.bottom) - Math.max(r.top, fr.top));
        const pct = (ix * iy) / (r.width * r.height); const v = getComputedStyle(el);
        if (pct > 0.15 && v.visibility !== 'hidden' && v.display !== 'none' && parseFloat(v.opacity) > 0.1) fabCovers.push({ tag: el.tagName.toLowerCase(), label: (el.getAttribute('aria-label') || el.innerText || el.getAttribute('placeholder') || '').trim().replace(/\s+/g, ' ').slice(0, 40), pct: Math.round(100 * pct) });
      }
    }
  }
  const nav = document.querySelector('nav, header'); const planHint = nav ? (/(\bPRO\b|\bFREE\b|\bTRIAL\b|Sign in|Log in|Get started)/i.exec(nav.innerText || '') || [null])[0] : null;
  const links = [...new Set([...document.querySelectorAll('a[href]')].map((a) => { try { const u = new URL(a.href); return u.origin === location.origin ? u.pathname + u.search : null; } catch { return null; } }).filter(Boolean))].slice(0, 200);
  const deadAnchors = [...document.querySelectorAll('a')].filter((a) => { const h = a.getAttribute('href'); const r = a.getBoundingClientRect(); return r.width > 0 && (h === null || h === '' || h === '#') && !a.getAttribute('role') && !a.onclick; }).map((a) => (a.innerText || a.getAttribute('aria-label') || '').trim().slice(0, 40)).slice(0, 10);
  // the app's own "could not read your account" panels (#1119): during the dev project's auth slowdown (05:1x-06:0x UTC) these are environment, not page bugs
  const accountLoadError = (text.match(/Couldn['’]t load your account|having trouble reaching our servers/gi) || []).length;
  return { title: document.title, h1: (document.querySelector('h1')?.innerText || '').trim().slice(0, 80), boundary: boundary ? boundary[0] : null, scrollWidth: sw, offenders, fabCovers, planHint, textLen: text.length, docH: Math.max(de.scrollHeight, body ? body.scrollHeight : 0), theme: de.getAttribute('data-theme'), links, deadAnchors, accountLoadError };
};

const browser = await chromium.launch();
const stamp = () => new Date().toISOString().slice(11, 19);
try {
  const build = (await (await fetch(BASE + '/api/version')).json()).commit;
  console.log('build', build, new Date().toISOString(), `accts=${accts} widths=${widths} pages=${pages.length} already done=${done.size}`);
  for (const acct of accts) for (const p of pages) for (const w of widths) {
    const key = `${acct}|${p}|${w}`; if (done.has(key)) continue;
    const dir = dirFor(p); const tag = `${acct}-${w}`;
    const rec = []; let ctx;
    const row = { key, acct, page: p, w, build, at: new Date().toISOString() };
    try {
      ctx = await open(browser, { acct, w, theme: 'dark', rec });
      const page = await ctx.newPage();
      const inflight = new Map(); const consoleErr = []; const pageErr = []; const failed = []; const httpErr = [];
      page.on('request', (r) => inflight.set(r, Date.now()));
      page.on('requestfinished', (r) => inflight.delete(r));
      page.on('requestfailed', (r) => { inflight.delete(r); const e = r.failure()?.errorText || ''; const u = r.url().replace(BASE, ''); failed.push({ u: u.slice(0, 160), e, kind: /BLOCKED_BY_CLIENT/.test(e) ? 'fence' : /ACCESS_DENIED/.test(e) ? 'refused' : /ERR_ABORTED/.test(e) ? 'aborted' : 'FAILED' }); });
      page.on('response', (r) => { if (r.status() >= 400) httpErr.push({ u: r.url().replace(BASE, '').slice(0, 160), s: r.status(), m: r.request().method() }); });
      page.on('console', (m) => { if (m.type() === 'error') consoleErr.push({ t: m.text().slice(0, 220), at: (m.location()?.url || '').replace(BASE, '').slice(0, 100) }); });
      page.on('pageerror', (e) => pageErr.push(String(e.message || e).slice(0, 220)));
      const t0 = Date.now();
      const resp = await page.goto(BASE + p, { waitUntil: 'load', timeout: 90_000 });
      row.status = resp ? resp.status() : null;
      row.quietMs = await quiet(page, inflight, 2000, 25_000); await sleep(1000);
      row.loadMs = Date.now() - t0; row.finalUrl = page.url().replace(BASE, '');
      row.dark = await page.evaluate(MEASURE, w);
      await page.screenshot({ path: `${dir}/${tag}-dark.jpg`, type: 'jpeg', quality: 70 });
      await page.screenshot({ path: `${dir}/${tag}-dark-full.jpg`, type: 'jpeg', quality: 60, fullPage: true, timeout: 30_000 }).catch((e) => { row.fullShotError = String(e.message).slice(0, 80); });
      await flipTheme(page, 'light'); await sleep(1500);
      row.light = await page.evaluate(MEASURE, w);
      await page.screenshot({ path: `${dir}/${tag}-light.jpg`, type: 'jpeg', quality: 70 });
      await page.screenshot({ path: `${dir}/${tag}-light-full.jpg`, type: 'jpeg', quality: 60, fullPage: true, timeout: 30_000 }).catch(() => {});
      row.consoleErr = consoleErr; row.pageErr = pageErr; row.httpErr = httpErr;
      row.failed = failed.filter((f) => f.kind === 'FAILED'); row.fenced = failed.filter((f) => f.kind === 'fence').map((f) => f.u.replace(/\?.*$/, '')).filter((v, i, a) => a.indexOf(v) === i);
      row.refused = failed.filter((f) => f.kind === 'refused').length; row.aborted = failed.filter((f) => f.kind === 'aborted').length;
      const sum = {}; for (const n of rec) { const k = `${n.kind} ${n.m} ${n.url.replace(/\?.*$/, '')}`; sum[k] = (sum[k] || 0) + 1; } row.fence = sum;
    } catch (e) { row.error = String(e.message || e).slice(0, 200); }
    try { await ctx?.close(); } catch { /* */ }
    appendFileSync(OUTF, JSON.stringify(row) + '\n');
    const d = row.dark || {};
    console.log(`${stamp()} ${key} -> ${row.finalUrl ?? '-'} ${row.status ?? ''} ${row.loadMs ?? ''}ms | boundary=${d.boundary ?? '-'} sw=${d.scrollWidth ?? '-'} off=${(d.offenders || []).length} fab=${(d.fabCovers || []).length} cons=${(row.consoleErr || []).length} perr=${(row.pageErr || []).length} http=${(row.httpErr || []).length} fail=${(row.failed || []).length}${row.error ? ' ERROR ' + row.error : ''}`);
  }
} finally { await browser.close(); }
