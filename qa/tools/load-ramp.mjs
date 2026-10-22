// Stepped open-loop load ramp against ONE route, with a database probe running alongside.
// Usage: node load-ramp.mjs <base> <route> <steps e.g. 2,5,10,20,40,80> <stepSeconds> <dbProbePath>
// Stops at the first of: a 5xx from the target, a DB probe > 2000 ms, 20 minutes, or in-flight > 150.
// Open loop: requests are fired on a fixed schedule whether or not earlier ones finished, which is how
// real traffic arrives; a closed loop would hide queueing.

const [base, route, stepsArg, stepSecArg, dbProbe] = process.argv.slice(2);
const SB_URL = process.env.SB_URL, SB_KEY = process.env.SB_KEY;
if (!SB_URL || !SB_KEY) { console.error('SB_URL and SB_KEY required for the direct DB probe'); process.exit(2); }
const STEPS = stepsArg.split(',').map(Number);
const STEP_SEC = Number(stepSecArg);
const MAX_MS = 20 * 60 * 1000;
const REQ_TIMEOUT_MS = 30_000;
const DB_SLOW_MS = 2000;
const MAX_INFLIGHT = 150;

const t0 = Date.now();
let stopReason = null;
let inflight = 0;
const dbSamples = [];

function pct(arr, p) { if (!arr.length) return null; const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; }

async function one(url) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'lhq-qa-load-1397' }, cache: 'no-store' });
    let bodySnippet = '';
    if (res.status >= 400) bodySnippet = (await res.text().catch(() => '')).replace(/\s+/g, ' ').slice(0, 160);
    else await res.arrayBuffer().catch(() => {});
    return { ms: performance.now() - start, status: res.status, server: res.headers.get('server') || '', render: res.headers.get('x-render-origin-server') || res.headers.get('rndr-id') || '', body: bodySnippet };
  } catch (e) {
    return { ms: performance.now() - start, status: 0, err: (e && e.name) || 'err' };
  } finally { clearTimeout(timer); }
}

async function directDb() {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(SB_URL + '/rest/v1/lhq_dev_labels?select=key&locale=eq.en&limit=50', { signal: ac.signal, headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store' });
    await res.arrayBuffer().catch(() => {});
    return { ms: performance.now() - start, status: res.status };
  } catch (e) { return { ms: performance.now() - start, status: 0 }; } finally { clearTimeout(timer); }
}
async function dbProbeLoop() {
  while (!stopReason) {
    const [d, n] = await Promise.all([directDb(), one(base + dbProbe)]);
    dbSamples.push({ t: Date.now() - t0, directMs: Math.round(d.ms), directStatus: d.status, viaNodeMs: Math.round(n.ms), viaNodeStatus: n.status });
    console.log(`[db-probe +${Math.round((Date.now() - t0) / 1000)}s] direct-supabase ${d.status} ${Math.round(d.ms)}ms | via-node ${n.status} ${Math.round(n.ms)}ms | inflight=${inflight}`);
    if (d.ms > DB_SLOW_MS || d.status >= 500 || d.status === 0) { stopReason = `DIRECT db probe ${d.status} ${Math.round(d.ms)}ms (> ${DB_SLOW_MS}ms or failed)`; break; }
    await new Promise(r => setTimeout(r, 3000));
  }
}

async function runStep(rps) {
  const results = [];
  const interval = 1000 / rps;
  const end = Date.now() + STEP_SEC * 1000;
  const pending = [];
  let sent = 0;
  while (Date.now() < end && !stopReason) {
    if (inflight >= MAX_INFLIGHT) { stopReason = `in-flight reached ${MAX_INFLIGHT} at ${rps} rps (target saturated)`; break; }
    inflight++; sent++;
    pending.push(one(base + route).then(r => {
      inflight--; results.push(r);
      if (r.status >= 500 && !stopReason) stopReason = `first 5xx: HTTP ${r.status} at ${rps} rps (${r.body || ''})`;
    }));
    await new Promise(r => setTimeout(r, interval));
  }
  // Let stragglers finish (bounded) so the step's latency picture is complete.
  await Promise.race([Promise.allSettled(pending), new Promise(r => setTimeout(r, REQ_TIMEOUT_MS + 1000))]);
  const ok = results.filter(r => r.status >= 200 && r.status < 400).map(r => r.ms);
  const codes = {};
  for (const r of results) { const k = r.status || (r.err || 'err'); codes[k] = (codes[k] || 0) + 1; }
  const stat = { rps, sent, done: results.length, achievedRps: +(results.length / STEP_SEC).toFixed(1), p50: pct(ok, 0.5) && Math.round(pct(ok, 0.5)), p90: pct(ok, 0.9) && Math.round(pct(ok, 0.9)), p99: pct(ok, 0.99) && Math.round(pct(ok, 0.99)), max: ok.length ? Math.round(Math.max(...ok)) : null, codes, samples: results.filter(r => r.status >= 400 || r.status === 0).slice(0, 3) };
  console.log('[step]', JSON.stringify(stat));
  return stat;
}

(async () => {
  console.log(`# load ramp: ${base}${route}  steps=${STEPS.join(',')} rps x ${STEP_SEC}s  db-probe=${dbProbe}  started ${new Date().toISOString()}`);
  const probe = dbProbeLoop();
  const steps = [];
  for (const rps of STEPS) {
    if (stopReason) break;
    if (Date.now() - t0 > MAX_MS) { stopReason = '20 minute cap'; break; }
    steps.push(await runStep(rps));
    if (!stopReason) await new Promise(r => setTimeout(r, 4000)); // breathing room between steps
  }
  if (!stopReason) stopReason = 'ramp completed without a stop condition';
  await probe.catch(() => {});
  console.log('# STOP:', stopReason);
  console.log('# db-probe summary:', JSON.stringify({ n: dbSamples.length, directP50: pct(dbSamples.map(s => s.directMs), 0.5), directMax: Math.max(...dbSamples.map(s => s.directMs)), viaNodeP50: pct(dbSamples.map(s => s.viaNodeMs), 0.5), viaNodeMax: Math.max(...dbSamples.map(s => s.viaNodeMs)) }));
  console.log('# RESULT ' + JSON.stringify({ route, steps, stopReason, dbSamples, elapsedSec: Math.round((Date.now() - t0) / 1000) }));
})();
