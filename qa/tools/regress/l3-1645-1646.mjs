/* L3 on qa for #1646 and #1645, HTTP only (no browser, no sign-in, reads only).
 *
 * headers (#1646): each of the 13 polled routes is fetched twice, 3 s apart. A 200 must carry exactly
 *   `public, max-age=0, must-revalidate, s-maxage=<n>` and never `stale-while-revalidate`.
 *   NOT covered here: the browser's second poll having transferSize > 0 (a DevTools / browser check), and HYPE staying within one poll of the chart.
 * klines (#1645): `/api/market/klines?source=binance&symbol=BTCUSDT&interval=1h&limit=100&closed=1` is read now, then again 40 s after the next
 *   hourly close, next to Binance's own klines. The candle that just closed must match Binance's FINAL candle field for field (open, high, low, close,
 *   volume), and the answer must already carry the new hour's candle (a fresh fetch after the close, not the entry cached before it).
 * usage: node l3-1645-1646.mjs [parts=headers,klines]  -> <ROOT>/_l3/l3-1645-1646-<time>.json                                                        */
import { writeFileSync, mkdirSync } from 'node:fs';
const BASE = process.env.QA_BASE || 'https://liquidity-hq-qa.onrender.com';
const OUT = `${process.env.QA_ROOT || 'C:/Users/Dominic/Documents/LiquidityHQ-QA-regression-2026-10-21'}/_l3`; mkdirSync(OUT, { recursive: true });
const parts = (process.argv[2] || 'headers,klines').split(',');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const now = () => new Date().toISOString();
const out = { started: now(), build: (await (await fetch(BASE + '/api/version')).json()).commit };
console.log('build', out.build, out.started);

if (parts.includes('headers')) {
  const ROUTES = [
    ['/api/forex/jpy', 300], ['/api/funding', 60], ['/api/cycle', 300], ['/api/econ-calendar', 3600], ['/api/cmc?type=global', 300], ['/api/macro', 300],
    ['/api/proxy?type=bybit-tickers', 300], ['/api/market/agg-trades?limit=200', 60], ['/api/market/funding-rate?limit=42', 900],
    ['/api/market/account-ratio?period=1h', 120], ['/api/market/open-interest?intervalTime=5min&limit=13', 120],
    ['/api/market/klines?source=binance&symbol=BTCUSDT&interval=4h&limit=100&closed=1', null], ['/api/market/snapshot', 60],
  ];
  out.headers = [];
  for (const [path, sMax] of ROUTES) {
    const reads = [];
    for (let i = 0; i < 2; i++) {
      const t0 = Date.now(); const r = await fetch(BASE + path); const body = await r.arrayBuffer();
      reads.push({ at: now(), status: r.status, cacheControl: r.headers.get('cache-control'), age: r.headers.get('age'), cf: r.headers.get('cf-cache-status'), bytes: body.byteLength, ms: Date.now() - t0 });
      if (i === 0) await sleep(3000);
    }
    const ok = reads.filter((x) => x.status === 200);
    const shape = /^public, max-age=0, must-revalidate, s-maxage=(\d+)$/;
    const pass = ok.length > 0 && ok.every((x) => shape.test(x.cacheControl || '') && !/stale-while-revalidate/.test(x.cacheControl || '') && (sMax == null || Number(shape.exec(x.cacheControl)[1]) === sMax));
    out.headers.push({ path, expectSMaxAge: sMax, pass: ok.length ? pass : null, reads });
    console.log(`${(ok.length ? (pass ? 'PASS' : 'FAIL') : 'NO-200').padEnd(6)} ${path.slice(0, 70).padEnd(70)} ${reads.map((x) => `${x.status} "${x.cacheControl}" ${x.bytes}B`).join(' | ')}`);
  }
}

if (parts.includes('klines')) {
  const Q = '/api/market/klines?source=binance&symbol=BTCUSDT&interval=1h&limit=100&closed=1';
  const H = 3_600_000;
  const read = async () => { const r = await fetch(BASE + Q); return { at: now(), status: r.status, rows: r.ok ? await r.json() : null }; };
  const pick = (rows, openMs) => rows?.find((k) => Number(k[0]) === openMs) ?? null;
  const before = await read();
  const closeAt = Math.ceil(Date.now() / H) * H; const closingOpen = closeAt - H;
  out.klines = { query: Q, closeAt: new Date(closeAt).toISOString(), before: { at: before.at, status: before.status, closing: pick(before.rows, closingOpen), last: before.rows?.at(-1) ?? null } };
  console.log('klines before', before.at, 'status', before.status, 'closing candle (partial):', JSON.stringify(out.klines.before.closing)?.slice(0, 120));
  const wait = closeAt + 40_000 - Date.now(); console.log(`waiting ${Math.round(wait / 1000)} s for the ${new Date(closeAt).toISOString().slice(11, 16)} UTC close + 40 s`);
  await sleep(Math.max(0, wait));
  const after = await read();
  const buildAfter = (await (await fetch(BASE + '/api/version')).json()).commit;
  const bin = await (await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1h&limit=3`)).json();
  const a = pick(after.rows, closingOpen); const b = pick(bin, closingOpen);
  const same = a && b && [1, 2, 3, 4, 5].every((i) => Number(a[i]) === Number(b[i]));
  const lastOpen = Number(after.rows?.at(-1)?.[0]);
  /* A deploy between the two reads restarts the server and empties its cache, so the second read is fresh whatever the cache key does: the
     check only discriminates on one uninterrupted process. A changed build is reported as INCONCLUSIVE (a same-build restart must be ruled out
     from Render's deploy list). */
  const sameBuild = buildAfter === out.build;
  out.klines.after = { at: after.at, status: after.status, buildAfter, sameBuild, closing: a, binanceFinal: b, lastOpen: new Date(lastOpen).toISOString(), matchesBinanceFinal: !!same, carriesNewHour: lastOpen === closeAt };
  out.klines.pass = !sameBuild ? 'INCONCLUSIVE' : !!same && lastOpen === closeAt;
  console.log(`klines after ${after.at} (build ${buildAfter}${sameBuild ? '' : ', CHANGED'}): closed candle ${same ? 'MATCHES' : 'DIFFERS FROM'} Binance final; last candle opens ${new Date(lastOpen).toISOString().slice(11, 16)} -> ${out.klines.pass === 'INCONCLUSIVE' ? 'INCONCLUSIVE' : out.klines.pass ? 'PASS' : 'FAIL'}`);
}

const f = `${OUT}/l3-1645-1646-${out.started.replace(/[:.]/g, '-')}.json`;
writeFileSync(f, JSON.stringify(out, null, 1)); console.log('saved', f);
