/* PROBE (not a gate): what the DEV fixtures' saved settings row holds for the layer defaults (strategy_selection, anti_chop_enabled, strategy_params, arena_strategy, language). */
import { test } from '@playwright/test';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
test.skip(!AUTH_READY, AUTH_SKIP_REASON);
for (const who of ['a', 'b'] as const) test(`PROBE settings row ${who}`, async ({ browser }) => {
  test.setTimeout(90_000); const ctx = await signedInContext(browser, who); const page = await ctx.newPage();
  page.on('response', async (r) => { try { if (!/user_settings/.test(r.url()) || r.request().method() !== 'GET') return; const b = await r.json().catch(() => null); const row = (Array.isArray(b) ? b[0] : b) as Record<string, unknown> | null; console.log(`[ROWPROBE] ${who} status ${r.status()} ${JSON.stringify(row ? { strategy_selection: row.strategy_selection, anti_chop_enabled: row.anti_chop_enabled, strategy_params: row.strategy_params, arena_strategy: row.arena_strategy, language: row.language, updated_at: row.updated_at } : null)}`); } catch { /* none */ } });
  try { await gotoSignedIn(page, '/arena'); await page.waitForTimeout(12_000); } finally { await ctx.close(); }
});
