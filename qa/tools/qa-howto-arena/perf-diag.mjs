/* Diagnostic for perf-baseline.mjs numbers: for one page on one base, list every NON-GET request the page makes (method + host/path, no bodies) and the long tasks (start, duration),
 * and the layout-shift entries (time, value). One cold load, desktop 1280, no throttling. usage: node perf-diag.mjs <base-url> <path>                                   */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
const [, , base = 'https://liquidity-hq.com', path = '/'] = process.argv;
const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(() => {
    window.__d = { long: [], shifts: [] }; try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* */ }
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__d.long.push([Math.round(e.startTime), Math.round(e.duration)]); }).observe({ type: 'longtask', buffered: true });
    new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__d.shifts.push([Math.round(e.startTime), Number(e.value.toFixed(3)), e.hadRecentInput]); }).observe({ type: 'layout-shift', buffered: true });
  });
  const page = await ctx.newPage(); const nonGet = [];
  page.on('request', (r) => { if (r.method() !== 'GET') { const u = new URL(r.url()); nonGet.push(`${r.method()} ${u.host}${u.pathname}`); } });
  await page.goto(base + path, { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(8000);
  const d = await page.evaluate(() => window.__d);
  console.log('non-GET:', JSON.stringify(nonGet)); console.log('long tasks [start,dur] ms:', JSON.stringify(d.long.slice(0, 25)), 'count', d.long.length);
  console.log('layout shifts [t,value,hadRecentInput]:', JSON.stringify(d.shifts.slice(0, 20)), 'sum', d.shifts.filter((s) => !s[2]).reduce((a, s) => a + s[1], 0).toFixed(3));
} finally { await browser.close(); }
