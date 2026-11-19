/* QA (2026-11-20): status and time to first byte of PUBLIC GET routes on the same server, from the GitHub runner, signed out, read-only. Used to tell an ENVIRONMENT difference (the server cannot reach an exchange) from a code regression when the same page shows failing text on one site and not on another. Prints status, body start and p50 / max for 6 requests of each route. No assertions: a measurement. Nothing is written, no credentials, no AI route. */
import { test } from '@playwright/test';

const ROUTES = [
  '/api/version',
  '/api/market/klines?source=bybit&symbol=BTCUSDT&interval=1h&limit=168&closed=1',
  '/api/market/klines?source=binance-futures&symbol=BTCUSDT&interval=1h&limit=168&closed=1',
  '/api/market/klines?source=binance&symbol=BTCUSDT&interval=1h&limit=168&closed=1',
];
for (const route of ROUTES) {
  test(`TTFB and status ${route}`, async ({ request }) => {
    test.setTimeout(120_000);
    const ms: number[] = []; const statuses: number[] = []; let head = '';
    for (let i = 0; i < 6; i++) { const t0 = performance.now(); const r = await request.get(route).catch(() => null); ms.push(Math.round(performance.now() - t0)); statuses.push(r ? r.status() : 0); if (i === 0 && r) head = (await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 110); await new Promise((res) => setTimeout(res, 400)); }
    const s = [...ms].sort((a, b) => a - b);
    console.log(`[TTFB] ${route.replace(/&closed=1$/, '')} statuses ${statuses.join(',')} p50 ${s[Math.floor(s.length / 2)]} ms max ${s[s.length - 1]} ms | body: ${head}`);
  });
}
