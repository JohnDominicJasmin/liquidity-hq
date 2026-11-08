/* Waits for a line to appear in a log buffer that someone else is filling asynchronously.
 *
 * WHY THIS EXISTS AS ITS OWN FILE. `startFailOnceServer` used to check its log buffer ONCE,
 * synchronously, the instant its readiness `fetch` succeeded:
 *
 *     if (!logs.some(l => l.includes('[fail-once] armed'))) throw ...
 *
 * `logs` is filled by async stdout/stderr 'data' events, so the child's HTTP server answering can
 * beat the first data event into the array. The check then reports a missing arming message for a
 * child that armed perfectly. That is what broke desktop run 42436245702: it threw in 723ms (and
 * 423ms on retry) with an EMPTY log tail, and the emptiness is the tell - a child that had really
 * started without the --require would still have printed next's own startup banner. An empty buffer
 * means nothing had been DRAINED yet, not that nothing was printed.
 *
 * It lives here rather than inline because the bug was in the WAITING, and waiting is the one thing
 * that cannot be tested by reading the code. Injecting `now` and `sleep` makes the race
 * reproducible on a fake clock, so the regression test needs no build, no `next start` and no
 * browser - the defect is provable in milliseconds instead of in CI.
 *
 * Deliberately NOT importing anything: a pure helper keeps the unit test free of @playwright/test.
 */

export type AwaitLogLineResult =
  /* The line arrived (possibly after waiting). */
  | { armed: true; waitedMs: number }
  /* It never arrived. `captured` separates the two causes, which have OPPOSITE remedies:
     false = nothing was collected at all, so suspect log capture or a silent child;
     true  = output arrived but carries no such line, which does point at the require itself. */
  | { armed: false; waitedMs: number; captured: boolean };

export async function awaitLogLine(
  logs: readonly string[],
  needle: string,
  opts: {
    timeoutMs: number;
    pollMs?: number;
    now?: () => number;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<AwaitLogLineResult> {
  const pollMs = opts.pollMs ?? 100;
  const now = opts.now ?? Date.now;
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>(r => setTimeout(r, ms)));

  const started = now();
  const present = () => logs.some(l => l.includes(needle));

  /* Checked BEFORE the first sleep, so a line already present costs nothing. A timeoutMs of 0 must
     still get this one look - the common case is that the line is already there. */
  if (present()) return { armed: true, waitedMs: 0 };

  while (now() - started < opts.timeoutMs) {
    await sleep(pollMs);
    if (present()) return { armed: true, waitedMs: now() - started };
  }

  return { armed: false, waitedMs: now() - started, captured: logs.length > 0 };
}
