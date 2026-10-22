/* Page-speed BASELINE, signed out, read-only (plain page loads, analytics consent denied, no clicks, no sign-in). Chromium via Playwright + CDP.
 * Per page x viewport x condition: N cold loads (new context each = empty cache); reports the MEDIAN of N and the min-max.
 * Metrics (browser Performance API): TTFB, FCP, LCP, CLS, TBT (long tasks after FCP, sum of duration-50ms, measured to 8 s after load), load event;
 * network: requests, transfer bytes and JS transfer bytes (CDP Network.loadingFinished encodedDataLength).
 * Conditions: "plain" = this machine's real network, no throttling. "mobile" = CDP 4x CPU slowdown + 1.6 Mbps down / 0.75 Mbps up / 150 ms RTT (Lighthouse-style mobile),
 * only for the 390 px viewport. Far from a lab: one machine, one network, a Singapore server; use it to compare a later run made the SAME way, not as an absolute.
 * usage: node perf-baseline.mjs <base-url> <runs=3> <out.json>                                                                            */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { writeFileSync } from 'node:fs';
const [, , base = 'https://liquidity-hq.com', runsArg = '3', outFile = 'perf-baseline.json'] = process.argv; const RUNS = Number(runsArg);
const PAGES = ['/', '/arena', '/liq', '/dashboard'];
const VIEWS = [{ name: 'desktop', w: 1280, h: 800, mobile: false, conds: ['plain'] }, { name: 'mobile-390', w: 390, h: 844, mobile: true, conds: ['plain', 'mobile'] }];
const med = (a) => { const s = [...a].sort((x, y) => x - y); return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2; };
const INIT = () => {
  window.__m = { lcp: 0, cls: 0, fcp: null, long: [] };
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.lcp = e.startTime; }).observe({ type: 'largest-contentful-paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__m.cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) if (e.name === 'first-contentful-paint') window.__m.fcp = e.startTime; }).observe({ type: 'paint', buffered: true });
  new PerformanceObserver((l) => { for (const e of l.getEntries()) window.__m.long.push([e.startTime, e.duration]); }).observe({ type: 'longtask', buffered: true });
  try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* */ }
};
const browser = await chromium.launch(); const out = { base, runs: RUNS, at: new Date().toISOString(), chromium: browser.version(), rows: [] };
try {
  for (const v of VIEWS) for (const cond of v.conds) for (const p of PAGES) {
    const runs = [];
    for (let i = 0; i < RUNS; i++) {
      const ctx = await browser.newContext({ viewport: { width: v.w, height: v.h }, ...(v.mobile ? { isMobile: true, hasTouch: true, deviceScaleFactor: 2 } : {}) });
      await ctx.addInitScript(INIT); const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
      await cdp.send('Network.enable'); await cdp.send('Network.setCacheDisabled', { cacheDisabled: true });
      if (cond === 'mobile') { await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 }); await cdp.send('Network.emulateNetworkConditions', { offline: false, latency: 150, downloadThroughput: (1.6e6 / 8) * 0.9, uploadThroughput: (0.75e6 / 8) * 0.9 }); }
      const reqs = new Map(); let nonGet = 0;
      cdp.on('Network.requestWillBeSent', (e) => { reqs.set(e.requestId, { url: e.request.url, type: e.type, bytes: 0 }); if (e.request.method !== 'GET') nonGet++; });
      cdp.on('Network.loadingFinished', (e) => { const r = reqs.get(e.requestId); if (r) r.bytes = e.encodedDataLength; });
      try {
        await page.goto(base + p, { waitUntil: 'load', timeout: 120_000 }); await page.waitForTimeout(8000);
        const m = await page.evaluate(() => { const n = performance.getEntriesByType('navigation')[0]; const fcp = window.__m.fcp; const tbt = window.__m.long.filter(([s]) => fcp != null && s >= fcp).reduce((a, [, d]) => a + Math.max(0, d - 50), 0); return { path: location.pathname, ttfb: n.responseStart, fcp, lcp: window.__m.lcp, cls: window.__m.cls, tbt, load: n.loadEventEnd }; });
        const all = [...reqs.values()]; const js = all.filter((r) => r.type === 'Script').reduce((a, r) => a + r.bytes, 0);
        runs.push({ ...m, requests: all.length, kb: Math.round(all.reduce((a, r) => a + r.bytes, 0) / 1024), jsKb: Math.round(js / 1024), nonGet });
      } catch (e) { runs.push({ error: String(e.message).slice(0, 100) }); }
      await ctx.close();
    }
    const ok = runs.filter((r) => !r.error); const f = (k, d = 0) => ok.length ? Number(med(ok.map((r) => r[k])).toFixed(d)) : null; const rng = (k, d = 0) => ok.length ? `${Math.min(...ok.map((r) => r[k])).toFixed(d)}-${Math.max(...ok.map((r) => r[k])).toFixed(d)}` : null;
    const row = { viewport: v.name, condition: cond, page: p, landed: ok[0]?.path, n: ok.length, ttfb: f('ttfb'), fcp: f('fcp'), lcp: f('lcp'), lcpRange: rng('lcp'), cls: f('cls', 3), tbt: f('tbt'), load: f('load'), requests: f('requests'), kb: f('kb'), jsKb: f('jsKb'), nonGetRequests: ok.length ? Math.max(...ok.map((r) => r.nonGet)) : null, errors: runs.filter((r) => r.error).length };
    out.rows.push(row); console.log(JSON.stringify(row));
  }
} finally { await browser.close(); writeFileSync(outFile, JSON.stringify(out, null, 1)); }
