/* QA for #95: which coins /api/market/rsi answers on a deployed site. One GET, signed out. Prints a [R95] line. */
import { test } from '@playwright/test';
import { COINS } from '../../lib/coins';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
test('R95 coins missing from the RSI answer', async ({ request }) => {
  test.setTimeout(240_000);
  const r = await request.get('/api/market/rsi', { timeout: 200_000 });
  const j = await r.json() as { rsi?: Record<string, Record<string, number>>; viaFallback?: string[]; stale?: boolean };
  const have = Object.keys(j.rsi ?? {});
  const v = await (await request.get('/api/version')).json() as { commit: string };
  console.log(`[R95] ${new Date().toISOString()} ${v.commit} status=${r.status()} listed=${COINS.length} answered=${have.length} missing=${COINS.filter((c) => !have.includes(c)).join(',') || 'none'} viaFallback=${(j.viaFallback ?? []).join(',') || 'none'} stale=${!!j.stale}`);
  console.log(`[R95] partial rows (fewer than 5 timeframes): ${have.filter((c) => Object.keys(j.rsi![c]).length < 5).map((c) => `${c}:${Object.keys(j.rsi![c]).join('/')}`).join(' ') || 'none'}`);
});
