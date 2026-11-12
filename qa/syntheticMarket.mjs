/* ONE synthetic, deterministic market-data generator for BOTH sides of the test rig (PM, 2026-11-12).
 *
 * WHY SHARED. The server side (`qa/server-intercept.mjs`) stubs the Node `fetch` the route handlers
 * make; the browser side (`qa/e2e/_fixtures.ts`) stubs the `page.route` venue calls AND the price
 * WebSocket. If each invented its own data they would drift, and a spec could pass on the server's
 * numbers while the browser showed something else. One module keeps them identical.
 *
 * DETERMINISTIC ON PURPOSE: no Math.random anywhere. Every value is a function of the symbol and a
 * timestamp, so two calls of the same request are byte-identical and a flake cannot hide here.
 * Timestamps snap to the interval boundary, so a smaller `limit` is a true suffix of a larger one
 * (which is also how a real exchange behaves - the newest closed candle is the boundary, not the
 * wall clock). Prices are plausible per symbol, majors pinned and unknowns hashed, and a venue
 * count-prefix (1000PEPE, 10000SATS) scales the price to the order of magnitude that contract trades
 * at. Zero network egress on either side. */

export const IV_MS = {
  '1m': 60000, '3m': 180000, '5m': 300000, '15m': 900000, '30m': 1800000, '1h': 3600000, '2h': 7200000, '4h': 14400000, '6h': 21600000, '12h': 43200000, '1d': 86400000, '1w': 604800000,
  '1': 60000, '3': 180000, '5': 300000, '15': 900000, '30': 1800000, '60': 3600000, '120': 7200000, '240': 14400000, '360': 21600000, '720': 43200000, 'D': 86400000, 'W': 604800000,
};
const KNOWN_PX = { BTC: 69000, ETH: 3500, SOL: 170, BNB: 600, XRP: 0.62, DOGE: 0.16, ADA: 0.45, AVAX: 35, LINK: 18, TON: 6.5, TRX: 0.13, DOT: 7, MATIC: 0.72, LTC: 90, BCH: 440, NEAR: 7, APT: 11, ARB: 1.1, OP: 2.3, SUI: 1.4, XAUT: 3900, CYBER: 6, PEPE: 0.0000082, BONK: 0.000022, SATS: 0.00000045, SHIB: 0.000024 };

const hashNum = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0) / 4294967295; };

/** Plausible price for a symbol: majors pinned, unknowns hashed, a 1000x contract scaled up. */
export const basePrice = (symRaw) => {
  let core = String(symRaw || 'BTCUSDT').toUpperCase().replace(/[-_]/g, '').replace(/(USDT|USDC|USD|PERP)$/, '');
  let prefix = 1;
  const m = core.match(/^(\d{3,})(.+)$/);
  if (m) { prefix = Number(m[1]); core = m[2]; }
  const unit = KNOWN_PX[core] ?? (0.01 + hashNum(core) * 200);
  return unit * prefix;
};

/** One deterministic candle: a smooth, bounded wobble around `base`, keyed on the bar time. */
const candleAt = (base, t, iv) => {
  const phase = t / iv;
  const drift = Math.sin(phase / 29) * 0.03 + Math.cos(phase / 11) * 0.015;
  const o = base * (1 + drift);
  const c = base * (1 + drift + Math.sin(phase / 5) * 0.004);
  const hi = Math.max(o, c) * 1.0025, lo = Math.min(o, c) * 0.9975;
  const vol = 500 + (Math.abs(Math.sin(phase / 7)) * 4500);
  return { o, c, hi, lo, vol };
};

const f = (n) => n.toPrecision(10);

/** The REST body a venue would return for this URL, in that venue's shape, or null for an endpoint
 *  we do not synthesize (the caller then serves its own empty-array fallback). */
export const synthUpstream = (url) => {
  let u; try { u = new URL(url); } catch { return null; }
  const p = u.pathname, q = u.searchParams;
  const sym = q.get('symbol') || 'BTCUSDT';
  const base = basePrice(sym);
  const nowMs = Date.now();
  const limit = Math.max(1, Math.min(1500, Number(q.get('limit') || 200)));
  const ivKey = q.get('interval') || '1h';
  const iv = IV_MS[ivKey] || 3600000;
  const endMs = Number(q.get('end') || q.get('endTime')) || (Math.floor(nowMs / iv) * iv);
  const startBound = Number(q.get('start') || q.get('startTime')) || null;
  const bars = [];
  for (let i = limit - 1; i >= 0; i--) {
    const t = endMs - i * iv;
    if (startBound !== null && t < startBound) continue;
    bars.push({ t, ...candleAt(base, t, iv) });
  }
  if (/\/klines$/.test(p)) {
    return JSON.stringify(bars.map(b => [b.t, f(b.o), f(b.hi), f(b.lo), f(b.c), f(b.vol), b.t + iv - 1, f(b.vol * b.c), 100, f(b.vol / 2), f(b.vol * b.c / 2), '0']));
  }
  if (/\/v5\/market\/kline$/.test(p)) {
    const list = bars.slice().reverse().map(b => [String(b.t), f(b.o), f(b.hi), f(b.lo), f(b.c), f(b.vol), f(b.vol * b.c)]);
    return JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: q.get('category') || 'linear', symbol: sym, list } });
  }
  if (/\/ticker\/24hr$/.test(p)) {
    const one = (s) => { const bp = basePrice(s); return { symbol: s, lastPrice: bp.toPrecision(10), priceChangePercent: (Math.sin(hashNum(s) * 6) * 5).toFixed(2), quoteVolume: (bp * 1e6).toPrecision(10), openPrice: (bp * 0.99).toPrecision(10), highPrice: (bp * 1.02).toPrecision(10), lowPrice: (bp * 0.98).toPrecision(10), volume: '1000000' }; };
    return JSON.stringify(sym && q.get('symbol') ? one(sym) : [one('BTCUSDT'), one('ETHUSDT')]);
  }
  if (/\/v5\/market\/tickers$/.test(p)) {
    return JSON.stringify({ retCode: 0, retMsg: 'OK', result: { category: q.get('category') || 'linear', list: [{ symbol: sym, lastPrice: base.toPrecision(10), price24hPcnt: (Math.sin(hashNum(sym) * 6) * 0.05).toFixed(4), turnover24h: (base * 1e6).toPrecision(10), volume24h: '1000000', openInterest: '500000', fundingRate: '0.0001' }] } });
  }
  if (/openInterestHist$/.test(p)) {
    return JSON.stringify(bars.map(b => ({ symbol: sym, sumOpenInterest: (b.vol * 100).toPrecision(10), sumOpenInterestValue: (b.vol * 100 * b.c).toPrecision(10), timestamp: b.t })));
  }
  // Fear & Greed history (api.alternative.me/fng/?limit=N): `limit` daily readings, newest first,
  // in alternative.me's own shape. Deterministic 0-100 value keyed on the day.
  if (/\/fng\/?$/.test(p) || u.host === 'api.alternative.me') {
    const days = Math.max(1, Math.min(365, Number(q.get('limit') || 30)));
    const DAY = 86400000;
    const dayStart = Math.floor(nowMs / DAY) * DAY;
    const classify = (v) => v < 25 ? 'Extreme Fear' : v < 45 ? 'Fear' : v < 55 ? 'Neutral' : v < 75 ? 'Greed' : 'Extreme Greed';
    const data = [];
    for (let i = 0; i < days; i++) {
      const t = dayStart - i * DAY;
      const v = Math.round(50 + Math.sin(t / DAY / 9) * 35); // 15..85, smooth
      data.push({ value: String(v), value_classification: classify(v), timestamp: String(Math.floor(t / 1000)), time_until_update: '3600' });
    }
    return JSON.stringify({ name: 'Fear and Greed Index', data, metadata: { error: null } });
  }
  return null;
};

/** The `data` payload of a Binance combined-stream `@ticker` frame for one symbol, keyed on `now`
 *  so successive frames move. The app reads `d.s / d.c / d.P / d.h / d.l` (MarketProvider onmessage). */
export const synthTickerData = (symUpper, nowMs = Date.now()) => {
  const base = basePrice(symUpper);
  const c = candleAt(base, nowMs, 60000);
  return {
    e: '24hrTicker', E: nowMs, s: symUpper,
    c: c.c.toPrecision(10),
    P: (Math.sin(hashNum(symUpper) * 6) * 5).toFixed(2),
    h: c.hi.toPrecision(10),
    l: c.lo.toPrecision(10),
    o: c.o.toPrecision(10),
    v: '1000000', q: (c.vol * c.c).toPrecision(10),
  };
};

/** A full combined-stream frame string: `{"stream":"btcusdt@ticker","data":{...}}`. */
export const synthCombinedFrame = (symUpper, nowMs = Date.now()) =>
  JSON.stringify({ stream: `${symUpper.toLowerCase()}@ticker`, data: synthTickerData(symUpper, nowMs) });
