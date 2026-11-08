/* Regression test for the fail-once arming race that failed desktop run 42436245702.
 *
 * A2 IS THE DEFECT. The old code checked the log buffer once, synchronously, the moment the child's
 * readiness fetch succeeded. The arming line is printed by the --require hook but reaches the buffer
 * through async 'data' events, so a correctly armed child whose HTTP server answered first was
 * reported as never armed - in 723ms, with an empty log tail. A2 reproduces exactly that ordering
 * and requires the line to be seen.
 *
 * A3 AND A4 ARE THE OTHER HALF, AND THEY MATTER AS MUCH AS THE FIX. The old error message said
 * "NODE_OPTIONS may not have reached the child process" on BOTH causes, and that hint pointed the
 * release investigation at OnboardingProvider - an app component - when the fault was in this
 * waiting code. An empty buffer is not evidence about the require, because `next start` prints its
 * own banner regardless. So the two cases must be distinguishable by `captured`, not just by prose.
 *
 * THE CLOCK IS INJECTED, so this runs in microseconds: no build, no `next start`, no browser. The
 * bug was in the waiting, and waiting is the one thing reading the code cannot check.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { awaitLogLine } from '../qa/e2e/awaitLogLine.ts';

const NEEDLE = '[fail-once] armed';
/* A realistic chunk: the arming line arrives glued to other output, never alone on its own string. */
const ARMED_CHUNK = '> Ready on http://localhost:3101\n[fail-once] armed match=/rest/v1/user_onboarding status=500\n';

/* A fake child whose output appears only once the clock has advanced past `arriveAtMs`, which is
   what an async 'data' event does relative to a readiness poll that has already returned. */
function fakeChild({ arriveAtMs = null as number | null, initial = [] as string[] } = {}) {
  let t = 0;
  const logs: string[] = [...initial];
  let sleeps = 0;
  return {
    logs,
    sleeps: () => sleeps,
    elapsed: () => t,
    opts: {
      timeoutMs: 10_000,
      pollMs: 100,
      now: () => t,
      sleep: async (ms: number) => {
        sleeps++;
        t += ms;
        if (arriveAtMs !== null && t >= arriveAtMs && !logs.some(l => l.includes(NEEDLE))) logs.push(ARMED_CHUNK);
      },
    },
  };
}

test('A1. a line already in the buffer is seen without sleeping at all', async () => {
  const c = fakeChild({ initial: [ARMED_CHUNK] });
  const r = await awaitLogLine(c.logs, NEEDLE, c.opts);
  assert.deepEqual(r, { armed: true, waitedMs: 0 });
  assert.equal(c.sleeps(), 0, 'it slept despite the line already being present');
});

test('A2. REGRESSION (run 42436245702): a line that arrives AFTER the readiness poll is still seen', async () => {
  const c = fakeChild({ arriveAtMs: 300 });
  /* The buffer starts empty, exactly as it was when the old check threw with an empty log tail. */
  assert.equal(c.logs.length, 0);
  const r = await awaitLogLine(c.logs, NEEDLE, c.opts);
  assert.equal(r.armed, true, 'a child that armed late was reported as never armed - this is the 42436245702 failure');
  assert.equal(r.waitedMs, 300);
  assert.equal(c.sleeps(), 3, 'expected three 100ms polls before the line landed');
});

test('A3. never arrives but output WAS captured: captured=true, which does point at the require', async () => {
  const c = fakeChild({ initial: ['> Ready on http://localhost:3101\n'] });
  const r = await awaitLogLine(c.logs, NEEDLE, c.opts);
  assert.equal(r.armed, false);
  assert.equal(r.armed === false && r.captured, true, 'output was captured, so captured must be true');
  assert.equal(c.elapsed() >= 10_000, true, 'it gave up before the timeout');
});

test('A4. never arrives and NOTHING was captured: captured=false, so the blame is capture, not NODE_OPTIONS', async () => {
  const c = fakeChild();
  const r = await awaitLogLine(c.logs, NEEDLE, c.opts);
  assert.equal(r.armed, false);
  assert.equal(r.armed === false && r.captured, false,
    'an empty buffer was reported as evidence about the require; next start prints a banner regardless, so it is not');
});

test('A5. the needle matches inside a larger chunk, not only a whole line', async () => {
  const c = fakeChild({ initial: ['noise before ' + NEEDLE + ' noise after'] });
  assert.equal((await awaitLogLine(c.logs, NEEDLE, c.opts)).armed, true);
});

test('A6. CONTROL: the needle actually discriminates - a full buffer without it is not armed', async () => {
  const c = fakeChild({ initial: ['> Ready on http://localhost:3101\n', '[fail-once] loaded\n', 'armed\n'] });
  const r = await awaitLogLine(c.logs, NEEDLE, c.opts);
  assert.equal(r.armed, false, 'a buffer holding neighbouring strings ("[fail-once] loaded", "armed") was read as armed');
  assert.equal(r.armed === false && r.captured, true);
});

test('A7. timeoutMs 0 still takes one look and does not hang', async () => {
  const present = fakeChild({ initial: [ARMED_CHUNK] });
  assert.equal((await awaitLogLine(present.logs, NEEDLE, { ...present.opts, timeoutMs: 0 })).armed, true,
    'a line already present was missed because the timeout was zero');
  const absent = fakeChild();
  const r = await awaitLogLine(absent.logs, NEEDLE, { ...absent.opts, timeoutMs: 0 });
  assert.equal(r.armed, false);
  assert.equal(absent.sleeps(), 0, 'it slept on a zero timeout');
});
