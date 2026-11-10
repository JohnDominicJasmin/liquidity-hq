/* #2065 / #1263 box 5: a BAD_ANSWER must report the POST-refund usage, never the reserved one.
 *
 * WHY THIS IS A SOURCE INVARIANT AND NOT A BROWSER TEST. #2065's banner tells the customer "This
 * read was not counted". Verifying that claim end to end needs a REAL `502 BAD_ANSWER` from xAI - an
 * empty answer, or a verdict still unreadable after one retry. That cannot be forced, and provoking
 * one costs a billed Deep read per attempt. An intercepted route is no substitute: fulfilling
 * `/api/grok` in the browser means the server never runs, so nothing is reserved and there is no
 * refund to observe. The runtime half that IS cheap - does the client render the label and honour the
 * corrected usage - belongs in an intercept spec and is written separately.
 *
 * So the half that can be pinned deterministically is the one that actually regresses: someone adds a
 * fourth BAD_ANSWER path and returns the reserved `usage`, and the copy starts lying with nothing
 * failing. That is what B2 and B4 catch.
 *
 * B1 IS THE CONTROL AND EVERYTHING DEPENDS ON IT. "Every BAD_ANSWER return refunds" is vacuously
 * true when the matcher finds no returns, so a refactor of the response shape would turn this file
 * green rather than red. Pin the count first.
 *
 * COMMENTS ARE STRIPPED FIRST, and that is load-bearing rather than tidiness: `BAD_ANSWER` appears 8
 * times in the route and only 3 are returns. One (`:495`) is a block-comment line with no `*`
 * prefix, which a naive line-based comment filter misses - mine did, and reported 0 comment
 * occurrences for a file that plainly has one.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const stripTsComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
const route = stripTsComments(readFileSync(join(repoRoot, 'app/api/grok/route.ts'), 'utf8'));

/* Each `return NextResponse.json({ ... code: 'BAD_ANSWER' ... })`, as its own object literal. */
const badAnswerReturns = [...route.matchAll(/return\s+NextResponse\.json\(\s*\{[^{}]*code:\s*'BAD_ANSWER'[^{}]*\}/g)].map(m => m[0]);

test('B1. CONTROL: the BAD_ANSWER returns are still findable - without this every assertion below is vacuous', () => {
  assert.ok(
    badAnswerReturns.length >= 3,
    `found ${badAnswerReturns.length} BAD_ANSWER returns, expected at least 3 (empty answer, unreadable verdict, strict-read refusal). ` +
    'If the response shape moved, re-derive this pin - do NOT delete it, because a 0-match makes B2/B4 pass on a route that refunds nothing.',
  );
});

test('B2. every BAD_ANSWER return reports usageAfterRefund(), so the counter the client shows is the post-refund one', () => {
  badAnswerReturns.forEach((r, i) => {
    assert.match(
      r, /usage:\s*usageAfterRefund\(/,
      /* THE REASON, UPDATED - the assertion was always right but this sentence went stale (Dev Team,
         2026-11-10). It used to say the banner reads "This read was not counted" FULL STOP, which was
         true when written and is not now: #2065 keyed the copy on the server's `refunded` flag, so the
         page says "not counted" only when the refund landed and "This read was counted" otherwise. My
         own `lib/aiUsage.ts` finding is what forced that - `refundUsageColumn` returns null from its
         catch and from any non-PGRST202 error, not only when the migration is missing.
         So the thing this cell protects is one step back from the copy: the client can only pick the
         honest sentence if the response carries the post-refund usage. Report the reserved number and
         BOTH wordings become unreliable, because the counter on screen contradicts whichever one is
         shown. */
      `BAD_ANSWER return #${i + 1} does not report usageAfterRefund(). The client picks its wording from ` +
      `the \`refunded\` flag and its counter from this \`usage\`; returning the RESERVED value makes the ` +
      `number contradict the sentence either way. Return was: ${r.replace(/\s+/g, ' ').slice(0, 180)}`,
    );
  });
});

/* POSITION-AWARE ON PURPOSE, and the first version of this cell was a decoration.
 *
 * It counted `refundUsageColumn(` across the file and asserted the total was at least the number of
 * BAD_ANSWER returns. The route has FOUR refund calls for THREE BAD_ANSWER returns - `:472` refunds
 * on a different path - so 4 >= 3 held, and removing one of the three still gave 3 >= 3. A mutation
 * that deleted a refund PASSED. The global count could not fail on the defect it was written for.
 *
 * THE WINDOW SIZE IS MEASURED, NOT GUESSED. In the comment-stripped source each return's own refund
 * sits 52-54 characters before it, while the nearest refund belonging to a DIFFERENT path is 563
 * back (return #2's nearest neighbour; #1 sees 1070, #3 sees 686). So any window in [55, 562] is
 * both satisfiable by the real code and too tight for one path's refund to vouch for another's. 400
 * sits in the middle of that range. If the route is rearranged so a neighbour falls inside 400, this
 * cell silently weakens - so re-measure those distances rather than widening the window. */
const REFUND_WINDOW = 400;

test('B3. each BAD_ANSWER return refunds on ITS OWN path, not merely somewhere in the file', () => {
  badAnswerReturns.forEach((r, i) => {
    const at = route.indexOf(r);
    assert.ok(at >= 0, 'internal: matched return not locatable');
    const preceding = route.slice(Math.max(0, at - REFUND_WINDOW), at);
    assert.match(
      preceding, /refundUsageColumn\s*\(/,
      `BAD_ANSWER return #${i + 1} has no refundUsageColumn() in the ${REFUND_WINDOW} characters before it - ` +
      'this path refuses a paid read without handing it back, which is the defect PM measured on 2026-10-22 ' +
      '(two refusals took deep_used 1 -> 2 with no answer either time). Do not relax this to a file-wide count: ' +
      'that version could not fail.',
    );
  });
});

test('B5. usageAfterRefund stays honest when the refund did NOT land (returns the reserved count, not a claim)', () => {
  const fn = route.match(/const\s+usageAfterRefund\s*=\s*\([^)]*\)\s*=>([\s\S]{0,220})/);
  assert.ok(fn, 'usageAfterRefund moved: re-derive this pin');
  /* null means the refund did not land (missing migration, or any error). Reporting the refunded
     number there would show a count the user does not have. */
  assert.match(
    fn![1], /refunded\s*===\s*null\s*\?\s*usage/,
    'usageAfterRefund no longer falls back to the reserved usage when the refund did not land, so it would report a count the user does not actually have',
  );
});
