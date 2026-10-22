/* Sequential browser-spec driver for the release candidate. One spec file per Playwright invocation, one worker,
 * fastest files first. Memory rules (the owner's machine): warn under 2.5 GB free, ABORT under 1.6 GB free, checked
 * every 15 s during a file and before each one. One PROGRESS line per file, so a reap loses nothing and the run
 * resumes from the file after the last one that finished (START env = first file index to run).
 * Read-only against the target: these specs are signed-out or route-stubbed and write nothing. */
import { spawn, execFileSync } from 'node:child_process';
import { appendFileSync, writeFileSync, mkdirSync } from 'node:fs';
import os from 'node:os';

const TARGET = process.env.E2E_BASE_URL;
const OUT = process.argv[2];
const START = Number(process.env.START ?? 0);
if (!TARGET || !OUT) { console.error('need E2E_BASE_URL and an output dir'); process.exit(2); }
mkdirSync(OUT, { recursive: true });
const PROGRESS = `${OUT}/progress.log`;

const FILES = [
  'smoke', 'responsive', 'terminal-default', 'checkout-config-agrees', 'arena-structure', 'layout',
  'hidden-routes', 'cache-policy', 'cache-effective', 'i18n', 'no-duplicate-controls',
  'one-socket-per-screen', 'entitlement-survives-redesign',
];
const WARN_GB = 2.5, ABORT_GB = 1.6;
const gb = () => os.freemem() / 1024 ** 3;
const now = () => new Date().toISOString().slice(11, 19) + 'Z';
const say = (s) => { const line = `[${now()}] ${s}`; appendFileSync(PROGRESS, line + '\n'); console.log(line); };

writeFileSync(PROGRESS, '');
say(`RUN START target=${TARGET} files=${FILES.length} starting at index ${START} free=${gb().toFixed(2)}GB`);

for (let i = START; i < FILES.length; i++) {
  const f = FILES[i];
  if (gb() < ABORT_GB) { say(`ABORT before ${f}: only ${gb().toFixed(2)} GB free (limit ${ABORT_GB}). Resume with START=${i}`); process.exit(3); }
  const t0 = Date.now();
  const logFile = `${OUT}/${String(i).padStart(2, '0')}-${f}.log`;
  say(`FILE_START ${f} (${i + 1}/${FILES.length}) free=${gb().toFixed(2)}GB`);
  const child = spawn('npx', ['playwright', 'test', `qa/e2e/${f}.spec.ts`, '--workers=1', '--reporter=list'], {
    shell: true, env: { ...process.env, E2E_BASE_URL: TARGET }, windowsHide: true,
  });
  let out = '';
  child.stdout.on('data', (d) => { out += d; });
  child.stderr.on('data', (d) => { out += d; });
  let minFree = gb(), warned = false, aborted = false;
  const timer = setInterval(() => {
    const g = gb();
    if (g < minFree) minFree = g;
    if (g < WARN_GB && !warned) { warned = true; say(`WARN during ${f}: ${g.toFixed(2)} GB free (under ${WARN_GB})`); }
    if (g < ABORT_GB && !aborted) {
      aborted = true;
      say(`ABORT during ${f}: ${g.toFixed(2)} GB free (limit ${ABORT_GB}); killing the test process tree. Resume with START=${i}`);
      try { execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { windowsHide: true }); } catch { /* already gone */ }
    }
  }, 15_000);
  const code = await new Promise((res) => child.on('close', res));
  clearInterval(timer);
  writeFileSync(logFile, out);
  if (aborted) process.exit(3);
  const n = (word) => { const m = new RegExp(`(\\d+) ${word}`).exec(out); return m ? Number(m[1]) : 0; };
  const secs = Math.round((Date.now() - t0) / 1000);
  say(`FILE_DONE ${f} exit=${code} passed=${n('passed')} failed=${n('failed')} skipped=${n('skipped')} flaky=${n('flaky')} secs=${secs} minfree=${minFree.toFixed(2)}GB`);
}
say('ALL_DONE');
