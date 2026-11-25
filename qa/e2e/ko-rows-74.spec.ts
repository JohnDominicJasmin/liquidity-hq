/* QA for #2843 / #74 on a deployed site: what /api/labels serves for the new Korean rows, what the pages draw, and the RSI coverage again. GETs only. Prints [K] lines. */
import { test } from '@playwright/test';
import { installPaidAiFence } from './_no-paid-ai';

test.skip(!process.env.E2E_BASE_URL, 'dispatch-only: reads a deployed site (-f base_url=<site>)');
const KEYS = ['ARENA_LIVE_BADGE', 'ARENA_PAGE_SUBTITLE', 'BTC_RISK_LEVEL_BAR_LOW', 'DASH_PULSE_VOL_LABEL', 'GLOBAL_MACRO_CONTEXT_PREPARING', 'LEARN_CONTENT_RESULTS_COUNT', 'LIQ_HEATMAP_ESTIMATED_TAG', 'SETUP_SCANNER_TAKER_VAL', 'WHALE_TRADES_FEED_BADGE_WHALE'];
test('K labels and pages in Korean, and RSI coins', async ({ browser, request }) => {
  test.setTimeout(420_000);
  const v = await (await request.get('/api/version', { timeout: 150_000 })).json() as { commit: string };
  const l = await (await request.get('/api/labels?locale=ko', { timeout: 120_000 })).json() as Record<string, unknown>;
  const map = ((l.labels ?? l.data ?? l) as Record<string, string>);
  console.log(`[K] ${new Date().toISOString()} ${v.commit} served: ${KEYS.map((k) => `${k}=${/[가-힣]/.test(map[k] ?? '') ? 'ko' : JSON.stringify(map[k] ?? null)}`).join(' ')}`);
  const r = await (await request.get('/api/market/rsi', { timeout: 120_000 })).json() as { rsi?: Record<string, unknown>; stale?: boolean };
  console.log(`[K] rsi coins=${Object.keys(r.rsi ?? {}).length} missing=${['xau', 'pepe', 'bonk', 'hype', 'spx'].filter((c) => !r.rsi?.[c]).join(',') || 'none'} stale=${!!r.stale}`);
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  await ctx.addInitScript(() => { try { localStorage.setItem('lhq_lang_v1', 'ko'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } });
  const page = await ctx.newPage();
  try {
    await installPaidAiFence(page);
    for (const [path, sel] of [['/learn', '.gl-count'], ['/dashboard', 'main'], ['/arena', 'main']] as const) {
      await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 150_000 }); await page.waitForTimeout(20_000);
      const t = (await page.locator(sel).first().innerText({ timeout: 10_000 }).catch(() => '')).replace(/\s+/g, ' ');
      console.log(`[K] ${path}: ${path === '/learn' ? JSON.stringify(t) : `거래량=${t.includes('거래량')} volWords=${JSON.stringify(t.match(/.{0,25}(Volume|Vol\b|거래량).{0,25}/g)?.slice(0, 4) ?? null)} badge=${t.includes('실시간')} liveEnglish=${/LIVE · web/i.test(t)}`}`);
    }
  } finally { await ctx.close().catch(() => {}); }
});
