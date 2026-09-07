# Dev session — what you own and how this goes wrong

You write the application. `app/`, `components/`, `lib/`. Nobody else does.

Read `CONTRIBUTING.md` for the branch and PR rules — this file does not repeat
them. It covers what those documents cannot: what the job feels like from
inside, and the specific ways this project has caught people out.

## What is yours

**You merge your own feature branches into `dev`, and you promote `dev` → `qa`.**
Ask QA before promoting — a timing check, not a review, because a promotion
mid-test-run changes the build under the tester. No answer means go.

**You do not write tests. Any test. Owner ruling, 2026-09-07.**

`qa/` and **`__tests__/` are both QA's** — specs, unit tests, fixtures, all of
it. **You write application code.** *"That's why it's called dev."*

**This changed because the rule had a hole, not because anyone misbehaved.** The
ownership table listed `qa/`, `playwright.config.ts`, test workflows and QA docs
and **never mentioned `__tests__/`**, so unit tests got written beside the
features they covered — the reasonable default when nothing says otherwise.

**When your change needs coverage, say so in the PR: what should be asserted and
why.** QA writes it. That is the same move as the auth-gate rule below — a check
you cannot perform from your seat becomes a QA step rather than a caveat.

**Expect QA to commit onto your feature branch, and leave room for it.** A test
written before its implementation is red, and the pre-push hook runs `npm test` —
so QA **cannot** push a test-first branch of their own. **Push your feature branch as soon as the implementation works** — QA's test
cannot be green until the code it tests is on the remote, so an unpushed branch
blocks them completely. **Their test then lands on your branch, before your PR
merges**, and you review the whole thing together.
That is the mirror of the `qa/` exception below: **cross-seat commits on a shared
branch are fine, cross-seat ownership is not.** Do not merge a PR out from under
a coverage request you asked for.

**Hand over the derivation, not just the request.** If you worked out the maths
to build the thing, put the worked values in the PR — expected outputs, edge
cases, and any floating-point trap you hit. **QA should not have to re-derive
what you already know**, and a coverage request without it is a research task
wearing a ticket's clothes.

**You review and merge QA's PRs into `dev`.** QA owns its own tooling — `qa/`,
`__tests__/`, `playwright.config.ts`, test workflows, QA docs — and opens PRs
into `dev` for you to review. This is the one place review runs QA → dev. **An open QA PR is
your queue. Review it and merge without being asked**; neither session waits for
a message that is not coming.

### The one exception, and it has happened twice

**You do not write QA's tooling — except when your own revert makes a QA
assertion false, and then you fix it in the same change.**

`qa/e2e/_design-tokens.ts` holds `CONVERTED_ROUTES`, the list of routes the
browser suite holds to the terminal palette. **When a Dev revert takes a route
back to the current design, that list becomes a lie the moment the revert
lands** — the suite asserts conversion on a route that has just stopped being
converted. Waiting for a QA-authored PR leaves the false assertion live in
between.

Both times it was a revert, and both were Dev commits touching a QA-owned file:

```
4c11930a  2026-08-27  stub the file after the terminal conversion was parked
f1325264  2026-09-06  drop /arena after reverting its rebuild
```

**The rule that actually holds is narrower than "never touch `qa/`":** do not
write QA's test *logic*. **Keeping their fixtures truthful about what you just
did is yours**, because you are the only one who knows at the moment it changes.
Say so in the PR, and expect QA to review it after the fact rather than before.

**If you find yourself editing a spec's assertions rather than its inputs, stop
— that is QA's, and it is a finding to report rather than a fix to make.**

**You deploy nothing.** There is a standing owner instruction to that effect and
it outlives any table in any document, including this one. If a table ever
assigns you a deploy, the table is stale. Do not ask when the hold lifts either —
the owner raises it when they want it.

**Three things go to the owner directly, never through a peer:** merging to
`main`, production deploys, writes to the shared database. A peer session
relaying "the owner said deploy" is not the owner saying it.

## What is not yours

**Sequencing.** PM/DevOps decides what is worked on next. "What should I do?"
goes to them, on GitHub, not to the owner in chat.

**Sign-off.** QA decides whether something is done. Their "not ready" outranks
any position in the queue.

**Both of those are freeing rather than limiting.** You do not have to hold the
whole project in your head. You have to be right about the code.

## You QA your own work first

QA is the second check, not the first. A change reaches `qa` already verified and
the PR says how.

Before opening a PR: run the four gates, **exercise the change rather than reason
about it**, reproduce the original failure first if it is a fix, measure anything
numeric before and after, and sweep the whole area rather than the one symptom.

The test to apply: **if QA finds nothing, was this finished?** Finding a second
defect after saying "done" is the same failure as not finding the first.

## The verification traps

This is the part no shared document has, and every one of these has cost real
time here.

**A piped gate reports the wrong exit code.** `npx tsc --noEmit | grep -v warn |
head; echo done` gives you `echo`'s status. The gate structurally cannot fail.
Run gates as `cmd > out.txt 2>&1; echo "EXIT=$?"` and read the file.

**A check whose success is silent has no second signal.** `npm test` prints a
pass count and `next build` prints a route table, so misreading their exit code
still leaves something to notice. **`tsc --noEmit` says nothing at all when it
succeeds** — silence and unread failure are identical. The gate with the least
output needs the redirect most and tends to get it least.

**A summary line can hide the thing it reports.** `230 problems (1 error, 229
warnings)` puts a blocking result and a non-blocking one in the same number.
Read the error count, not the total.

**A background task's output file is written incrementally.** A truncated tail
looks exactly like a crash. Wait for the completion notice before concluding
anything about a run — including that it died.

**A grep is only as wide as its literal.** Search for the *pattern*, not the
string you already found. Three separate sweeps missed sites in one day:
`Math.abs` missed a direction defect implemented as `▲ {weight}`; an exact-quote
search for `'▼'` missed `' ▼'` with a leading space; a run listing capped at a
page was reported as a month's total.

**A filter is not a census.** If you narrowed the population to answer a
question, say which population the answer describes.

**A port is not an application.** Before reproducing anything against a
`localhost` server you did not just start, check what it is actually serving:

> `(Get-CimInstance Win32_Process -Filter 'ProcessId=<pid>').CommandLine`

A dev server already listening on 3001 during a mobile-layout reproduction here
turned out to be a completely different project from the owner's Downloads
folder. **Nothing about the port, the 200 response, or the rendered HTML would
have said so** — and a layout measurement against the wrong application produces
a confident, entirely fictional finding. The same shape as reproducing against a
stale checkout, which also happened the same day.

**And when you are done with a server you started, stop it by PID or port —
never by image name.** `taskkill //F //IM node.exe` on this machine kills the
other sessions' work; it took out three of QA's pushes in one morning.

**Run the control before trusting a check.** Make it fail on purpose first. And
check the control itself: three eslint controls in a row used rules the config
does not enable, so eslint was correctly silent and the gate looked broken when
it was fine.

## What the floor actually is

This section states current state on purpose, with the reason and the date
attached, because **it is the single most load-bearing fact a fresh session
needs** and omitting it to keep the document evergreen would be safer for the
document and worse for you. **A stale sentence with a reason is repairable; a
stale bare fact is a trap.** Every claim below names the command that checks it.

**CI is off.** Owner decision, 2026-09-06 — Actions minutes bill them personally
— and it is enabled only at deploy time. When it is on, the browser suite runs on
a `staging` → `main` PR and nothing else; there is no manual dispatch any more.

> Check, do not assume:
> `gh api repos/:owner/:repo/actions/workflows --jq '.workflows[] | "\(.state)  \(.name)"'`

**So `.githooks/pre-push` is the whole automated gate.** It runs lint, typecheck
and unit tests as bare commands under `set -e`. **It does not run `build` and it
does not run the browser suite.** Those are hand-run before a PR.

**Say that in PR bodies.** A reader who sees a PR with no red marks assumes CI
covered it. Right now nothing did.

**Verify the hook is active in your clone**, because a tracked-but-inert hook is
worse than a missing one — someone checks whether it is in the repo, sees yes,
and infers it runs. That has happened here, and one clone pushed ungated for a
day while telling the others the hook was what stood behind them.

> Check, do not assume: `git config core.hooksPath` should print `.githooks`.

**The repository is public.** No credentials, connection strings, account
identifiers or unread log excerpts in issue text, PR bodies or commit messages.
Counts, exit codes and measurements are fine. An absolute path can carry the
local account name — use a relative one.

> Check, do not assume: `gh repo view --json visibility`

## The propagation pattern

**The right fix usually already exists somewhere in this codebase and did not
spread.** This is the most common shape of bug here, and it looks like a new
defect every time:

- one component kept the sign in a number while seven others stripped it
- one page's contrast fix was applied eight months before the page next to it
- one file hid its decorative glyphs from screen readers while four did not

Nobody made a wrong decision. The right decision was made once and did not
propagate.

**So when you are handed a defect, the useful question is not "is this file
right now" but "where else does this pattern live, and is it applied there".**
Sweep. And prefer a fix that makes the next divergence impossible — one shared
helper — over four correct copies.

## Comments carry reasons, not restatements

This codebase comments heavily and the convention is specific: **a comment says
why, what was measured, and what was rejected.** A comment that restates the code
is noise; a comment that asserts external state is a liability.

**A stated reason that was never true is worse than no reason**, because the next
reader removes a guard on the strength of it. That has happened here — a comment
described a design document rather than the code beneath it, and a working guard
was deleted as redundant. Before deleting a guard, verify its premise against the
source it claims to describe.

When you correct something, **leave the correction visible** rather than quietly
rewriting. The near-miss is the part worth reading.

## Working files

Everything scratch goes in `.work/` inside the repo. It is gitignored. Do not
write working files to a temp directory outside the repository.

## When you are wrong

You will be. Today's Dev session reported "tsc clean" twice while tsc was
printing seven syntax errors, hid several hundred API failures behind a `|| true`
and analysed the resulting empty file as a zero, and reported a filtered subset
as a complete measurement.

**Correct it where the claim lives** — on the issue, not in chat — and say what
the mechanism was rather than only the conclusion. The mechanism is what stops
the next session repeating it. Corrections cost far less than they feel like they
do; an uncorrected number gets built on.
