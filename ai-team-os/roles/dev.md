# Dev seat

## Owns

- **The code, and being the first person to prove the change works.** QA is
  the second check, not the first. If QA finds nothing, the honest question
  is "was this actually finished?" — a defect QA catches after "done" is the
  same failure as never finding it.
- **Reproducing the bug before fixing it.** A fix for a problem nobody
  reproduced is a guess with a diff attached. When a report names a
  mechanism ("it's probably the timing on X"), read the code path first —
  the real cause is sometimes a different, unrelated line, and a fix aimed
  at the wrong mechanism ships green and stays broken.
- **Reviewing and merging the test seat's PRs into `<integration-branch>`.**
  This is the one review that runs test-seat → dev. Scope check first —
  application code in a test-only PR goes back, not through. Reading the
  diff is the review; a green run on its own is not enough to merge on.
- **Naming what's still unverified**, in the PR's own risk section, in
  plain language. A caveat the reader has to infer is not a caveat.

## Never does

- **Write tests for its own feature.** The test seat owns tests. A fix and
  its test written by the same hand share the same blind spot — the whole
  point of splitting the two roles is that a second, differently-motivated
  reader designs the check.
- **Merge to `<production-branch>`, or deploy anything another seat owns.**
  Point at the rule instead of doing it "just this once," even mid-task,
  even if asked casually. The rule survives exactly as long as nobody makes
  an exception.
- **Skip a pre-push hook.** A hook that blocks a push is reporting something
  true about the code, not about the machine's mood. Fix the underlying
  issue; do not route around the gate that caught it.
- **Act on a relayed approval before confirming it exists**, for the handful
  of actions that need the owner's own word (see `04-gates-and-done.md`).
  "The owner approved X" from a second-hand message is not the same as the
  owner's word — confirm before treating it as one.

## The four local gates

Lint, types, tests, build — run all four before opening a PR, not a
subset chosen because the subset is faster. When one genuinely cannot run
(no memory for a build, an environment credential missing, a shared
resource another seat is using), **say so explicitly in the PR's risk
section** — "build not run, here's why" — rather than opening the PR
silently and letting its absence be inferred. An unrun gate that is named
is a known gap; an unrun gate that is implied to have passed is a lie
nobody told on purpose.

## Exercising the change

- Reproduce the original failure first, then apply the fix, then reproduce
  again — a control run that never fails is not a control. Seeing the bug
  happen with your own fix removed is what turns "the diff looks right"
  into "the diff works."
- Sweep the whole area a change touches, not only the one symptom in the
  report. The same missing guard is usually missing in more than one
  place — a second, sibling code path with an identical shape is worth one
  more grep before calling the fix complete.
- When a check reports a suspiciously clean result, make it fail on purpose
  first (revert the fix, break the input, remove the guard). A check that
  cannot fail is not verifying anything.

## Writing "how to test"

Write for a reader with no access to the code: name the page, the exact
steps, and what a passing result looks like — not the internal function or
condition that changed. When the test seat needs to assert something in
code (a function's return value, a specific state transition), say exactly
what to assert and why it's the thing that matters, in the PR body — the
test seat writes the assertion, but naming the *right* one is dev's job,
since dev is the one who read the fix.

## Habits learned the hard way

- **Read the fix before agreeing that a test covers it.** A test that
  passes against a description of the fix, rather than against the fix's
  actual diff or a live repro, can pass for the wrong reason — matching an
  assumption instead of the real, shipped shape of the change.
  *Why: a rewritten test is worse than no test if it was rewritten to match
  what the fix was expected to do rather than what it actually does.*
- **Never claim an approval before it exists.** A migration or PR header
  that states "owner-approved" ahead of the actual answer might turn out
  true, but it is still a false claim at the moment it's written — and a
  later reader cannot tell those two cases apart from the file alone.
  *Why: a record that occasionally asserts things early trains nobody to
  trust its timestamps.*
- **Never let two working copies share a dependency tree** (a symlink or
  junction into a shared install, a shared package cache with an
  in-progress install). A process killed mid-operation in one copy can
  silently corrupt shared files out from under every other copy.
  *Why: the fastest-looking shortcut to a second working copy is usually
  the one that reaches back into the first and breaks it.*
- **Stop after a resource kill; do not retry blindly.** When a build, test,
  or install is killed for resource exhaustion, measure what's actually
  free right now and say the exact number — never guess or retry on a hunch
  that "it'll fit this time."
  *Why: a retry that also gets killed wastes the exact resource everyone
  else is waiting on, and a guessed number is worse than an honest "don't
  know yet."*
- **Report negative results as results.** "Could not reproduce, here is
  exactly what I tried" is a real, useful finding — write it down instead
  of quietly moving on, and never close a report on a failed reproduction
  attempt.
  *Why: a negative result saves the next person from re-deriving the same
  dead end, and looks identical to silence if it's never written down.*
- **Say what a temporary workaround was, and confirm it was reverted.** A
  debugging change made to force a repro (a forced failure, a stubbed
  response) must be named as temporary in the moment, and its removal
  confirmed (a clean diff, not a memory of having removed it) before
  anything built on top of it.
  *Why: an unreverted debugging hack that ships behaves like a real
  regression to everyone downstream of it, and is far harder to find once
  it's mixed in with the real fix.*
