/* #1397 part 2 - stepped open-loop load ramp against `qa` at d4f425f.
 *
 * Adapted from the staging ramp used earlier today. THREE things are new, all of them
 * conditions PM/DevOps set, and each one exists because the run is worthless without it:
 *
 *   1. AN UPSTREAM-REFUSAL ABORT. The old script stopped on a 5xx from OUR service. It
 *      would NOT have stopped if an exchange started refusing us - a 429 or 418 can arrive
 *      as a perfectly cheerful 200 carrying an error body, because our routes fall back.
 *      Binance already bans the qa and staging IPs for /v3/klines; earning a second ban to
 *      finish a test would cost the thing the test exists to protect. A free instance
 *      falling over is acceptable. An exchange blocking us is not.
 *
 *   2. A CONTROL COLUMN. The cached route is compared against an UNCACHED one on the same
 *      instance, same ramp, same minute. If both hold flat, the load never bit and the
 *      "caching works" reading is unsupported - that is the difference between a number
 *      and a measurement, and it is the rule that cost three withdrawn figures today.
 *
 *   3. RATES CARRY THEIR WINDOW. Every rate is reported as "n over s seconds", never as a
 *      cumulative total, because a counter without its reset time is not a measurement.
 *
 * Usage: node load-ramp-qa.mjs <base> <route> <label> <steps> <stepSeconds>
 */


/* FREE MEMORY IS RECORDED WITH EVERY STEP.
 *
 * Dev Team asked for this and was right to: a load test that hit its ceiling because the
 * HOST was short of RAM looks exactly like one that found the tier's ceiling. Without a
 * figure beside each step the run cannot tell you which it was - the same shape as a probe
 * that measures itself. Measured on this box afterwards: the Claude sessions held 3.26 GB
 * and the node watchers 1.48 GB, so the generator's own host is NOT a neutral observer.
 */
import { execFile as _execFile } from 'node:child_process';
import { promisify as _promisify } from 'node:util';
const _run = _promisify(_execFile);
async function freeMb() {
  try {
    const { stdout } = await _run('powershell', ['-NoProfile', '-Command',
      '$o=Get-CimInstance Win32_OperatingSystem; [math]::Round($o.FreePhysicalMemory/1KB,0)'], { timeout: 30_000 });
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

const [base, route, label, stepsArg, stepSecArg] = process.argv.slice(2);
const SB_URL = process.env.SB_URL, SB_KEY = process.env.SB_KEY;
if (!base || !route || !SB_URL || !SB_KEY) { console.error('need <base> <route> <label> <steps> <stepSec> and SB_URL/SB_KEY'); process.exit(2); }

const STEPS = stepsArg.split(',').map(Number);
const STEP_SEC = Number(stepSecArg);
const MAX_MS = 12 * 60 * 1000;
const REQ_TIMEOUT_MS = 30_000;
const DB_SLOW_MS = 2000;
const MAX_INFLIGHT = 120;

/* What an upstream refusal looks like by the time it reaches us. Deliberately broad: a
   false abort costs one re-run, a missed one costs an exchange ban. */
const REFUSAL = /\b(429|418|1008|rate.?limit|too many requests|banned|forbidden|restricted location|ip.?ban)\b/i;

const t0 = Date.now();
const PROBE_MINUTES = Number(process.env.QA_PROBE_MIN || 6);
let stopReason = null, inflight = 0;
const dbSamples = [];
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(p * s.length))]; };

async function one(url, tag) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(url, { signal: ac.signal, headers: { 'user-agent': 'lhq-qa-load-1397' }, cache: 'no-store' });
    const text = await res.text().catch(() => '');
    return { ms: performance.now() - start, status: res.status, body: text.replace(/\s+/g, ' ').slice(0, 400), tag };
  } catch (e) { return { ms: performance.now() - start, status: 0, err: (e && e.name) || 'err', tag }; }
  finally { clearTimeout(timer); }
}

/** PM's abort line. Checks a cached upstream-backed route for signs WE are being refused. */
async function upstreamRefusalProbe() {
  while (!stopReason && Date.now() - t0 < PROBE_MINUTES * 60_000) {
    const r = await one(base + '/api/cmc?type=global', 'upstream');
    const hit = r.status === 429 || r.status === 418 || (r.body && REFUSAL.test(r.body));
    console.log(`[upstream +${Math.round((Date.now() - t0) / 1000)}s] /api/cmc?type=global -> ${r.status} ${Math.round(r.ms)}ms${hit ? '  <-- REFUSAL MARKER' : ''}`);
    if (hit) { stopReason = `UPSTREAM REFUSING US: /api/cmc?type=global -> ${r.status}; body: ${r.body.slice(0, 200)}`; break; }
    await new Promise(r2 => setTimeout(r2, 10_000));
  }
}

async function directDb() {
  const ac = new AbortController(); const timer = setTimeout(() => ac.abort(), REQ_TIMEOUT_MS);
  const start = performance.now();
  try {
    const res = await fetch(SB_URL + '/rest/v1/lhq_dev_labels?select=key&locale=eq.en&limit=50',
      { signal: ac.signal, headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store' });
    await res.arrayBuffer().catch(() => {});
    return { ms: performance.now() - start, status: res.status };
  } catch { return { ms: performance.now() - start, status: 0 }; } finally { clearTimeout(timer); }
}

async function dbProbeLoop() {
  while (!stopReason && Date.now() - t0 < PROBE_MINUTES * 60_000) {
    const d = await directDb();
    dbSamples.push({ t: Date.now() - t0, directMs: Math.round(d.ms), directStatus: d.status });
    console.log(`[db +${Math.round((Date.now() - t0) / 1000)}s] direct-supabase ${d.status} ${Math.round(d.ms)}ms | inflight=${inflight}`);
    if (d.ms > DB_SLOW_MS || d.status >= 500 || d.status === 0) { stopReason = `DB probe ${d.status} ${Math.round(d.ms)}ms`; break; }
    await new Promise(r => setTimeout(r, 5000));
  }
}

async function runStep(rps) {
  const results = []; const interval = 1000 / rps;
  const end = Date.now() + STEP_SEC * 1000; const pending = []; let sent = 0;
  const stepStart = Date.now();
  const freeMbStart = await freeMb();
  while (Date.now() < end && !stopReason) {
    if (inflight >= MAX_INFLIGHT) { stopReason = `in-flight reached ${MAX_INFLIGHT} at ${rps} rps (saturated)`; break; }
    inflight++; sent++;
    pending.push(one(base + route, 'target').then(r => {
      inflight--; results.push(r);
      if (!stopReason && r.status >= 500) stopReason = `first 5xx: HTTP ${r.status} at ${rps} rps`;
      if (!stopReason && r.body && REFUSAL.test(r.body)) stopReason = `UPSTREAM REFUSAL in target body at ${rps} rps: ${r.body.slice(0, 200)}`;
    }));
    await new Promise(r => setTimeout(r, interval));
  }
  await Promise.race([Promise.allSettled(pending), new Promise(r => setTimeout(r, REQ_TIMEOUT_MS + 1000))]);
  const windowSec = +((Date.now() - stepStart) / 1000).toFixed(1);
  const ok = results.filter(r => r.status >= 200 && r.status < 400).map(r => r.ms);
  const codes = {};
  for (const r of results) { const k = r.status || (r.err || 'err'); codes[k] = (codes[k] || 0) + 1; }
  const stat = {
    label, rps, sent, completed: results.length, windowSec,
    achievedRps: +(results.length / windowSec).toFixed(1),
    p50: ok.length ? Math.round(pct(ok, 0.5)) : null,
    p90: ok.length ? Math.round(pct(ok, 0.9)) : null,
    p99: ok.length ? Math.round(pct(ok, 0.99)) : null,
    max: ok.length ? Math.round(Math.max(...ok)) : null,
    freeMbStart, freeMbEnd: await freeMb(),
    codes,
  };
  console.log('[step] ' + JSON.stringify(stat));
  return stat;
}

if (process.env.QA_PROBES_ONLY) {
  console.log(`# probes-only against ${base} - separate process, no load generated here`);
  await Promise.allSettled([dbProbeLoop(), upstreamRefusalProbe()]);
  console.log('# PROBE STOP: ' + (stopReason || 'ended'));
  process.exit(0);
}

(async () => {
  console.log(`# ${label}: ${base}${route}  steps=${STEPS.join(',')} rps x ${STEP_SEC}s  started ${new Date().toISOString()}`);
  /* PROBES RUN IN A SEPARATE PROCESS, NOT HERE.
     The first version ran them inside this process, so every probe queued behind the load
     this process was generating - the DB probe read 8669ms while an unloaded read of the
     same table took 183ms, and it aborted the run blaming the database. A probe that shares
     an event loop with the load generator measures the generator. Set QA_PROBES=1 to run
     this file in probes-only mode alongside the ramp. */
  const probes = process.env.QA_NO_PROBES ? [] : [dbProbeLoop(), upstreamRefusalProbe()];
  const steps = [];
  for (const rps of STEPS) {
    if (stopReason) break;
    if (Date.now() - t0 > MAX_MS) { stopReason = '12 minute cap'; break; }
    steps.push(await runStep(rps));
    if (!stopReason) await new Promise(r => setTimeout(r, 4000));
  }
  if (!stopReason) stopReason = 'ramp completed with no stop condition';
  await Promise.allSettled(probes);
  console.log('# STOP: ' + stopReason);
  console.log('# RESULT ' + JSON.stringify({ label, route, steps, stopReason, elapsedSec: Math.round((Date.now() - t0) / 1000), dbDirectP50: pct(dbSamples.map(s => s.directMs), 0.5), dbDirectMax: dbSamples.length ? Math.max(...dbSamples.map(s => s.directMs)) : null, dbSamples: dbSamples.length }));
})();
