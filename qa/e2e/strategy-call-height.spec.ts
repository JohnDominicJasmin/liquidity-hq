/* HOW TALL IS THE STRATEGY CALL'S CHANGING PART? (#2358: `.strat-call-dyn` reserves a fixed min-height; Dev asked for the real tallest value.)
 * A MEASUREMENT, NOT A GATE except for the last cell. For every strategy and for the widths 1280 and 390 (and 768) it prints:
 *   - the dyn section's reserved height as built (loading / the real call the stand-in market gives: normally WAIT);
 *   - the TALLEST POSSIBLE call: every reason text the strategy can show (buy, sell, wait and the alternates its file names) with the verdict line, the invalidation line and the liquidity note, laid out inside a clone of the REAL
 *     dyn section (same width, same fonts, same gaps), at the widths above. The label texts come from the build's own /api/labels (English); the price placeholders are filled with a long price.
 * The last cell fails when the tallest possible call is taller than what the build reserves (the call arriving could still push the panels below it). Signed in as fixture A, settings stubbed (nothing written). */
import { test, expect, type Browser } from '@playwright/test';
import { readFileSync, readdirSync } from 'node:fs';
import { AUTH_READY, AUTH_SKIP_REASON, signedInContext, gotoSignedIn } from './_auth';
import { installPaidAiFence } from './_no-paid-ai';

const FILES: Record<string, string> = { liq_sweep_mss: 'liquiditySweepMss', ny_open_breakout: 'nyOpenBreakout', ema_stack: 'emaStack', supply_demand: 'supplyDemand', bb_squeeze: 'bollingerSqueeze', vwap_reclaim: 'vwapReclaim', rsi_divergence: 'rsiDivergence' };
const keysOf = (file: string) => { const src = readFileSync(`lib/strategies/${file}.ts`, 'utf8'); return [...new Set([...src.matchAll(/'(STRAT_[A-Z0-9_]+)'/g)].map(m => m[1]))].filter(k => !/_NAME$|_DESC$/.test(k)); };
void readdirSync;

async function open(browser: Browser, width: number, saved: string, loc = 'en') {
  const ctx = await signedInContext(browser, 'a');
  await ctx.addInitScript((l) => { (window as unknown as { __loc?: string }).__loc = l; try { localStorage.setItem('lhq_lang_v1', (window as unknown as { __loc?: string }).__loc ?? 'en'); localStorage.setItem('theme', 'dark'); localStorage.setItem('lhq_analytics_consent_v1', 'denied'); } catch { /* private */ } }, loc);
  const page = await ctx.newPage(); await page.setViewportSize({ width, height: width < 500 ? 844 : 900 }); await installPaidAiFence(page);
  await page.route(/\/api\/settings(\?|$)/, async route => { const r = route.request(); if (r.method() === 'GET') return route.fallback(); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ accepted: Object.keys((r.postDataJSON() ?? {}) as object).filter(k => k !== 'knownAsOf'), rejected: [], settings: null }) }); });
  await page.route(/\/rest\/v1\/lhq_(dev_)?user_settings\?/, async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    const res = await route.fetch(); const body = await res.json().catch(() => null); if (body == null) return route.fulfill({ response: res });
    const patch = (r: Record<string, unknown>) => ({ ...r, arena_sound: false, arena_strategy: saved, strategy_selection: [], language: loc });
    return route.fulfill({ response: res, json: Array.isArray(body) ? body.map(patch) : patch(body as Record<string, unknown>) });
  });
  await gotoSignedIn(page, '/arena?coin=eth&tf=1h'); await page.waitForTimeout(12_000);
  return { ctx, page };
}

test.describe('strategy call: the changing part\'s height', () => {
  test.skip(!AUTH_READY, AUTH_SKIP_REASON);
  /* NO RETRIES: the gate cell reads measurements the other cells made in THIS worker; a retry runs it in a fresh worker with none and would pass without measuring anything. */
  test.describe.configure({ timeout: 170_000, retries: 0 });
  const worst: Record<string, { max: number; reserved: number; who: string }> = {};
  /* the four languages at the three main widths; the edges of each band (1180, 1100, 1099, 641) in en and ru, the languages that bound the others */
  const plan: Array<[string, number]> = ['en', 'ru', 'ko', 'zh'].flatMap(l => [1280, 768, 390].map(w => [l, w] as [string, number]));
  for (const l of ['en', 'ru']) for (const w of [1100, 1000, 981, 980, 960, 641]) plan.push([l, w]);
  for (const [loc, width] of plan) test(`dyn section heights at ${width} (${loc})`, async ({ browser, request }) => {
    /* the English defaults shipped in the build, overridden by the rows /api/labels serves; a key found in neither makes the cell fail below, never pass on an empty measurement */
    const shipped = loc === 'en' ? (JSON.parse(readFileSync('lib/labelDefaults.en.json', 'utf8')) as Record<string, string>) : {};
    const served = (await (await request.get(`/api/labels?locale=${loc}`)).json().catch(() => ({}))) as Record<string, string>;
    const labels: Record<string, string> = { ...shipped, ...served };
    const fill = (s: string) => s.replace(/\{[a-zA-Z0-9_]+\}/g, '1,234,567.89'); /* a 7-digit price with decimals: the longest a price line can be */
    const { ctx, page } = await open(browser, width, 'ema_stack', loc);
    try {
      await expect(page.getByTestId('strategy-call-box')).toBeVisible({ timeout: 30_000 });
      const out: Record<string, { real: number; worst: number; worstKey: string }> = {};
      for (const [id, file] of Object.entries(FILES)) {
        await page.getByTestId('strategy-set-select').selectOption(id); await page.waitForTimeout(5_000);
        const texts = keysOf(file).map(k => ({ k, t: fill(labels[k] ?? '') })).filter(x => x.t);
        const inv = fill(labels.STRAT_INVALIDATION ?? ''); const liq = fill(labels.STRAT_LIQ_NOTE ?? '');
        const r = await page.evaluate(([cands, invText, liqText]) => {
          const dyn = document.querySelector('.strat-call-dyn') as HTMLElement; const real = Math.round(dyn.getBoundingClientRect().height);
          const reasonEl = dyn.querySelector('[data-testid="strategy-call-reason"]') as HTMLElement | null; const verdict = dyn.querySelector('[data-testid="strategy-call-verdict"]') as HTMLElement | null;
          const clone = dyn.cloneNode(false) as HTMLElement; clone.style.minHeight = '0'; clone.style.height = 'auto'; clone.style.visibility = 'hidden'; clone.style.position = 'absolute'; clone.style.width = dyn.getBoundingClientRect().width + 'px'; dyn.parentElement!.appendChild(clone);
          let worst = 0, worstKey = '';
          for (const c of cands as Array<{ k: string; t: string }>) {
            clone.innerHTML = '';
            if (verdict) clone.appendChild(verdict.cloneNode(true));
            const p = document.createElement('p'); p.setAttribute('style', reasonEl ? (reasonEl.getAttribute('style') ?? '') : 'margin:0'); p.textContent = c.t; clone.appendChild(p);
            for (const extra of [invText, liqText]) { const q = document.createElement('p'); q.setAttribute('style', 'margin:0;font-size:var(--fs-caption)'); q.textContent = extra; clone.appendChild(q); }
            const h = Math.round(clone.getBoundingClientRect().height); if (h > worst) { worst = h; worstKey = c.k; }
          }
          clone.remove(); return { real, worst, worstKey };
        }, [texts, inv, liq] as const);
        expect(texts.length, `${id}: no label text was found for its reason keys: the measurement would be empty`).toBeGreaterThan(0); expect(r.worst, `${id}: the tallest-call measurement is 0`).toBeGreaterThan(0);
        out[id] = r;
      }
      console.log(`[CALLH] ${loc} ${width} ${JSON.stringify(out)}`);
      const max = Math.max(...Object.values(out).map(v => v.worst)); const reserved = Math.min(...Object.values(out).map(v => v.real));
      const who = Object.entries(out).sort((a, b) => b[1].worst - a[1].worst)[0];
      worst[`${loc}${width}`] = { max, reserved, who: `${who[0]}:${who[1].worstKey}` };
      console.log(`[CALLH] ${loc} ${width} TALLEST POSSIBLE ${max}px (${worst[`${loc}${width}`].who}); smallest real dyn height ${reserved}px`);
    } finally { await ctx.close(); }
  });
  test('the reserve covers the tallest possible call at every width (fails if the call arriving could still push the panels below)', async () => {
    expect(Object.keys(worst).length, 'no measurement was made in this worker: the gate would pass on nothing').toBeGreaterThan(0);
    for (const w of plan.map(([l, x]) => `${l}${x}`)) { const x = worst[w]; if (!x) continue; expect(x.reserved, `${w}: the dyn section reserves ${x.reserved}px but the tallest possible call needs ${x.max}px (${x.who})`).toBeGreaterThanOrEqual(x.max - 2); }
  });
});
