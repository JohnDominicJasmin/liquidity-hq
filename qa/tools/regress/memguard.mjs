/* PM's rule for this machine, 2026-10-21 09:50 UTC: ONE headless Chromium at a time, abort at 1.6 GB free (the harness reaper line, which killed
 * Dev's jobs at 09:42), a 2-3 minute pause between passes. The owner's Brave is never touched.
 *
 * guarded(chromium).launch() refuses to start under START_GB free, refuses a second browser while one is open in the same process, and starts a
 * watchdog: if free memory falls under ABORT_GB it closes the browser, prints one "ABORTED: memory" line and exits with code 3. A pass that ends that
 * way is reported as aborted and re-run, never read as a result.                                                                                    */
import os from 'node:os';
export const START_GB = 2.0;
export const ABORT_GB = 1.6;
export const freeGB = () => os.freemem() / 1024 ** 3;
export function guarded(pw) {
  let open = 0;
  return {
    async launch(opts = {}) {
      if (open > 0) throw new Error('memguard: a second Chromium in the same run (PM rule: one at a time)');
      const f = freeGB();
      if (f < START_GB) { console.log(`ABORTED: memory ${f.toFixed(2)} GB free at launch (start needs ${START_GB})`); process.exit(3); }
      const browser = await pw.launch({ headless: true, ...opts }); open++;
      const t = setInterval(async () => {
        const g = freeGB(); if (g >= ABORT_GB) return;
        clearInterval(t); console.log(`ABORTED: memory ${g.toFixed(2)} GB free during the run (abort line ${ABORT_GB})`);
        try { await browser.close(); } catch { /* already gone */ }
        process.exit(3);
      }, 2000);
      t.unref();
      browser.on('disconnected', () => { clearInterval(t); open = Math.max(0, open - 1); });
      return browser;
    },
  };
}
