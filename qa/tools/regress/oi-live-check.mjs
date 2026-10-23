/* The live half of #1686 / #1696 / #1705, on a deployed environment, because exchange-sourced evidence cannot come from a container.
 *
 * Three claims, each read off the screen and recomputed from the venue in the same minute:
 *  1. The ARENA card's "OI % 1h" is Binance's openInterestHist over a real hour (oiHistChange + the elapsed-time bound, #1705).
 *  2. The DASHBOARD's Distribution Tracker OI trend is BYBIT's, through bootstrapReadings + trendBetween (#1696's "one source").
 *  3. The two therefore answer the same question from their stated sources, and neither invents a trend when the data will not support one.
 *
 * NO AI spend, no writes: rlib answers every AI request locally and refuses Supabase writes. One short headless Chromium.
 * usage: node oi-live-check.mjs [coin=btc]
 */
import { chromium, open, quiet, sleep, BASE, ROOT, assertMarketDataReached, marketDataOutcome } from './rlib.mjs';
import { mkdirSync, writeFileSync } from 'node:fs';

const coin = (process.argv[2] || 'btc').toLowerCase();
const BIN = { btc: 'BTCUSDT', eth: 'ETHUSDT', sol: 'SOLUSDT', xrp: 'XRPUSDT' }[coin] ?? 'BTCUSDT';
const BYB = BIN;
const DIR = `${ROOT}/oi-live`; mkdirSync(DIR, { recursive: true });
const out = [];
const say = (o) => { out.push(o); console.log(JSON.stringify(o)); };

/* The rule, written from #1617's statement rather than imported from the code under test: OI and price between the same two moments,
   both floors required, and the window must really be an hour. */
const OI_MIN = 0.3, PX_MIN = 0.2;
const label = (oiPct, pxPct) => {
  if (oiPct === null || pxPct === null) return null;
  if (Math.abs(oiPct) < OI_MIN || Math.abs(pxPct) < PX_MIN) return null;
  if (oiPct > 0) return pxPct > 0 ? 'strong_up' : 'strong_down';
  return pxPct > 0 ? 'weak_up' : 'weak_down';
};

const j = async (url) => { const r = await fetch(url, { cache: 'no-store' }); if (!r.ok) throw new Error(`${r.status} ${url}`); return r.json(); };

/** Binance: the card's source. 13 five-minute points, first vs last, price implied by value / contracts. */
async function binanceHour() {
  const d = await j(`https://fapi.binance.com/futures/data/openInterestHist?symbol=${BIN}&period=5m&limit=13`);
  if (!Array.isArray(d) || d.length < 2) return { error: 'fewer than two samples' };
  const f = d[0], l = d[d.length - 1];
  const num = (v) => { const n = parseFloat(String(v)); return Number.isFinite(n) ? n : null; };
  const price = (s) => { const c = num(s.sumOpenInterest), v = num(s.sumOpenInterestValue); return c && v && c > 0 && v > 0 ? v / c : null; };
  const pct = (a, b) => (a !== null && b !== null && a > 0 ? (b - a) / a * 100 : null);
  const spanMin = (num(l.timestamp) - num(f.timestamp)) / 60000;
  const oiPct = pct(num(f.sumOpenInterest), num(l.sumOpenInterest));
  const pxPct = pct(price(f), price(l));
  return { samples: d.length, spanMin, oiPct, pxPct, label: label(oiPct, pxPct), hourHonest: Math.abs(spanMin - 60) <= 5 };
}

/** Bybit: the dashboard's and the alert's source since #1696. OI points paired with the open of the 5-minute candle at each moment. */
async function bybitHour() {
  const [oi, kl] = await Promise.all([
    j(`https://api.bybit.com/v5/market/open-interest?category=linear&symbol=${BYB}&intervalTime=5min&limit=13`),
    j(`https://api.bybit.com/v5/market/kline?category=linear&symbol=${BYB}&interval=5&limit=20`),
  ]);
  const pts = oi?.result?.list ?? [];
  const bars = kl?.result?.list ?? [];
  if (pts.length < 2) return { error: 'fewer than two OI points' };
  const t1 = Number(pts[0].timestamp), oi1 = Number(pts[0].openInterest);
  const older = pts.slice(1).find((p) => Math.abs(t1 - Number(p.timestamp) - 3_600_000) <= 60_000);
  if (!older) return { error: 'no OI point exactly one hour before the newest (within a minute)' };
  const t0 = Number(older.timestamp), oi0 = Number(older.openInterest);
  const openAt = (t) => { const b = bars.find((c) => Math.abs(Number(c[0]) - t) < 1000); const p = b ? Number(b[1]) : NaN; return Number.isFinite(p) && p > 0 ? p : null; };
  const p1 = openAt(t1), p0 = openAt(t0);
  const pct = (a, b) => (a && b && a > 0 ? (b - a) / a * 100 : null);
  const oiPct = pct(oi0, oi1), pxPct = pct(p0, p1);
  return { spanMin: (t1 - t0) / 60000, oiPct, pxPct, label: label(oiPct, pxPct), pairedWithKlineOpens: p0 !== null && p1 !== null };
}

const browser = await chromium.launch();
try {
  const build = (await j(BASE + '/api/version')).commit;
  const ctx = await open(browser, { acct: 'A', w: 1280 });
  const page = await ctx.newPage();
  const inflight = new Map();
  page.on('request', (r) => inflight.set(r, Date.now()));
  page.on('requestfinished', (r) => inflight.delete(r));
  page.on('requestfailed', (r) => inflight.delete(r));

  /* 1. the Arena card */
  await page.goto(`${BASE}/arena?coin=${coin}&tf=1h`, { waitUntil: 'load', timeout: 90_000 });
  await quiet(page, inflight, 2500, 40_000); await sleep(4000);
  assertMarketDataReached(ctx, 'oi-live arena');
  const arena = await page.evaluate(() => {
    const blocks = Array.from(document.querySelectorAll('div,section')).filter((e) => /open interest/i.test(e.innerText || '') && (e.innerText || '').length < 600);
    const card = blocks.sort((a, b) => (a.innerText.length - b.innerText.length))[0];
    return card ? card.innerText.replace(/\n+/g, ' | ').slice(0, 400) : null;
  });
  await page.screenshot({ path: `${DIR}/arena-oi-${coin}.jpg`, type: 'jpeg', quality: 70 });

  /* 2. the dashboard tracker */
  await page.goto(`${BASE}/dashboard`, { waitUntil: 'load', timeout: 90_000 });
  await quiet(page, inflight, 2500, 40_000); await sleep(5000);
  const dash = await page.evaluate(() => {
    const t = Array.from(document.querySelectorAll('div,section')).filter((e) => /distribution/i.test(e.innerText || '') && (e.innerText || '').length < 900);
    const card = t.sort((a, b) => a.innerText.length - b.innerText.length)[0];
    return card ? card.innerText.replace(/\n+/g, ' | ').slice(0, 500) : null;
  });
  await page.screenshot({ path: `${DIR}/dashboard-dist-${coin}.jpg`, type: 'jpeg', quality: 70 });

  const [bin, byb] = await Promise.all([binanceHour().catch((e) => ({ error: String(e).slice(0, 120) })), bybitHour().catch((e) => ({ error: String(e).slice(0, 120) }))]);
  say({ build, coin, at: new Date().toISOString(), market: marketDataOutcome(ctx).ok });
  say({ screen: 'arena OI card', text: arena });
  say({ screen: 'dashboard distribution', text: dash });
  say({ venue: 'binance (the card\'s source)', ...bin });
  say({ venue: 'bybit (the dashboard\'s and alert\'s source, #1696)', ...byb });
  writeFileSync(`${DIR}/oi-live-${coin}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(out, null, 1));
  await ctx.close();
} finally { await browser.close(); }
