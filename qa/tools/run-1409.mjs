/* #1409 steps 1, 3, 4, 5 and 7 against a LOCAL build of the `qa` branch.
 *
 * The claim under test is always "N requests in -> ONE upstream call out", so
 * every step reads the server-side fetch counter, never the response body.
 *
 * CONTROL FIRST. Before any cache assertion, a route with NO cache is hit twice
 * and must show the counter RISING. A counter that silently counts nothing
 * would make every single cache assertion pass, and the run would look perfect.
 */
import { readFileSync, existsSync, unlinkSync } from 'node:fs';

const BASE = process.env.QA_BASE ?? 'http://127.0.0.1:3000';
const COUNTS = process.env.QA_FETCH_COUNTS;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const read = () => (existsSync(COUNTS) ? JSON.parse(readFileSync(COUNTS, 'utf8')) : { total: 0, hosts: {} });
const reset = () => { try { unlinkSync(COUNTS); } catch { /* fine */ } };

async function get(path) {
  const t0 = Date.now();
  const r = await fetch(BASE + path, { cache: 'no-store' });
  const body = await r.text();
  return { status: r.status, ms: Date.now() - t0, body, cc: r.headers.get('cache-control') };
}

/** Upstream calls made while `fn` ran — to `host`, or to anywhere when host is null. */
async function upstream(host, fn) {
  const snap = () => { const c = read(); return host ? (c.hosts[host] ?? 0) : c.total; };
  const before = snap();
  const out = await fn();
  await sleep(120);                       // the counter flushes synchronously; this is slack for in-flight
  return { calls: snap() - before, out };
}

const results = [];
const record = (id, pass, detail) => { results.push({ id, pass, detail }); console.log(`${pass ? 'PASS' : 'FAIL'}  ${id}\n      ${detail}`); };

console.log(`base=${BASE}  counter=${COUNTS}\n`);

/* ── CONTROL 0: does the counter move at all? ─────────────────────────────── */
reset();
{
  /* /api/market/klines is L1-cached at 5s, so two calls ~6.5s apart MUST hit upstream twice.
     Counted across ALL hosts, not one: klines can answer from bybit OR binance, and keying
     on the wrong host would abort this control for a reason that is not the counter. */
  const a = await upstream(null, () => get('/api/market/klines?symbol=BTCUSDT&interval=1h&limit=5'));
  await sleep(6500);
  const b = await upstream(null, () => get('/api/market/klines?symbol=BTCUSDT&interval=1h&limit=5'));
  const moved = a.calls > 0 && b.calls > 0;
  record('CONTROL counter moves', moved,
    `two klines requests 6.5s apart (5s TTL) -> upstream ${a.calls} then ${b.calls}. ` +
    (moved ? 'The instrument can report a positive, so a 0 below means something.'
           : 'INSTRUMENT DEAD - every cache assertion below would pass for the wrong reason. Stop.'));
  if (!moved) { console.log('\nAborting: the counter never moved.'); process.exit(2); }
}

/* ── step 1: /api/cmc?type=global - two requests in 5 min -> ONE call ─────── */
for (const type of ['global', 'altseason']) {
  reset();
  const first  = await upstream('pro-api.coinmarketcap.com', () => get(`/api/cmc?type=${type}`));
  const second = await upstream('pro-api.coinmarketcap.com', () => get(`/api/cmc?type=${type}`));
  const identical = first.out.body === second.out.body;
  record(`1. /api/cmc?type=${type}`, first.out.status === 200 && second.calls === 0 && identical,
    `first: HTTP ${first.out.status}, ${first.calls} upstream call(s), ${first.out.ms}ms | ` +
    `second: ${second.calls} upstream call(s), ${second.out.ms}ms | byte-identical: ${identical}`);
}

/* ── step 3: /api/signal-accuracy - N requests in 10 min -> ONE call ──────── */
{
  reset();
  const first = await upstream('api.bybit.com', () => get('/api/signal-accuracy'));
  let later = 0;
  for (let i = 0; i < 4; i++) later += (await upstream('api.bybit.com', () => get('/api/signal-accuracy'))).calls;
  record('3. /api/signal-accuracy', first.out.status === 200 && later === 0,
    `first: HTTP ${first.out.status}, ${first.calls} upstream call(s) | next 4 requests: ${later} upstream call(s)`);
}

/* ── step 4: /api/cycle - N requests in an hour -> ONE call ───────────────── */
{
  reset();
  const first = await upstream('api.bybit.com', () => get('/api/cycle'));
  let later = 0;
  for (let i = 0; i < 4; i++) later += (await upstream('api.bybit.com', () => get('/api/cycle'))).calls;
  record('4. /api/cycle', first.out.status === 200 && later === 0,
    `first: HTTP ${first.out.status}, ${first.calls} upstream call(s) | next 4 requests: ${later} upstream call(s)`);
}

/* ── step 5: /api/econ-calendar - N requests in an hour -> ONE finnhub call ─ */
{
  reset();
  const first = await upstream('finnhub.io', () => get('/api/econ-calendar'));
  let later = 0; let identical = true;
  for (let i = 0; i < 4; i++) {
    const r = await upstream('finnhub.io', () => get('/api/econ-calendar'));
    later += r.calls;
    if (r.out.body !== first.out.body) identical = false;
  }
  record('5. /api/econ-calendar (the one that would have caught the bug)',
    first.out.status === 200 && later === 0 && identical,
    `first: HTTP ${first.out.status}, ${first.calls} finnhub.io call(s) | next 4: ${later} call(s) | all identical: ${identical}`);
}

console.log(`\n${results.filter(r => r.pass).length}/${results.length} passed`);
console.log(JSON.stringify(read(), null, 2));
