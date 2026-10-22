// Small, capped open-loop ramp of a trivial indexed read DIRECTLY against the dev Supabase REST API
// (PostgREST), bypassing the staging Node instance. Purpose: find where the database layer itself
// starts to slow, which the 0.15-CPU staging instance hides (it queues at ~5 rps before the DB is
// ever stressed). Stops at the first of: any 5xx/network failure, a step whose p50 > 2000 ms,
// in-flight > 100, or the step list ending. Steps are short on purpose: the dev database is shared.
const SB_URL = process.env.SB_URL, SB_KEY = process.env.SB_KEY;
const STEPS = (process.argv[2] || '5,10,20,30').split(',').map(Number);
const STEP_SEC = Number(process.argv[3] || 10);
const PATH = '/rest/v1/lhq_dev_labels?select=key&locale=eq.en&limit=50';
const MAX_INFLIGHT = 100, TIMEOUT = 15_000;
let inflight = 0, stop = null;
const pct = (a, p) => { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor(p * s.length))]); };
async function one() {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), TIMEOUT); const s = performance.now();
  try {
    const r = await fetch(SB_URL + PATH, { signal: ac.signal, headers: { apikey: SB_KEY, Authorization: 'Bearer ' + SB_KEY }, cache: 'no-store' });
    const body = r.status >= 400 ? (await r.text().catch(() => '')).slice(0, 160) : (await r.arrayBuffer().catch(() => {}), '');
    return { ms: performance.now() - s, status: r.status, body };
  } catch (e) { return { ms: performance.now() - s, status: 0, body: e && e.name }; } finally { clearTimeout(t); }
}
(async () => {
  console.log(`# direct PostgREST ramp ${new URL(SB_URL).host}${PATH} steps=${STEPS.join(',')} x ${STEP_SEC}s started ${new Date().toISOString()}`);
  const out = [];
  for (const rps of STEPS) {
    if (stop) break;
    const results = [], pending = []; const end = Date.now() + STEP_SEC * 1000; let sent = 0;
    while (Date.now() < end && !stop) {
      if (inflight >= MAX_INFLIGHT) { stop = `in-flight reached ${MAX_INFLIGHT} at ${rps} rps`; break; }
      inflight++; sent++;
      pending.push(one().then(r => { inflight--; results.push(r); if ((r.status >= 500 || r.status === 0) && !stop) stop = `failure ${r.status} ${r.body} at ${rps} rps`; }));
      await new Promise(r => setTimeout(r, 1000 / rps));
    }
    await Promise.race([Promise.allSettled(pending), new Promise(r => setTimeout(r, TIMEOUT + 500))]);
    const ok = results.filter(r => r.status === 200).map(r => r.ms);
    const codes = {}; for (const r of results) codes[r.status] = (codes[r.status] || 0) + 1;
    const stat = { rps, sent, done: results.length, achievedRps: +(results.length / STEP_SEC).toFixed(1), p50: pct(ok, 0.5), p90: pct(ok, 0.9), p99: pct(ok, 0.99), codes };
    console.log('[step]', JSON.stringify(stat)); out.push(stat);
    if (!stop && stat.p50 > 2000) stop = `p50 ${stat.p50}ms > 2000ms at ${rps} rps`;
    if (!stop) await new Promise(r => setTimeout(r, 3000));
  }
  console.log('# STOP:', stop || 'ramp completed without a stop condition');
  console.log('# RESULT ' + JSON.stringify(out));
})();
