/* PROBE (QA, 2026-11-20): on staging /api/market/rsi answers 401 TOKEN_EXPIRED to an UNAUTHENTICATED request from the Playwright request context (which carries the HTTP gate's Basic credentials), while prod answers 200. Hypothesis: the route reads ANY Authorization header as a Bearer token, so the gate's Basic header makes it a 401 (an environment effect: prod has no gate). This fetches the route from inside the page twice: with the browser's default credentials and with credentials 'omit', and prints both statuses plus which Authorization scheme the request carried (read via a request listener). Read-only, signed out. */
import { test } from '@playwright/test';

test('rsi route with and without the gate credentials', async ({ page }) => {
  test.setTimeout(120_000);
  const seen: string[] = []; page.on('request', (r) => { if (r.url().includes('/api/market/rsi')) seen.push(`${r.method()} auth=${(r.headers()['authorization'] || 'none').split(' ')[0]} cookie=${(r.headers()['cookie'] || '').includes('lhq_gate') ? 'lhq_gate' : 'no-gate-cookie'}`); });
  await page.goto('/api/version', { waitUntil: 'domcontentloaded', timeout: 90_000 });
  const res = await page.evaluate(async () => {
    const one = async (init: RequestInit) => { try { const r = await fetch('/api/market/rsi', init); const t = await r.text(); return `${r.status} ${t.slice(0, 70)}`; } catch (e) { return `error ${String(e).slice(0, 60)}`; } };
    return { defaultCreds: await one({}), omit: await one({ credentials: 'omit' }), omitNoCache: await one({ credentials: 'omit', cache: 'no-store' }) };
  });
  console.log(`[RSIGATE] page fetch, default credentials: ${res.defaultCreds} | credentials omit: ${res.omit} | omit no-store: ${res.omitNoCache}`);
  console.log(`[RSIGATE] requests seen by the browser: ${seen.join(' ; ')}`);
});
