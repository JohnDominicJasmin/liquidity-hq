/* QA (2026-11-20, PM's L103 closing method): time-to-first-byte of PUBLIC GET routes on the same server, measured from the GitHub runner, signed out, read-only: /api/version and one cached public market route, 10 requests each, 300 ms apart. Prints p50 / p90 / max and every sample. No assertions: it is a measurement. Nothing is written, no credentials, no AI route. */
import { test } from '@playwright/test';

const ROUTES = ['/api/version', '/api/market/klines?source=bybit&symbol=BTCUSDT&interval=1h&limit=5'];
const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]; };
for (const route of ROUTES) {
  test(`TTFB ${route}`, async ({ request }) => {
    test.setTimeout(120_000);
    await request.get(route).catch(() => undefined);   /* one throwaway request: a cold wake is not the number */
    const ms: number[] = []; const statuses: number[] = [];
    for (let i = 0; i < 10; i++) { const t0 = performance.now(); const r = await request.get(route).catch(() => null); ms.push(Math.round(performance.now() - t0)); statuses.push(r ? r.status() : 0); await new Promise((res) => setTimeout(res, 300)); }
    console.log(`[TTFB] ${route.split('?')[0]} n=10 p50 ${pct(ms, 50)} ms, p90 ${pct(ms, 90)} ms, max ${Math.max(...ms)} ms; statuses ${[...new Set(statuses)].join(',')}; samples ${ms.join(' ')}`);
  });
}
