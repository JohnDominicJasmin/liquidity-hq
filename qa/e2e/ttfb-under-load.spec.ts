/* QA (2026-11-20, L103 closing method, second half): the idle time to first byte of /api/version is the same on qa and prod (about 260 ms), but the dry-powder request on qa waited 3 to 8 s for its first byte while the /research page was loading. This measures the SAME public route WHILE a page loads: a signed-out visitor opens /dashboard (many API calls at once) and, from a second context, /api/version is requested every 400 ms for 25 s. Read-only, signed out, no AI route, nothing written. Prints p50 / p90 / max and the samples. A measurement, no assertions. */
import { test } from '@playwright/test';

const pct = (a: number[], p: number) => { const s = [...a].sort((x, y) => x - y); return s.length ? s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] : -1; };
test('TTFB of /api/version while /dashboard loads (signed out)', async ({ browser }) => {
  test.setTimeout(150_000);
  const loader = await browser.newContext(); const page = await loader.newPage(); const prober = await browser.newContext(); const req = prober.request;
  await req.get('/api/version').catch(() => undefined);
  const during: number[] = []; const before: number[] = [];
  for (let i = 0; i < 5; i++) { const t0 = performance.now(); await req.get('/api/version').catch(() => null); before.push(Math.round(performance.now() - t0)); await new Promise((r) => setTimeout(r, 300)); }
  const t0 = Date.now(); const nav = page.goto('/dashboard', { waitUntil: 'domcontentloaded', timeout: 90_000 }).catch(() => undefined);
  while (Date.now() - t0 < 25_000) { const s = performance.now(); await req.get('/api/version').catch(() => null); during.push(Math.round(performance.now() - s)); await new Promise((r) => setTimeout(r, 400)); }
  await nav;
  console.log(`[TTFBLOAD] idle before: p50 ${pct(before, 50)} ms max ${Math.max(...before)} ms | while /dashboard loads (n=${during.length}): p50 ${pct(during, 50)} ms, p90 ${pct(during, 90)} ms, max ${Math.max(...during)} ms; samples ${during.join(' ')}`);
  await loader.close(); await prober.close();
});
