/* #1626 C / #1647 acceptance (owner: "Standard RSI"; PM: 5 coins x 1h, 4h, 1D, 1W within 0.5): qa's /api/market/rsi against an INDEPENDENT Wilder
 * RSI(14) computed here from Binance spot candles (the route's primary source), using ALL of the last 1000 closed candles (TradingView-like full history).
 * The route caches its slow group up to 15 minutes, so each value is compared with the oracle on the candles closed NOW and on those closed one candle
 * earlier; the closer one is reported, and which. usage: node rsi-live-check.mjs [coins csv=btc,eth,sol,xrp,doge] */
import { writeFileSync, mkdirSync } from 'node:fs';
/* Evidence root: QA_ROOT, else ../qa-evidence beside the checkout. It was an absolute C:/Users path (#1690). */
const EVIDENCE = process.env.QA_ROOT || new URL('../../../../qa-evidence', import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1');
const BASE = process.env.QA_BASE || 'https://liquidity-hq-qa.onrender.com';
const OUT = `${EVIDENCE}/rsi`; mkdirSync(OUT, { recursive: true }); // ROOT comes from rlib: QA_ROOT, else ../qa-evidence beside the checkout (#1690)
const coins = (process.argv[2] || 'btc,eth,sol,xrp,doge').split(',');
const TF = [['rsi1h', '1h'], ['rsi4h', '4h'], ['rsiDaily', '1d'], ['rsiWeekly', '1w']];
function wilder(closes) {
  if (closes.length < 15) return null;
  const ch = closes.slice(1).map((v, i) => v - closes[i]); let g = 0, l = 0;
  for (let i = 0; i < 14; i++) { g += Math.max(ch[i], 0); l += Math.max(-ch[i], 0); } g /= 14; l /= 14;
  for (let i = 14; i < ch.length; i++) { g = (g * 13 + Math.max(ch[i], 0)) / 14; l = (l * 13 + Math.max(-ch[i], 0)) / 14; }
  return l === 0 ? 100 : 100 - 100 / (1 + g / l);
}
const version = await (await fetch(BASE + '/api/version')).json();
const t0 = new Date().toISOString();
const route = await (await fetch(BASE + '/api/market/rsi')).json();
const rows = [];
for (const coin of coins) {
  const sym = `${coin.toUpperCase()}USDT`;
  for (const [field, iv] of TF) {
    const k = await (await fetch(`https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${iv}&limit=1000`)).json();
    const now = Date.now(); const closed = k.filter((r) => Number(r[6]) < now).map((r) => Number(r[4]));
    const oNow = wilder(closed); const oPrev = wilder(closed.slice(0, -1));
    const app = route?.rsi?.[coin]?.[field];
    const dNow = app == null || oNow == null ? null : Math.abs(app - oNow); const dPrev = app == null || oPrev == null ? null : Math.abs(app - oPrev);
    const best = dNow == null ? null : (dPrev != null && dPrev < dNow ? { against: 'one candle earlier', diff: dPrev } : { against: 'closed now', diff: dNow });
    rows.push({ coin, tf: iv, app, oracleNow: oNow, oraclePrev: oPrev, closedCandles: closed.length, best, PASS: best ? best.diff <= 0.5 : false });
  }
}
const summary = { build: version.commit, at: t0, routeTs: route?.ts ? new Date(route.ts).toISOString() : null, viaFallback: route?.viaFallback ?? [], pass: rows.filter((r) => r.PASS).length, total: rows.length };
writeFileSync(`${OUT}/rsi-live-${t0.replace(/[:.]/g, '-')}.json`, JSON.stringify({ summary, rows }, null, 1));
console.log(JSON.stringify(summary));
for (const r of rows) console.log(`${r.coin.padEnd(5)} ${r.tf.padEnd(3)} app=${r.app == null ? 'null' : r.app.toFixed(2)} oracle(now)=${r.oracleNow?.toFixed(2)} oracle(prev)=${r.oraclePrev?.toFixed(2)} -> ${r.best ? `${r.best.diff.toFixed(2)} vs ${r.best.against}` : 'n/a'} ${r.PASS ? 'PASS' : 'FAIL'}`);
