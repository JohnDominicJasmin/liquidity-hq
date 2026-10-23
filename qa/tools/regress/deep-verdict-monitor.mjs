/* #1631: does Deep Research still return a PARSEABLE VERDICT? One call, one deployed build, no opinion.
 *
 * WHY THIS EXISTS. On 2026-10-23 Deep Research was found returning 502 BAD_ANSWER on every call, across two builds, and the cause
 * predated the batch under test. A billed read had worked earlier the same day on 395cb50, so it broke somewhere in 395cb50..958288c
 * and NOTHING NOTICED - the feature the owner charges for had no end-to-end check at all. Unit tests cover the prompt and the parser;
 * neither makes a call. The only detector that works is a real call, and nobody was making one.
 *
 * IT ASSERTS THE VERDICT, NOT HTTP 200. PM's requirement and the right one: today's failures happen to return 502, so a status check
 * would pass the moment the shape changes to a 200 carrying an unparseable body - the same mistake as trusting a log line that is
 * never written. What is being bought is a verdict, so that is what this demands.
 *
 * WHAT IT COSTS, stated because a monitor that bills silently gets switched off: ONE Deep call per run. That is one xAI call against
 * the project's global daily counter, AND one of the signed-in account's ten daily Deep reads. Do not run it on a loop, and do not
 * schedule it more than once a day without saying so where the owner can see it.
 *
 * usage: node qa/tools/regress/deep-verdict-monitor.mjs <base-url> [--dry]
 * exit 0 = a parseable verdict came back. exit 1 = it did not, and the raw body is printed for the issue.  */
import { readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const BASE = (process.argv[2] || '').replace(/\/$/, '');
const DRY = process.argv.includes('--dry');
if (!BASE) { console.error('usage: deep-verdict-monitor.mjs <base-url> [--dry]'); process.exit(2); }

const REPO = fileURLToPath(new URL('../../../', import.meta.url)).replace(/[\\/]$/, '');
const env = {};
for (const f of ['.env.e2e.local', '.env.local']) {
  const p = `${REPO}/${f}`;
  if (!existsSync(p)) continue;
  for (const line of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)$/.exec(line.replace(/^﻿/, ''));
    if (m && !(m[1] in env)) env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
}
/* process.env fills any name the files did not supply: the cloud runner has no .env.e2e.local. Files win, so a stale exported
   variable cannot silently override the checked-in ones. */
for (const [k, v] of Object.entries(process.env)) if (!(k in env) && typeof v === 'string' && v !== '') env[k] = v;

const need = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_ANON_KEY', 'E2E_USER_A_EMAIL', 'E2E_USER_A_PASSWORD'];
const missing = need.filter((k) => !env[k]);
if (missing.length) { console.error(`missing from the local env files: ${missing.join(', ')}`); process.exit(2); }

const ver = await (await fetch(`${BASE}/api/version`, { cache: 'no-store', signal: AbortSignal.timeout(30_000) })).json();
console.log(`build: commit=${ver.commit} branch=${ver.branch} appEnv=${ver.appEnv}  at ${new Date().toISOString()}`);

/* `process.exit()` right after a fetch aborts the process with a libuv assertion (UV_HANDLE_CLOSING) instead of exiting - and for a
   MONITOR the exit code IS the contract, so a crash where a 0 belongs would read to a scheduler as a failed check. Everything below
   therefore lives in main(), and the exit status is set with `process.exitCode`, letting Node close its own handles. */
async function main() {
if (DRY) { console.log('DRY: would POST /api/grok {type:deep, coin:btc, tf:4h}. No call made, nothing billed.'); return 0; }

const auth = await fetch(`${env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/token?grant_type=password`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', apikey: env.NEXT_PUBLIC_SUPABASE_ANON_KEY },
  body: JSON.stringify({ email: env.E2E_USER_A_EMAIL, password: env.E2E_USER_A_PASSWORD }),
  signal: AbortSignal.timeout(60_000),
});
if (!auth.ok) { console.error(`sign-in failed: HTTP ${auth.status}`); return 2; }
const token = (await auth.json()).access_token;
if (!token) { console.error('sign-in returned no access_token'); return 2; }

/* Neutral phrasing on purpose. An advice-shaped question ("should I go long") is a legitimate thing for the model to decline, so it
   cannot be used to test availability - that confound cost a billed call to discover on 2026-10-23. */
const res = await fetch(`${BASE}/api/grok`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ prompt: 'Deep read on BTC 4h', tf: '4h', session: 'ny', type: 'deep', coin: 'btc' }),
  signal: AbortSignal.timeout(180_000),
});
const text = await res.text();
let json; try { json = JSON.parse(text); } catch { json = null; }

/* THE ASSERTION: a verdict the app itself would accept. The five values are lib/grok.ts's own contract (SIGNALS), and confidence is
   what the Arena panel renders beside it. A 200 with neither is a failure, which is the case a status check would miss. */
const SIGNALS = ['BULLISH', 'LEAN BULLISH', 'FLAT', 'LEAN BEARISH', 'BEARISH'];
const signal = json?.signal ?? json?.result?.signal;
const confidence = json?.confidence ?? json?.result?.confidence;
const parseable = typeof signal === 'string' && SIGNALS.includes(signal.toUpperCase()) && Number.isFinite(Number(confidence));

const dir = `${REPO}/../qa-evidence-guardrail`;
mkdirSync(dir, { recursive: true });
const file = `${dir}/deep-verdict-${ver.commit}-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
writeFileSync(file, JSON.stringify({ build: ver, status: res.status, parseable, signal, confidence, body: json ?? text }, null, 2));

if (parseable) {
  console.log(`PASS: verdict=${signal} confidence=${confidence} (HTTP ${res.status}) on ${ver.commit}`);
  console.log(`usage: ${JSON.stringify(json?.usage ?? json?._usage ?? '(not reported)')}`);
  console.log(`saved ${file}`);
  return 0;
}

console.error(`FAIL on ${ver.commit}: no parseable verdict. HTTP ${res.status}`);
console.error(`signal=${JSON.stringify(signal)} confidence=${JSON.stringify(confidence)}`);
console.error(`RAW BODY (for the issue):\n${text.slice(0, 1200)}`);
console.error(`saved ${file}`);
return 1;
}

/* exitCode rather than exit(): see the note on main(). 0 = parseable verdict, 1 = the feature is broken, 2 = the check could not run. */
process.exitCode = await main();
