/* PROBE (QA, 2026-11-20): do the Binance-only listings (HK0700, ANTHROPIC, XPT) get candles from this server? Dev: prod answers 200 for source=binance-futures; the chart on qa showed 0 candles. GETs of the public klines route from the runner (the gate's credentials ride on the request context), status + body start, 3 requests each so a refusal that comes and goes shows. Read-only, no AI route, nothing written. */
import { test } from '@playwright/test';

const SYMBOLS = ['HK0700USDT', 'ANTHROPICUSDT', 'XPTUSDT', 'BTCUSDT'];
for (const sym of SYMBOLS) {
  test(`klines binance-futures ${sym}`, async ({ request }) => {
    test.setTimeout(90_000); const out: string[] = [];
    for (let i = 0; i < 3; i++) { const r = await request.get(`/api/market/klines?source=binance-futures&symbol=${sym}&interval=1h&limit=3`).catch(() => null); out.push(r ? `${r.status()} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 130)}` : 'no response'); await new Promise((res) => setTimeout(res, 1_500)); }
    console.log(`[KLTOK] ${sym}: ${out.join(' || ')}`);
  });
}
test('klines default order (no source) HK0700USDT and the Bybit spelling', async ({ request }) => {
  test.setTimeout(90_000); const out: string[] = [];
  for (const u of ['/api/market/klines?symbol=HK0700USDT&interval=1h&limit=3', '/api/market/klines?source=bybit&symbol=HK0700USDT&interval=60&limit=3', '/api/market/klines?source=binance&symbol=HK0700USDT&interval=1h&limit=3']) { const r = await request.get(u).catch(() => null); out.push(`${u.split('?')[1].slice(0, 50)} -> ${r ? `${r.status()} ${(await r.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 110)}` : 'no response'}`); }
  console.log(`[KLTOK] other routes: ${out.join(' || ')}`);
});
