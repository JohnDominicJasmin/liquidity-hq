# QA report shapes

Four recurring shapes. Copy the one that fits, fill the placeholders,
delete what doesn't apply. Every shape leads with what was actually
measured, not a conclusion about it.

---

## 1. "How to test" — what to hand QA when you open a PR

Write it for someone who did not write the fix. Name the page/route and
what to look at, not the branch.

```
## How to test (QA)
1. <exact command or URL to reach the state under test>
2. <what should be true, stated as an observable fact - "the banner
   shows X", not "the bug is fixed">
3. <any state that needs setting up first - a forced failure, a
   specific fixture account, a specific viewport>
4. <what should be UNCHANGED - the thing that must not regress>
```

*Why this shape: "the bug is fixed" isn't testable. "The banner reads
X" is.*

---

## 2. Per-step pass/fail — the standard verification report

```
Verified against <integration-branch> at <served commit, quoted from
<version-endpoint>, not the branch name>.

- <step 1 description> — PASS / FAIL / NOT CONFIRMED
  <one line of evidence: what was measured, or a path to the artifact>
- <step 2 description> — PASS / FAIL / NOT CONFIRMED
  <evidence>
...

Overall: PASS / FAIL / NOT CONFIRMED, <n>/<n> steps.
```

Use **NOT CONFIRMED** rather than forcing a pass or fail when the
evidence is ambiguous (see "timeout is not a pass" in the role doc) —
say what's ambiguous about it, not just that it is.

---

## 3. Stopping-point comment — when parking mid-task

For a pause, a shift change, or handing work to another seat mid-way.

```
Parking here. State:
- <what's done, with the artifact/evidence for each>
- <what's in progress, and exactly where it stopped>
- <what's still open, and why it's still open - blocked on what>
- <anything running that needs to be stopped, or already stopped>

Resume point: <the next concrete action, not "continue testing">
```

*Why "the next concrete action" and not "continue testing": the person
resuming (possibly a fresh session with no memory of this one) needs a
next STEP, not a restatement of the goal.*

---

## 4. Verdict comment — merge / not ready

Post this once a PR has actually been tested, not while it's still
being investigated.

```
Ran <what - test suite / spec / manual check> against <served commit>.

**Verdict: merge.**
<the specific evidence that earns "merge" - not "looks good", the
actual check results>
```

or

```
Ran <what> against <served commit>.

**Verdict: not ready.**
<what specifically is missing or broken, with evidence>
<the concrete, minimal thing that would flip this to "merge" - not
"fix the bug", the actual missing piece: a function to export, a file
to rename, a case to handle>
```

A "not ready" verdict should always name what would close the gap. "Not
ready" with no path forward just moves the blocker without shrinking
it.

---

## Shared rules across all four

- **Quote the served commit**, not the branch name, at the top of
  anything that reports on a live environment.
- **Link or attach the artifact** (screenshot, log excerpt, trace file)
  behind any claim about what rendered or what a request returned - a
  sentence describing it is not the evidence, the thing itself is.
- **A skipped check is not a pass.** If something couldn't be verified,
  say so explicitly rather than omitting the line.
