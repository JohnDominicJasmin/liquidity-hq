/* One watch, three subjects. Emits ONLY on a change, a breach, or a failure.
 *
 * SILENCE IS NEVER A RESULT. Three ways that rule is enforced here:
 *   - the first poll always prints a BASELINE line, so "armed" is distinguishable from
 *     "running but seeing nothing";
 *   - every probe failure prints, because a watch that cannot see its subject must say so
 *     rather than look calm (a `gh` outage and a quiet queue are otherwise identical);
 *   - discovery is by NUMBER, not by a tracked list - a watch armed before a PR exists
 *     never sees it otherwise, which is the gap that cost a wrong report earlier today.
 *
 * No `jq` and no `bc` on this machine - checked with `command -v` before arming, because a
 * pipeline into a missing binary reports quiet for ever. Everything here is node.
 *
 * NOTE ON CI: GitHub Actions is billing-locked (#1413). NO workflow signal will arrive at
 * all. That silence is expected and is not evidence about the code.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const run = promisify(execFile);

const SERVICES = [
  ['prod   ', 'https://liquidity-hq.com/api/version', 'b96dcb3'],
  ['staging', 'https://liquidity-hq-staging.onrender.com/api/version', '03443d7'],
  ['qa     ', 'https://liquidity-hq-qa.onrender.com/api/version', 'd4f425f'],
  ['dev    ', 'https://liquidity-hq-dev.onrender.com/api/version', null],
];
const REAPER_GB = 1.6;      // a build was reaped here at 1.63 GB free
const WARN_GB = 2.2;
const EVERY_MS = 120_000;

const seen = { version: new Map(), prs: new Set(), issues: new Set() };
const unreach = new Map();
/* SUPPRESSED BLIPS ARE COUNTED, because the streak guard's own success is otherwise
   invisible: "no alarms" and "alarms correctly swallowed" look identical, which is the
   failure the guard was added for, one level up. Reported once per BLIP_REPORT_EVERY
   suppressions so a flaky network is visible as a trend without crying wolf per blip. */
let blips = 0, blipsReported = 0;
const BLIP_REPORT_EVERY = 4;
const UNREACHABLE_STREAK = 3;   // ~6 minutes at a 120s cadence
let first = true, ghFails = 0, memFails = 0;
const log = (s) => console.log(`[${new Date().toISOString().slice(11, 19)}Z] ${s}`);

async function version(url) {
  try {
    const ac = AbortSignal.timeout(45_000);
    const r = await fetch(url, { cache: 'no-store', signal: ac });
    const j = await r.json();
    return `${j.commit}|${j.branch}`;
  } catch (e) { return `UNREACHABLE(${(e && e.name) || 'err'})`; }
}

async function freeGb() {
  try {
    const { stdout } = await run('powershell', ['-NoProfile', '-Command',
      '$o=Get-CimInstance Win32_OperatingSystem; [math]::Round($o.FreePhysicalMemory/1MB,2)'], { timeout: 60_000 });
    const n = Number(String(stdout).trim());
    return Number.isFinite(n) ? n : null;
  } catch { return null; }
}

async function github() {
  const { stdout } = await run('gh', ['api', 'graphql', '-f', `query={repository(owner:"JohnDominicJasmin",name:"liquidity-hq"){
    pullRequests(states:OPEN, first:40, orderBy:{field:UPDATED_AT, direction:DESC}){nodes{number title isDraft}}
    issues(states:OPEN, first:40, orderBy:{field:UPDATED_AT, direction:DESC}){nodes{number title}}}}`],
    { timeout: 90_000, maxBuffer: 8 * 1024 * 1024 });
  const d = JSON.parse(stdout).data.repository;
  return {
    prs: (d.pullRequests?.nodes ?? []).map(n => [n.number, `${n.isDraft ? '(draft) ' : ''}${String(n.title).slice(0, 78)}`]),
    issues: (d.issues?.nodes ?? []).map(n => [n.number, String(n.title).slice(0, 78)]),
  };
}

async function tick() {
  // 1. what is LIVE - the only claim that counts
  /* ALL FOUR IN PARALLEL, and memory alongside them. Sequential 45s timeouts meant one
     sleeping free-plan instance blocked the whole tick - the first version produced no
     output at all in 100s, so the watch would have looked armed and silent while simply
     being stuck on its first subject. */
  const lines = [];
  const [versions, gb] = await Promise.all([
    Promise.all(SERVICES.map(([, url]) => version(url))),
    freeGb(),
  ]);
  /* A SINGLE FAILED POLL IS NOT AN OUTAGE, and must not be reported as one.
     The first version alarmed on one bad reading: all four services went
     "UNREACHABLE" in the same second, which is the signature of a LOCAL fault, not
     four independent outages - controls (github, cloudflare) were fine and all four
     answered 200 in <0.5s moments later. This machine's DNS has failed intermittently
     four times today. Worse, the bad reading became the stored state, so the next good
     poll would have fired four MORE false "moved" events.
     So: an UNREACHABLE is remembered but never alarms until it repeats
     UNREACHABLE_STREAK times, and a recovery from it is logged as recovery, not as a
     service moving. A real commit change still alarms on the first sighting. */
  SERVICES.forEach(([name, , expect], i) => {
    const now = versions[i];
    const was = seen.version.get(name);
    const bad = now.startsWith('UNREACHABLE');
    if (first) { seen.version.set(name, now); lines.push(`  ${name} ${now}${expect && !now.startsWith(expect) ? `  <-- expected ${expect}` : ''}`); return; }

    if (bad) {
      const n = (unreach.get(name) ?? 0) + 1;
      unreach.set(name, n);
      blips++;
      if (n === UNREACHABLE_STREAK) log(`SERVICE UNREACHABLE: ${name.trim()} failed ${n} consecutive polls (last good: ${was}) - check a neutral control before calling it an outage`);
      return;                      // do NOT overwrite good state with a blip
    }

    const wasDown = (unreach.get(name) ?? 0) >= UNREACHABLE_STREAK;
    unreach.set(name, 0);
    seen.version.set(name, now);
    if (wasDown) log(`SERVICE RECOVERED: ${name.trim()} answering again on ${now}`);
    else if (was !== now) log(`SERVICE MOVED: ${name.trim()} ${was} -> ${now}`);
  });

  // 2. memory, against the REAPER line rather than a build's own stop line
  if (gb === null) { memFails++; if (memFails === 2 || memFails % 10 === 0) log(`MEMORY PROBE FAILING (${memFails}x) - the reaper line is UNWATCHED, treat silence as unknown`); }
  else { memFails = 0; if (gb < REAPER_GB) log(`MEMORY CRITICAL: ${gb} GB free - at/below the ${REAPER_GB} GB line where a build was reaped`); else if (gb < WARN_GB) log(`MEMORY LOW: ${gb} GB free (reaper hit at ${REAPER_GB})`); }

  // 3. PRs and issues, DISCOVERED by number
  let gh;
  try { gh = await github(); ghFails = 0; }
  catch (e) { ghFails++; if (ghFails === 2 || ghFails % 10 === 0) log(`GITHUB PROBE FAILING (${ghFails}x) - queue is UNWATCHED: ${String(e.message).split('\n')[0].slice(0, 110)}`); gh = null; }

  if (gh) {
    for (const [kind, rows, set] of [['PR', gh.prs, seen.prs], ['issue', gh.issues, seen.issues]]) {
      for (const [num, title] of rows) {
        if (first) { set.add(num); continue; }
        if (!set.has(num)) { set.add(num); log(`NEW ${kind} #${num}: ${title}`); }
      }
      if (first) lines.push(`  open ${kind}s (${rows.length}): ${rows.map(r => '#' + r[0]).join(' ')}`);
      // a PR that closes is not news worth waking for; a NEW one is.
    }
  }

  if (!first && blips - blipsReported >= BLIP_REPORT_EVERY) {
    log(`TRANSIENTS SUPPRESSED: ${blips} single-poll failures swallowed so far (threshold is ${UNREACHABLE_STREAK} consecutive before alarming). Services are fine; this machine's network is not. Reported so the guard's silence is not mistaken for a quiet network.`);
    blipsReported = blips;
  }

  if (first) {
    log(`BASELINE - armed. Actions is billing-locked (#1413) so NO workflow signal will ever arrive; that silence is expected.\n${lines.join('\n')}`);
    first = false;
  }
}

await tick();
setInterval(() => { tick().catch(e => log(`WATCH ERROR: ${String(e.message).slice(0, 140)}`)); }, EVERY_MS);
