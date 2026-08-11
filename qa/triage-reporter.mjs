/**
 * Groups a run's failures BY CAUSE and prints the count, at the end of the run.
 *
 * ── WHY THIS EXISTS ────────────────────────────────────────────────────────
 *
 * A spec that walks every route reports one slow response once per assertion, so
 * a single cold container arrives as many separate-looking failures. On
 * 2026-08-11 one 90-second navigation timeout surfaced as SEVEN failures across
 * two spec files and read as four distinct problem areas.
 *
 * `ENV_FAILURE` in `_shared.ts` fixed the labelling half of that. It did not fix
 * the counting half, and on 2026-08-12 I proved it: I triaged the same 10-failure
 * run as "7 environmental, 3 real", stopped grouping once the pattern had
 * explained seven, and filed the eighth as a WCAG defect. Dev spent an afternoon
 * measuring it. It was the eighth timeout.
 *
 * So the note telling me to count is not enough - I wrote that note and then did
 * not count. This does the counting, every run, whether or not anyone remembers.
 *
 * ── WHAT IT DELIBERATELY DOES NOT DO ───────────────────────────────────────
 *
 * It does not decide what is real. Grouping is not diagnosis: two failures with
 * identical text can still have different causes, and a real regression can hide
 * behind an environmental one on the same route. It prints the grouping and the
 * count so a human reads a shape instead of a list - nothing more.
 *
 * It also never suppresses or downgrades a failure. Exit status is untouched, and
 * a green run prints nothing at all.
 *
 * ── ONE GOTCHA THAT WOULD OTHERWISE MAKE THIS USELESS ──────────────────────
 *
 * `--reporter=list` on the command line REPLACES the config's reporter list, so
 * this never runs. That matters because `--reporter=list` is the habitual
 * invocation - it is in most of the "How to test (QA)" blocks in this repo, and
 * it is what I typed all day on 2026-08-12 while making the exact mistake this
 * file exists to catch.
 *
 * Either drop the flag and let the config apply, or name both:
 *
 *     npx playwright test <spec> --reporter=list,./qa/triage-reporter.mjs
 */

const ENV_FAILURE = 'ENVIRONMENT';

/** Collapse an error message to the thing that varies least: its cause. */
function causeOf(message) {
  const first = (message || '').split('\n')[0].trim();

  if (first.includes(ENV_FAILURE)) return `${ENV_FAILURE}: service did not answer`;

  /* Playwright's own shapes, before falling back to the raw first line. Each
     strips the part that changes per test - the route, the selector, the
     numbers - so the same underlying problem groups together. */
  if (/Timeout \d+ms exceeded/.test(first))        return 'TimeoutError: navigation or locator timed out';
  if (/ECONNREFUSED|ERR_CONNECTION/.test(first))   return 'connection refused';
  if (/toHaveCount/.test(first))                   return 'assertion: toHaveCount';
  if (/toHaveClass/.test(first))                   return 'assertion: toHaveClass';
  if (/toBeVisible/.test(first))                   return 'assertion: toBeVisible';

  return first.slice(0, 100) || 'unknown';
}

export default class TriageReporter {
  constructor() {
    this.failures = [];
  }

  onTestEnd(test, result) {
    if (result.status !== 'failed' && result.status !== 'timedOut') return;
    const message = result.errors?.[0]?.message ?? result.error?.message ?? '';
    this.failures.push({ title: test.title, file: test.location?.file ?? '', cause: causeOf(message) });
  }

  onEnd() {
    if (this.failures.length === 0) return;

    const byCause = new Map();
    for (const f of this.failures) {
      if (!byCause.has(f.cause)) byCause.set(f.cause, []);
      byCause.get(f.cause).push(f);
    }

    const envCount = this.failures.filter(f => f.cause.startsWith(ENV_FAILURE)).length;
    const ordered = [...byCause.entries()].sort((a, b) => b[1].length - a[1].length);

    const out = [];
    out.push('');
    out.push('─'.repeat(72));
    out.push(`TRIAGE  ${this.failures.length} failure(s), ${byCause.size} distinct cause(s)`);
    if (envCount) {
      out.push(`        ${envCount} carry the ${ENV_FAILURE} prefix - one cause, not ${envCount}.`);
    }
    out.push('─'.repeat(72));

    for (const [cause, items] of ordered) {
      out.push(`  ${String(items.length).padStart(3)} x  ${cause}`);
      for (const i of items) out.push(`         ${i.title}`);
    }

    out.push('');
    out.push('  Report the DISTINCT CAUSE COUNT, not the failure count. A run reported');
    out.push('  as "10 failures" and a run reported as "3 problems, one environmental"');
    out.push('  are different reports, and only the second is actionable.');
    out.push('─'.repeat(72));
    out.push('');

    // eslint-disable-next-line no-console
    console.log(out.join('\n'));
  }
}
