/* #1185 TICK CELLS, part F (signed out, throw-away): the two Open Interest cards on the Dashboard (box 213) and the landing card's OI rows (box 230), with the hourly OI read answered in the browser by four
 * synthetic scenarios (OI up/down x price up/down), so each of the four trend words is actually exercised. Read-only; the paid-AI fence is on; nothing is written. */
import { test, expect } from '@playwright/test';
import { gotoGuarded } from './_shared';
import { signedOutContext, openPage } from './_v1185';

const T = (id: string, msg: string) => console.log(`[TICK] ${id} ${msg}`);
test.beforeEach(({}, testInfo) => { test.skip(testInfo.project.name === 'mobile', 'viewports are set per cell'); });

const SCEN: { id: string; oi: number; px: number; trend: RegExp; hour: RegExp; landing: RegExp; rising: boolean }[] = [
  { id: 'strong_up (OI +5%, price +2%)', oi: 0.05, px: 0.02, trend: /new buyers/i, hour: /new longs/i, landing: /strong up/i, rising: true },
  { id: 'strong_down (OI +5%, price -2%)', oi: 0.05, px: -0.02, trend: /new sellers/i, hour: /new shorts/i, landing: /strong down/i, rising: true },
  { id: 'weak_up (OI -3%, price +2%)', oi: -0.03, px: 0.02, trend: /short covering/i, hour: /short covering/i, landing: /weak up/i, rising: false },
  { id: 'weak_down (OI -3%, price -2%)', oi: -0.03, px: -0.02, trend: /long exits/i, hour: /long exits/i, landing: /weak down/i, rising: false },
];
function samples(oi: number, px: number) {
  const now = Date.now(); const P0 = 60000; const C0 = 1000; const out: Record<string, string | number>[] = [];
  for (let i = 0; i < 13; i++) { const f = i / 12; const c = C0 * (1 + oi * f); const p = P0 * (1 + px * f); out.push({ symbol: 'BTCUSDT', sumOpenInterest: String(c), sumOpenInterestValue: String(c * p), timestamp: now - (12 - i) * 300_000 }); }
  return out;
}

for (const s of SCEN) {
  test(`F1 Dashboard OI cards, ${s.id}: the trend card and the 1h card agree`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
    await page.route(/\/api\/proxy\?[^#]*type=oi-hist/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(samples(s.oi, s.px)) }));
    try {
      await gotoGuarded(page, '/dashboard');
      await page.waitForFunction(() => Array.from(document.querySelectorAll('.edge-card')).some((c) => /last hour|1h/i.test((c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText ?? '') && /\d%/.test((c.querySelector('.edge-card-value') as HTMLElement | null)?.innerText ?? '')), undefined, { timeout: 90_000 }).catch(() => T('F1', 'the OI 1h card never showed a figure'));
      await page.waitForTimeout(3_000);
      const cards = await page.evaluate(() => Array.from(document.querySelectorAll('.edge-card')).map((c) => ({ l: (c.querySelector('.edge-card-label') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ').trim() ?? '', v: (c.querySelector('.edge-card-value') as HTMLElement | null)?.innerText.trim() ?? '', s: (c.querySelector('.edge-card-signal') as HTMLElement | null)?.innerText.trim() ?? '' })).filter((c) => /open interest|oi/i.test(c.l)));
      T('F1', `${s.id}: ${JSON.stringify(cards)}`);
      const trend = cards.find((c) => !/hour|1h/i.test(c.l)); const hour = cards.find((c) => /hour|1h/i.test(c.l));
      expect.soft(hour?.v ?? '', 'CONTROL: the stubbed OI read did not reach the 1h card').toMatch(s.oi > 0 ? /^\+\d/ : /^-\d/);
      expect.soft(`${trend?.v} ${trend?.s}`, `trend card word for ${s.id}`).toMatch(s.trend);
      expect.soft(`${hour?.v} ${hour?.s}`, `1h card word for ${s.id}`).toMatch(s.hour);
    } finally { await ctx.close().catch(() => {}); }
  });
  test(`F2 Landing Live Read card, ${s.id}: "OI trend" and "OI 1h" agree`, async ({ browser }) => {
    test.setTimeout(150_000);
    const ctx = await signedOutContext(browser, { width: 1280 }); const page = await openPage(ctx);
    await page.route(/\/api\/proxy\?[^#]*type=oi-hist/, (r) => r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(samples(s.oi, s.px)) }));
    try {
      await gotoGuarded(page, '/');
      await page.waitForFunction(() => /OI\s*1h\s*[+-]\d/i.test((document.querySelector('.lp-read-panel') as HTMLElement | null)?.innerText.replace(/\s+/g, ' ') ?? ''), undefined, { timeout: 90_000 }).catch(() => T('F2', 'the OI 1h row never showed a figure'));
      await page.waitForTimeout(3_000);
      const rows = await page.evaluate(() => { const p = document.querySelector('.lp-read-panel') as HTMLElement | null; return p ? Array.from(p.querySelectorAll('div')).filter((d) => d.children.length >= 2 && Array.from(d.children).every((c) => c.tagName === 'SPAN')).map((d) => (d as HTMLElement).innerText.replace(/\s+/g, ' ').trim()).filter((t) => /^OI/i.test(t)) : []; });
      T('F2', `${s.id}: ${JSON.stringify(rows)}`);
      const trend = rows.find((r) => /^OI\s*trend/i.test(r)) ?? ''; const hour = rows.find((r) => /^OI\s*1h/i.test(r)) ?? '';
      expect.soft(hour, 'CONTROL: the stubbed OI read did not reach the OI 1h row').toMatch(s.oi > 0 ? /[+]\d/ : /-\d/);
      expect.soft(trend, `landing OI trend word for ${s.id}`).toMatch(s.landing);
      expect.soft(hour, `landing OI 1h note for ${s.id}`).toMatch(s.hour);
    } finally { await ctx.close().catch(() => {}); }
  });
}
