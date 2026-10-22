/* #1397 part 2: what ONE page load costs, on a LOCAL PRODUCTION BUILD of the current dev (never production, never a deployed host). Same method as #1404 / #1397 part 1:
 *   - N page loads per page (signed-out visitor, a fresh browser context each, so nothing is cached in the browser), against `next start` on this machine;
 *   - upstream calls counted AT THE SERVER by qa/server-intercept.mjs in `count` mode (it wraps globalThis.fetch and passes every call through; it sees what Next's data cache never lets through);
 *   - server CPU-seconds = processor time of the `next start` process tree, before and after the batch; an IDLE interval of the same length measures what the server burns doing nothing, reported alongside.
 * One server per page (in-process caches start cold each time); 3 warm-up loads first (the first request pays for route setup), counted separately and NOT in the per-100 figures.
 * The browser blocks every host except localhost, so the machine does not call exchanges from the page; only the server's own upstream calls are measured. Nothing is submitted anywhere.
 * usage: node measure-load.mjs <out.json> [loads-per-page=40] [port=3101] [pages=/,/arena,/dashboard]                                                                                      */
import { chromium } from 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/node_modules/playwright/index.mjs';
import { spawn, execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
const [, , outFile = 'measure-load.json', nArg = '40', portArg = '3101', pagesArg = '/,/arena,/dashboard'] = process.argv;
const N = Number(nArg); const PORT = Number(portArg); const PAGES = pagesArg.split(',');
const REPO = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/liquidity-hq'; const HERE = 'C:/Users/Dominic/Documents/VS code/liquidity-hq-qa/qa-resume-2026-10-01/scripts/qa-howto-arena';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cpu = (pid) => Number(execFileSync('powershell', ['-NoProfile', '-File', `${HERE}/tree-cpu.ps1`, '-RootPid', String(pid)], { encoding: 'utf8' }).trim());
const tallyOf = (f) => { try { return JSON.parse(readFileSync(f, 'utf8')); } catch { return { byHost: {}, total: 0 }; } };
const diff = (a, b) => { const out = {}; for (const h of new Set([...Object.keys(a.byHost || {}), ...Object.keys(b.byHost || {})])) { const d = (b.byHost?.[h] ?? 0) - (a.byHost?.[h] ?? 0); if (d) out[h] = d; } return out; };
const rows = []; const meta = { startedAt: new Date().toISOString(), loadsPerPage: N, port: PORT };
const browser = await chromium.launch();
try {
  for (const path of PAGES) {
    const tally = `${HERE}/.tally-${PORT}.json`; if (existsSync(tally)) rmSync(tally);
    const srv = spawn(process.execPath, ['--import', 'file:///C:/Users/Dominic/Documents/VS%20code/liquidity-hq-qa/liquidity-hq/qa/server-intercept.mjs', 'node_modules/next/dist/bin/next', 'start', '-p', String(PORT)], { cwd: REPO, env: { ...process.env, QA_INTERCEPT_UPSTREAM: 'count', QA_INTERCEPT_OUT: tally, NEXT_TELEMETRY_DISABLED: '1', PORT: String(PORT) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let log = ''; srv.stdout.on('data', (d) => { log += d; }); srv.stderr.on('data', (d) => { log += d; });
    try {
      for (let i = 0; i < 60; i++) { try { const r = await fetch(`http://localhost:${PORT}/api/version`); if (r.ok) break; } catch { /* not up yet */ } await sleep(1000); }
      const load = async () => {
        const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
        await ctx.addInitScript(() => { try { localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* */ } });
        await ctx.route('**/*', (r) => { try { return new URL(r.request().url()).hostname === 'localhost' ? r.continue() : r.abort('failed'); } catch { return r.abort('failed'); } });
        await ctx.routeWebSocket(/.*/, (ws) => ws.close());
        const page = await ctx.newPage(); let status = null;
        try { const resp = await page.goto(`http://localhost:${PORT}${path}`, { waitUntil: 'load', timeout: 90_000 }); status = resp?.status() ?? null; await sleep(6000); } catch { /* counted as a failed load */ }
        await ctx.close(); return status;
      };
      const warm = []; for (let i = 0; i < 3; i++) warm.push(await load());
      await sleep(3000); const t0 = tallyOf(tally); const cpu0 = cpu(srv.pid); const w0 = Date.now();
      const statuses = []; for (let i = 0; i < N; i++) statuses.push(await load());
      await sleep(3000); const wall = (Date.now() - w0) / 1000; const t1 = tallyOf(tally); const cpu1 = cpu(srv.pid);
      const idle0 = cpu(srv.pid); await sleep(Math.min(60_000, Math.round(wall * 1000))); const idle1 = cpu(srv.pid);
      const d = diff(t0, t1); const total = Object.values(d).reduce((a, b) => a + b, 0); const ok = statuses.filter((s) => s === 200).length;
      const row = { page: path, loads: N, ok200: ok, warmupStatuses: warm, upstreamTotal: total, upstreamPer100: Number((total / N * 100).toFixed(1)), byHostPer100: Object.fromEntries(Object.entries(d).sort((a, b) => b[1] - a[1]).map(([h, c]) => [h, Number((c / N * 100).toFixed(1))])), cpuSecondsBatch: Number((cpu1 - cpu0).toFixed(2)), cpuPer100: Number(((cpu1 - cpu0) / N * 100).toFixed(1)), wallSeconds: Number(wall.toFixed(0)), idleCpuSecondsPerSecond: Number(((idle1 - idle0) / (Math.min(60_000, Math.round(wall * 1000)) / 1000)).toFixed(4)) };
      rows.push(row); console.log(JSON.stringify(row));
    } finally { try { execFileSync('taskkill', ['/PID', String(srv.pid), '/T', '/F'], { stdio: 'ignore' }); } catch { /* already gone */ } await sleep(1500); }
  }
} finally { await browser.close(); writeFileSync(outFile, JSON.stringify({ meta, rows }, null, 1)); }
