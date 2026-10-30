/* #1631: THE DAILY DEEP RESEARCH CHECK MUST TELL "NO VERDICT" APART FROM "COULD NOT ASK".
 *
 * `qa/tools/regress/deep-verdict-monitor.mjs` makes one billed Deep call and asserts a PARSEABLE
 * VERDICT rather than HTTP 200 — because today's failures happen to return 502, so a status check
 * would pass the moment the shape changed to a 200 carrying an unparseable body.
 *
 * WHAT THIS FILE GATES IS THE OTHER HALF, and it is a defect the monitor shipped with. Every
 * non-parseable outcome exited 1, "the paid feature is broken", including outcomes that say nothing
 * about the feature:
 *
 *   - **429 RATE_LIMIT** — this account has spent its ten daily Deep reads. The product is fine.
 *   - **401 / 403** — the test credentials expired. The product is fine.
 *   - **503 FEATURE_DISABLED** — somebody switched the Arena off on purpose. The product is fine.
 *   - **a timeout** — a Deep call takes minutes and the free-plan service sleeps.
 *
 * A monitor that reports those as a regression sends the next reader hunting a defect that is not
 * there, and the cost is not the wasted morning: **a check that cries wolf gets switched off**, and
 * then the protection is gone on the day it was needed. That is this project's own rule about a
 * check whose false alarm removes a protection, applied to the check I wrote.
 *
 * THE DEFAULT STAYS "BROKEN". Anything that is not a parseable verdict and not one of the
 * enumerated can-not-run conditions exits 1, so an unhandled 500 or a body nobody predicted
 * surfaces loudly instead of being reclassified as weather. D3 pins that, because it is the half an
 * over-eager fix would break.
 *
 * NO NETWORK AND NOTHING BILLED: the classifier is a pure function and the route's codes are read
 * from source. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { ROOT } from './_appPath.mts';
import { classifyOutcome, CANNOT_RUN_CODES } from '../qa/tools/regress/deep-verdict-classify.mjs';

const KNOWN_CODES = [...Object.keys(CANNOT_RUN_CODES), 'BAD_ANSWER'];

/**
 * CODES THE CLASSIFIER KNOWS BEFORE THE ROUTE RETURNS THEM, with the reason each one is here.
 *
 * This is the escape D5's own failure message already offers - *"Remove it, or say in the file why
 * it is still expected"* - made explicit rather than left as prose in a commit.
 *
 * WHY IT HAS TO EXIST. `CONTRIBUTING.md` → *When QA writes code* has QA loosen a pin FIRST so dev
 * is not blocked, then tighten after. Teaching the classifier a code dev has not shipped yet is
 * exactly that, and without this list the orphan half of D5 goes red on `dev` the moment I do -
 * which would block dev with a red suite in the act of unblocking them.
 *
 * IT IS NOT A WAIVER AND IT MUST NOT BECOME ONE. An entry here says "a specific change is in
 * flight", so it is removed in the commit that tightens, and the cap below keeps it from quietly
 * turning into a list of codes nobody can account for.
 */
const ARRIVING_WITH: Readonly<Record<string, string>> = {
  STALE_CLIENT: '#1631 item 5 - dev\'s branch makes /api/grok build the prompt server-side and refuse the old client-built shape. Remove this entry in the commit that tightens, once the route returns it.',
};

test('D1. a parseable verdict is the only exit 0, whatever the status says', () => {
  for (const status of [200, 201, 502]) {
    const got = classifyOutcome({ status, parseable: true });
    assert.equal(got.exit, 0, `a parseable verdict at HTTP ${status} must pass`);
  }
  /* The positive control for every refusal below: without this, a classifier stuck on "cannot run"
     would satisfy D2 and D4 completely. */
  assert.equal(classifyOutcome({ status: 200, code: undefined, parseable: true }).label, 'PASS');
});

/* HARDCODED, NOT READ FROM THE CLASSIFIER. D2 used to iterate `Object.keys(CANNOT_RUN_CODES)`, which
 * means deleting an entry did not make D2 fail — it made D2 stop testing it. A mutation run found
 * that: dropping RATE_LIMIT left D2 green (D5 caught it, so the suite was still red, but the cell
 * whose job it is said nothing). A cell that derives its cases from the thing under test can only
 * ever confirm what that thing already claims. This list is the contract, written out. */
const MUST_BE_CANNOT_RUN = [
  'AUTH_REQUIRED', 'FEATURE_DISABLED', 'PLAN_UNKNOWN', 'RATE_LIMIT', 'COIN_LOCKED', 'COIN_REQUIRED',
];

test('D2. the can-not-run conditions are exit 2 and say so in the reason', () => {
  for (const code of MUST_BE_CANNOT_RUN) {
    assert.ok(
      Object.prototype.hasOwnProperty.call(CANNOT_RUN_CODES, code),
      `${code} must be a can-not-run condition and the classifier no longer lists it. Reporting it as ` +
      'a regression sends someone hunting a product defect that is not there.',
    );
  }
  for (const code of MUST_BE_CANNOT_RUN) {
    const got = classifyOutcome({ status: 503, code, parseable: false });
    assert.equal(got.exit, 2, `${code} must NOT be reported as the feature being broken`);
    assert.equal(got.label, 'CANNOT RUN');
    assert.match(got.reason, new RegExp(code), `the reason must name ${code} - a scheduler shows the first line`);
  }
  /* The status-only paths, for the routes that carry no code. */
  for (const status of [401, 403, 400, 429]) {
    assert.equal(classifyOutcome({ status, parseable: false }).exit, 2, `HTTP ${status} is not a product failure`);
  }
  /* A 400 is the one that will fire when the request contract moves under this tool (#1631 item 5
     hands prompt assembly to the server), so it has to say THAT rather than blame the product. */
  assert.match(
    classifyOutcome({ status: 400, parseable: false }).reason, /THIS TOOL is out of date/,
    'a refused body must point at the tool, not the feature',
  );
});

test('D3. BAD_ANSWER is a product failure, and so is anything unrecognised', () => {
  /* The line that must never be softened. BAD_ANSWER is the honest refusal #1651 added: the model
     was called, billed and refunded, and produced nothing the app accepts. It IS the 2026-10-23
     incident this monitor exists for. */
  const bad = classifyOutcome({ status: 502, code: 'BAD_ANSWER', parseable: false });
  assert.equal(bad.exit, 1, 'BAD_ANSWER must stay a FAIL - it is the regression this check was built to catch');
  assert.match(bad.reason, /the model was called/);

  /* And the open end: an unhandled 500, an unknown code, or a 200 with a body nobody predicted. A
     classifier that defaulted these to 2 would be silent on the day something new breaks. */
  assert.equal(classifyOutcome({ status: 500, parseable: false }).exit, 1, 'an unhandled 500 must fail loudly');
  assert.equal(classifyOutcome({ status: 200, parseable: false }).exit, 1, 'a 200 with no verdict must fail loudly');
  assert.equal(
    classifyOutcome({ status: 503, code: 'SOMETHING_NEW', parseable: false }).exit, 1,
    'an UNKNOWN code must fail rather than be assumed benign - a new code is a change nobody has read yet',
  );
});

test('D4. a request that never completed is exit 2, not a verdict about the feature', () => {
  const got = classifyOutcome({ parseable: false, networkError: 'TimeoutError: The operation was aborted' });
  assert.equal(got.exit, 2, 'a timeout says nothing about Deep Research');
  assert.match(got.reason, /did not complete/);
  /* It must win over whatever status happens to be lying around. */
  assert.equal(classifyOutcome({ status: 502, code: 'BAD_ANSWER', parseable: false, networkError: 'x' }).exit, 2);
});

test('D5. CONTROL: every typed code the route can return is one this classifier knows', () => {
  /* THE CELL THAT KEEPS THIS HONEST OVER TIME. The classifier's whole value is that it reads
     `/api/grok`'s typed `code`, so a code the route gains and this file has not been told about
     would be classified by the catch-all - as a product failure. That is the SAFE direction, which
     is exactly why it would go unnoticed: a new benign code would be reported as a regression and
     somebody would chase it.
     Dev is adding a distinct code for the refused legacy prompt shape (#1631 item 5). This cell is
     what will tell me, rather than a false alarm at 6am. */
  const src = readFileSync(path.join(ROOT, 'app/api/grok/route.ts'), 'utf8');
  const found = [...new Set([...src.matchAll(/code:\s*'([A-Z][A-Z_]+)'/g)].map((m) => m[1]))].sort();

  assert.ok(
    found.length >= 7,
    `only ${found.length} typed codes found in app/api/grok/route.ts (${found.join(', ') || 'none'}). ` +
    'There were 7 on 2026-10-30 - AUTH_REQUIRED, FEATURE_DISABLED, PLAN_UNKNOWN, COIN_REQUIRED, ' +
    'COIN_LOCKED, RATE_LIMIT, BAD_ANSWER. A lower count means this scan is broken, so the agreement ' +
    'below would be a false pass. ' +
    'THE SEVENTH IS WHY THIS CELL EXISTS: I enumerated six by reading, and AUTH_REQUIRED sits on a ' +
    'line of its own away from its status, so a grep pairing the two missed it. The scan found it on ' +
    'the first run.',
  );

  const unknown = found.filter((c) => !KNOWN_CODES.includes(c));
  assert.deepEqual(
    unknown, [],
    `app/api/grok/route.ts returns ${unknown.join(', ')}, which deep-verdict-classify.mjs does not ` +
    'know. Decide what each one means and add it: a can-not-run condition goes in CANNOT_RUN_CODES, ' +
    'a genuine product failure stays on the catch-all. Until then the monitor reports it as a ' +
    'regression, which is loud but wrong.',
  );

  /* The mirror: a code this classifier handles that the route no longer returns is dead weight, and
     dead weight in a classifier is how a stale rule outlives the thing it described. */
  const orphaned = KNOWN_CODES.filter((c) => !found.includes(c) && !(c in ARRIVING_WITH));
  assert.deepEqual(
    orphaned, [],
    `deep-verdict-classify.mjs handles ${orphaned.join(', ')}, which app/api/grok/route.ts no longer ` +
    'returns. Remove it, or add it to ARRIVING_WITH with the change it is waiting for.',
  );

  /* THE LIST OF EXEMPTIONS IS ITSELF CHECKED, because an exemption list nobody audits is how a
     temporary allowance becomes permanent. Two rules: it stays small, and an entry whose code HAS
     arrived is dead weight that must be removed in the tightening commit - so the cell fails once
     the change lands, which is the reminder. */
  assert.ok(
    Object.keys(ARRIVING_WITH).length <= 2,
    `${Object.keys(ARRIVING_WITH).length} codes are exempted as "arriving". That is a backlog, not a handoff.`,
  );
  const landed = Object.keys(ARRIVING_WITH).filter((c) => found.includes(c));
  assert.deepEqual(
    landed, [],
    `${landed.join(', ')} is in ARRIVING_WITH but app/api/grok/route.ts now returns it. The change ` +
    'landed - remove the entry. This is the tightening step, and this assertion is what asks for it.',
  );
});
