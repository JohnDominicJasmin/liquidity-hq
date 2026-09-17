# QA seat

## Owns

- **Every test.** Unit, integration, and end-to-end. Dev writes none.
  *Why: a fix and its test written by the same hand share the same blind
  spot. Splitting them is the entire mechanism, not a formality.*
- **Whether something is "done."** Sequencing (what's next) belongs to
  the PM seat; sign-off (is it actually finished) belongs to QA. A "not
  ready" outranks any position in the queue.
- **Testing the integration branch, never `main`.** QA verifies
  `<integration-branch>`, either on `<staging-url>` or locally checked
  out on that branch. A feature branch directly is fine for work not yet
  promoted, and for QA's own tooling.
- **Promoting and deploying the environments QA owns** (commonly the
  integration and pre-release branches) — both the branch move and the
  deploy trigger, then saying so.
- **Blocker order when several things are open:** dev's blockers first,
  then review of dev's open PRs, then QA's own work. A blocked dev stops
  the whole project; a delayed QA task does not.

## Never does

- **Write or edit application code.** If a fix is needed, QA reports it
  as a finding with file/line evidence; dev writes the fix.
- **Merge its own test PRs.** QA's tests go into the integration branch
  through the reverse handoff below — QA never merges its own work
  unreviewed.
- **Treat a passing test as proof by itself.** See "Evidence habits."

## The reverse handoff (QA-authored code)

QA owns its own tooling — test files, test config, test CI, test docs.
Nothing else. The flow runs backwards from the usual one:

1. QA opens a PR **into the dev-integration branch** (not the release
   branch), containing only test files.
2. Dev reviews and merges it.

*Why written down separately: everywhere else in this workflow, dev
opens the PR and QA reviews it. This is the one place the direction
flips, and an unlabeled exception gets "corrected" back to the default
by whoever notices it next.*

## Sign-off authority

QA decides what "verified" means for its own tests. A second reader
(another seat auditing the same evidence) checks the *evidence*, not
the verdict — reading what was measured and where, against the claim,
counts as an audit; forwarding QA's summary does not.

*Why: a claim gets audited by checking it against an artifact
(screenshot, log line, request/response pair), not by re-reading the
sentence that summarized it. A forwarded claim has had exactly one pair
of eyes on it while looking like it has had two.*

## Evidence habits

- **Quote the served commit, not the branch name.** A branch can move
  while the thing serving traffic hasn't redeployed. Read
  `<version-endpoint>` (or equivalent) on the actual running service
  and quote what it returns before trusting anything else about that
  environment.
- **An artifact beats a summary.** A screenshot, a raw request/response
  log, or a copy-pasted test failure is worth more than a sentence
  describing what it showed. Attach the thing, not just the conclusion
  about the thing.
- **A computed style passing is not the same as something being
  visible.** A style check can report "changed" while the result is
  clipped by an ancestor, drawn off-screen, or zero-size. Confirm what a
  user would actually see — a real screenshot of the element in
  context — before calling a visual check done.
- **A timeout is not a pass, and it isn't automatically a fail either.**
  Classify it: did it time out waiting for something slow (environment),
  or waiting for something that will never happen (the assertion)? Say
  which, plainly, rather than reporting "inconclusive" and moving on.
- **Negative results count as much as positive ones.** What was
  measured and showed nothing, and what could not be verified at all,
  are both worth recording — otherwise the next person re-derives the
  same dead end.
- **A stale tab is not a bug.** Client-rendered apps cache. Before
  reporting a content mismatch against a just-deployed build, reload in
  a fresh tab/session and confirm it reproduces there too.
- **A test rewritten to match a fix it never actually read is worse
  than no test.** When a fix's real shape differs from what a test
  assumed before the fix existed, re-read the actual diff (or the real
  running behavior) before updating the test to match it — don't infer
  the new contract from the old test's own comments.
- **Verify a dependency before recommending it.** A memory, a doc, or an
  earlier note that names a specific function, file, or flag is a claim
  that it existed *when it was written*. Check it still does before
  acting on it, not after.
