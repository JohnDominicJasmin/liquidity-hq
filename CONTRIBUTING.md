# Contributing — Git Workflow & Naming Convention

This is the shared standard for **both** local clones of this repo: the **dev
folder** (where code is written) and the **QA folder** (where it is tested).

The test it has to pass: **a QA person who cannot read code should be able to
look at a branch name, a commit, or a PR and know what changed and what to
check.** Everything below exists to serve that. Where a rule would slow down
solo work without helping QA, it is explicitly relaxed — see
[Solo / low-ceremony work](#solo--low-ceremony-work).

**This file is the rules. It is not the current state.** For what is live, what
is waiting to ship, and what is blocked on whom, read
[`qa/STATUS.md`](qa/STATUS.md) — one page, kept current by QA, dated at the top.
Picking work back up after a break starts there; this file is where you come
back for how to move it.

---

## 1. Branch naming

```
<type>/<short-kebab-case-description>
```

| Type | Use for |
|---|---|
| `feature` | New user-facing capability |
| `fix` | Something is broken and this corrects it |
| `hotfix` | Urgent production fix, jumps the queue |
| `chore` | Dependencies, config, tooling, housekeeping |
| `refactor` | Internal restructuring, no behaviour change |
| `docs` | Documentation only |
| `test` | Tests only |

**Examples**

```
feature/liquidation-map-mobile-layout
fix/onboarding-font-inconsistency
hotfix/xai-api-loop-cap
chore/self-host-fonts
refactor/market-provider-fetch-order
docs/git-workflow-convention
```

**Rules**

- The description names the **user-facing area or problem**, not an internal
  symbol. `fix/chart-blank-on-pepe` — not `fix/getBars-null-guard`.
- **No ticket numbers.** There is no tracker; a branch must be
  self-explanatory without external context. If we adopt one later, this rule
  changes and this file changes with it.
- Kebab-case, lowercase. Keep it short enough to type, long enough to be
  unambiguous.

---

## 2. Commit messages

[Conventional Commits](https://www.conventionalcommits.org/) format:

```
<type>(<scope>): <short summary>
```

**Types:** `feat`, `fix`, `chore`, `refactor`, `docs`, `style`, `test`, `perf`

**Scope** is the feature area — the part of the product a QA person would name:

`dashboard` · `onboarding` · `correlations` · `arena` · `auth` · `api` ·
`liquidation-map` · `alerts` · `journal` · `settings` · `chart` · `news` ·
`telegram` · `i18n`

### Body — required for anything QA-relevant

Any UI change, behaviour change, or bug fix needs a body:

```
<type>(<scope>): <short summary>

What changed: <plain-language description>
Why: <the problem this solves, or the reason for the change>
Test: <what to check to confirm it works — specific enough for a non-engineer>
```

**Example**

```
fix(chart): show the 1000x scale on PEPE and BONK charts

What changed: The chart toolbar now shows an amber "1000PEPE/USDT" badge on
PEPE and BONK only.
Why: Those two are plotted from Bybit's 1000-token contract symbols, so the
chart axis read 0.00286 while the rest of the app read 0.00000290 for the same
coin — a 1000x difference with nothing on screen explaining it.
Test: Open /arena?coin=pepe — an amber "1000PEPE/USDT" badge should sit left of
the timeframe buttons. Same on ?coin=bonk. Switch to ?coin=btc — the badge
should disappear entirely.
```

### Trailers

Commits authored with AI assistance carry these two trailers, after a blank
line at the very end of the message:

```
Co-Authored-By: Claude Opus 5 <noreply@anthropic.com>
Claude-Session: https://claude.ai/code/session_<id>
```

They are attribution and provenance, not part of the `What changed / Why /
Test` body. Documented here because every commit in this repo already has
them while this file described the format without them — leaving the written
convention and the actual history disagreeing about what a commit looks like.

Older commits show `Claude Opus 5 (1M context)` in the same slot. Do not go
back and rewrite them; match the current form going forward.

**Rules**

- **One logical change per commit.** Do not bundle unrelated fixes. If the
  summary needs an "and", it is probably two commits.
- **No vague messages.** `fix bug`, `update stuff`, `wip`, `changes` are not
  acceptable. If you cannot summarise it in one line, the commit is too big.
- The summary line is imperative and lowercase after the colon:
  `fix(auth): reject expired link codes` — not `Fixed the thing`.

---

## 3. Pull request template

This lives in `.github/pull_request_template.md`, so GitHub fills it in for you
on every PR — you edit rather than remember. The structure:

```markdown
## Summary
<one or two sentences, plain language>

## What changed
<bullet list, user-facing terms first, technical detail after if needed>

## Why
<the problem being solved>

## How to test (QA)
<numbered steps a non-engineer can follow — specific pages/features,
viewports/themes if UI-related, expected result at each step>

## Risk level
Low / Medium / High — <one line on what could break if this goes wrong>

## Screenshots (if UI change)
<before/after>
```

The file also carries a **checklist** the prose version never had: the four
build gates, plus the two questions that cause silent production failures —
does this add a migration, and does this add an environment variable. Both are
covered in §7.

**Rules**

- **"How to test" is mandatory on every PR, including small ones.** This is the
  dev→QA handoff, not optional documentation. A PR without it is not ready.
- Write "How to test" for someone sitting in the **QA folder**, not the dev
  folder. Assume they are on the `qa` staging environment (§4), so name the
  page and what to look at — not which branch to pull. Only say "check out this
  branch" when the change genuinely is not on `qa` yet.
- **Risk level** is how QA budgets regression time. Be honest:
  - **Low** — isolated, no shared code, easy to eyeball.
  - **Medium** — touches a shared component or a data path used elsewhere.
  - **High** — auth, payments, alert delivery, migrations, anything that fails
    silently or affects money or user data.

### 3a. Say which side you are — one account, two roles

**Open every PR body, issue and comment with `**Dev Team**` or `**QA Team**`.**
Address the other side by name when you are asking them for something.

Dev and QA push from the **same GitHub account**. Every PR, issue, comment and
commit therefore shows the identical author, and nothing in the interface
distinguishes a QA finding from a dev fix.

That matters more than it looks, because this whole document is built on knowing
who is asking whom:

- §4 makes the PR the dev→QA handoff. "How to test" is written *by* dev *for* QA.
- §4's reverse handoff has QA opening PRs into `dev` for **dev** to review and
  merge — the one case where review runs QA→dev.
- §7 gives merge and deploy to QA and to nobody else.

Read a thread six weeks later with no labels and none of that is recoverable. A
comment saying "merge this, then promote" is an instruction in one direction and
an overstep in the other, and the timeline cannot tell you which.

Put it at the **top**, not the bottom — comments get truncated in notifications
and in the PR list, and the attribution is the part you least want cut.

```markdown
**QA Team**

Verified on staging. Steps 1–3 pass, step 4 fails — detail below.
```

Commit messages are exempt: the `type(scope):` prefix already carries intent and
the bodies are detailed enough to place. Say "QA" in the body anyway when a
commit *is* a handoff or a request rather than just work.

**One account also means no PR here can ever be approved.** GitHub refuses:

```
Review Can not approve your own pull request
```

The author is always the reviewer, so the button is unavailable on every PR —
dev's, QA's, and the release PR. Review still happens; it lands as a comment.

> **Do not add an approval requirement to any ruleset while dev and QA share one
> GitHub account.** It cannot be satisfied by anyone, and it fails as an absent
> check rather than a failing one.

That is written as a prohibition because requiring an approval on `main` is the
most obvious hardening anyone would reach for on a production branch, and it
reads as unambiguously good practice. It would deadlock every release
permanently, and the release PR would sit unmergeable with **nothing red to
explain why**.

Same signature as the bot-PR problem: automation blocked by a permission that
reports nothing. Both were found by trying the thing, not by reading the config —
which is the general lesson, and the reason neither was predicted.

---

### 3b. QA also tracks the project, and that pulls against being the gate

> **Resolved 2026-09-05 by adding a fourth session, and kept here because the
> reasoning is why that session exists.** The conflict below — one role holding
> both "not yet" and "this has been finished and unshipped for two days" — is
> what the PM/DevOps split fixes structurally. Tracking and sequencing are
> PM/DevOps's, as is the last hop to production; the gate and the `qa`/`staging`
> routes are QA's; and they are different sessions now, so the conflict has
> nowhere to be settled quietly. **Still open: `qa/STATUS.md` lives in QA's tree
> while the tracking job is now PM/DevOps's. Agreed to move it to `docs/` after
> the current release, with a pointer left behind — not reassigned mid-flight.**

**QA held two jobs: the quality gate, and knowing where the project is.** The
second one lives in [`qa/STATUS.md`](qa/STATUS.md) — what is live, what is
waiting to ship, what is blocked and on whom. QA owns that file and keeps it
current; it carries a date at the top so a stale copy announces itself.

It sits with QA rather than dev for a structural reason, not a preference. **QA
is the only role that touches every hop from `qa` to production**, so it is the
only one positioned to see the whole pipeline. Dev's view stops at `qa` by
design (§4) — which means dev can do everything correctly and still have no
vantage point from which the queue is visible. That is not hypothetical; it is
what happened on 2026-08-08, and §7b is the rule that came out of it.

**The two jobs pull opposite ways, and naming that is the point.** A gate says
"not yet". A tracker says "this has been finished and unshipped for two days".
One person holding both will, left unmanaged, settle that conflict in favour of
shipping — because shipping is the half that produces visible progress and the
other half only ever produces delay.

So the rule is written down rather than left to judgement in the moment:

> **QA judgement is never traded for schedule.** When the gate and the queue
> disagree, it is said out loud on the release PR and the **owner** decides. It
> is not settled quietly by the person holding both roles.

Things that are **never** shortened because the queue is deep:

- re-testing a failed step, plus anything the fix could have touched (§7)
- the full browser suite on the `staging` → `main` PR (§4b)
- writing down what could not be verified, under **Risk level**

The correct response to a deep queue is in §7b and it is the opposite of testing
less: **promote more often.** A batch too big to reason about is fixed by making
batches smaller, never by reasoning about it less carefully.

**What this does not change:** QA still writes no application code (§4), and
still cannot merge its own PRs into `dev`. Tracking the project confers no
authority over what goes into it.

---

## 4. Two-workspace handoff (dev folder ↔ QA folder)

Both folders are separate local clones of the same GitHub remote. **The PR is
the handoff point between them.**

### Dev folder — when a change is ready

1. Push the branch, named per §1.
2. Open a PR using the full template in §3.
3. Write "How to test" assuming the reader is on the **`qa` staging
   environment** — name the page and what to look at. Only name a branch when
   the change is not on `qa` yet.

**Dev is not done when the PR is open.** Dev also merges its own feature branch
into `dev` and promotes `dev` → `qa`, then hands the deploy to QA. What dev never
does is promote into `staging`, merge to `main`, or deploy anything — see "Who
merges and deploys" below.

This used to read "dev's responsibility ends here", which was true when there
were two branches and is not now. Stopping at "PR is open" is how a change sits
on `dev` for a day with nobody wondering why it never reached staging.

### QA folder — when testing a PR

1. **Test on the `qa` staging environment, not a local checkout.**

   https://liquidity-hq-qa.onrender.com

   That is the point of the `qa` branch: dev merges `dev` → `qa`, QA deploys it,
   and QA gets a real running build with no setup. Testing a branch you built
   locally tests your machine as much as the change.

   Confirm you are looking at the right build before reporting anything — the
   commit `qa` is on should contain the change under test. If it does not, say
   so and stop; that is a finding about the handoff, not about the code.

   **Never test on `main`.** The change is not there yet, so it will silently
   pass.

   **Testing locally is equally valid — as long as the QA folder is on the
   `qa` branch:**

   ```
   git fetch && git checkout qa && git pull
   npm install && npm run build && npm start
   ```

   Same code, no cold start, and the browser devtools are right there. Use it
   whenever the staging service is asleep or the test needs the Network tab, a
   throttled connection, or a device emulator. What matters is **which branch
   you are on**, not which URL you point at — a local run on `qa` and the
   staging URL are the same build.

   Say which one a result came from when reporting. "Fails on localhost, passes
   on staging" is itself a finding worth having.

   *Also fine on a feature branch directly:* a change that has not reached `qa`
   yet, or QA's own test tooling, still gets
   `git fetch && git checkout <branch-name>` — the exact branch from the PR.
2. Run the "How to test" steps **literally, in order**. Do not improvise a
   different path; if the steps are wrong or impossible, that itself is the
   finding and belongs in the report.

   Two things about this environment will otherwise be reported as bugs and are
   not: it runs on Render's **free plan**, so the first request after it has
   been idle is slow and can time out — retry once. And it shares the **dev**
   database, so data you did not create may already be there, and dev may
   change it underneath you mid-test.
3. Report as a PR comment (or directly to the user) in **plain pass/fail per
   step**:

   > Step 1: pass
   > Step 2: **fail** — font size did not change on mobile dark theme
   > Step 3: pass

   Not "looks broken". Which step, what was expected, what actually happened.
4. If the QA folder has no `CLAUDE.md` / `CONTRIBUTING.md`, it has not pulled
   since this convention landed. **Pull `main` first**, then check out the
   feature branch, so both folders are working to the same standard.
5. **When every step passes, QA says so and PM/DevOps merges `staging` into
   `main`** and then deploys — both steps, in that order, and the production
   deploy needs the owner's approval that release. See below.

   Merging opens the release PR's final CI run: **the full browser suite, 187
   tests, ~34 minutes** (§4b). It is the only place that suite runs
   automatically. Wait for it. A red run there means something QA's manual pass
   did not reach, and it blocks the production deploy.

   `staging` → `main`, not the feature branch → `main`. By the time QA is testing,
   the change is already on `dev` and `qa`; merging the original feature branch
   straight into `main` would skip whatever else `qa` was validated with, and
   ship a combination nobody tested.

### Who decides what to work on

**PM/DevOps is the project manager. PM/DevOps sequences; dev and QA execute.
Changed 2026-09-05.** This read "QA is the project manager" from 2026-08-09,
when the owner first delegated prioritisation away from themselves. The owner
has since added a fourth session and moved sequencing to it, so QA can
concentrate on testing and auditing. PM/DevOps files and orders the issues and
says what is next; neither dev nor QA asks the owner to choose between work
items.

**Sequencing is not approval.** PM/DevOps saying a thing is next does not make it
verified, and QA's "not ready" outranks any position in the queue. See "Who
merges and deploys".

**The owner does not want to be the relay between sessions**, and has said so.
That makes GitHub the channel rather than any chat window:

- Findings go on the issue or PR — measurements, corrected premises, cost numbers,
  and approaches tried and rejected. A result that lives only in a chat reply is
  invisible to whoever is sequencing the work.
- **Negative results are worth posting too.** "I measured this and it changed
  nothing" and "I could not verify this locally" save the other session from
  re-deriving them.
- "What is next?" is a question for QA, on GitHub.

This does not soften review. Dev still reviews QA's PRs into `dev` properly, and
QA still tests dev's work properly; sequencing belonging to QA is not the same as
approval belonging to QA.

#### Nobody waits on the owner to merge into `dev`

Added 2026-08-10, on the owner's instruction:

> *"tell dev to merge both dont wait for me to say it"*
> *"if there are PR's waiting from dev just review it and ask dev to merge it"*

**An open dev PR is QA's queue, not dev's.** QA reviews it and says merge —
unprompted, and without checking back with the owner first. Dev merges on that
word rather than waiting for a third party who is not coming.

**QA's blocker order when several things are open:**

1. Whatever is blocking dev
2. Review of dev's open PRs
3. QA's own specs and tooling

A blocked dev is a stopped project; a delayed spec is not. This is written down
rather than assumed because the owner has objected to the waiting game four
separate times — *"stop having this waiting game wtf"*, *"why are we stalling?"*,
*"dont wait for my call next time just go"*, *"monitor each other make sure
you're not on waiting game"*.

**Three exceptions, unchanged and not negotiable:** merging to `main`, production
deploys, and writes to the shared database. Those go to the owner directly, and
**whoever is asked confirms them with the owner even when another session
relays them** — that now most often means PM/DevOps, since PM/DevOps holds the
merge and the deploy. See "Who merges and deploys". Everything else moves
without a checkpoint.

### Who merges and deploys

**Dev never promotes into `staging`, never merges to `main`, and never deploys
production.** Not with
permission, not "just this once", not when QA is busy. The whole value of the
gate is that it is never the person who wrote the code.

**PM/DevOps does the `staging` → `main` merge and the production deploy. Changed
2026-09-05.** This section read "QA does the merge and the deploy" until the owner
moved those two: *"You're not doing the merging and deploy production. Hand it
over to Project Manager DevOps."* The owner may still do them themselves.

**Only those two moved.** QA keeps the `qa` and `staging` routes — promoting into
each and deploying each. Dev keeps feature branches into `dev` and the
`dev` → `qa` promotion. A first draft of this change took all four deploys and
every promotion to PM/DevOps, generalising from the sentence above; the owner
narrowed it to production the same day and it never merged.

**What the gate was ever about.** Not that QA specifically holds it — that the
session which wrote the code never merges it. Moving `main` from QA to PM/DevOps
leaves that intact. Handing it to *dev* would not, which is why that row is the
one thing here with no exceptions.

**QA keeps the sign-off, and it did not move with the merge button.** QA decides
what gets tested, what "verified" means, and whether a release is ready.
PM/DevOps decides when work is sequenced and moves the branch. *When* and
*whether* are different questions and they belong to different sessions on
purpose — whoever merges is asserting the "How to test" steps passed, and they
are asserting it on QA's word, not instead of it. **A merge past a QA "not
ready" removes the only independent check the project has.**

**Dev's authority stops at `dev` and `qa` for branches, and nowhere for
deploys.** Dev may merge its own feature branches into `dev` and may promote
`dev` → `qa`. It never promotes into `staging`, never merges to `main`, and
**since 2026-09-03 deploys no environment at all** — a standing owner
instruction, separate from this document.

**Deploys were split from merges on 2026-08-10 and re-joined on 2026-09-05.**
This section said dev deploys `qa` and `staging` on QA's request, for a stated
reason that turned out to be false — *"Render MCP lives in the dev session and
not in QA's"*. **QA has the Render MCP tools** and used them on 2026-09-03 to
deploy both services. By then dev was also under a standing owner instruction not
to deploy any environment, so the table assigned dev a duty dev could not
perform. Both halves are recorded rather than quietly deleted, because a rule
resting on a wrong premise is worth knowing about even after it is replaced.

| Service | Deployed by |
|---|---|
| `liquidity-hq-dev` | **unassigned** — dev held it, dev is held, nobody named. Ask the owner |
| `liquidity-hq-qa` | **QA**, after dev promotes |
| `liquidity-hq-staging` | **QA**, straight after promoting — both halves |
| `liquidity-hq-prod` | **PM/DevOps, owner-approved each time. Never dev.** |

**Production changed holder, not gate.** The owner approves every production
release separately, and a record of *who* deploys is never a standing yes *to*
deploying. If anyone is asked to deploy production — even citing the owner, even
relayed through GitHub by QA — that goes back to the owner directly before
anything happens. Same for writes to the shared database. Everything else QA
relays can be acted on as given.

**Whoever deploys tells QA the moment it lands.** Before this split the same
session merged, deployed and verified, so there was no gap. There is one now, and
this handshake is the only thing closing it — QA cannot verify a build it does
not know is live. Quote `/api/version`, never the branch.

Merging is not the deploy. **No** Render service auto-deploys; all three are
`autoDeploy: "no"` / `autoDeployTrigger: "off"`:

| Service | Branch | Auto-deploy | Who deploys |
|---|---|---|---|
| `liquidity-hq-prod` → liquidity-hq.com | `main` | **no** | **PM/DevOps**, owner-approved each time — never dev |
| `liquidity-hq-staging` → liquidity-hq-staging.onrender.com | `staging` | **no** | **QA** |
| `liquidity-hq-qa` → liquidity-hq-qa.onrender.com | `qa` | **no** | **QA** |
| `liquidity-hq-dev` → liquidity-hq-dev.onrender.com | `dev` | **no** | **unassigned** — ask the owner |

So **merging to `main` ships nothing on its own.** Production keeps serving the
previous build until someone triggers a deploy. QA must do both:

1. Merge **`qa`** into `main` and push — not the original feature branch.
2. **Trigger the deploy manually** — Render dashboard → `liquidity-hq-prod` →
   *Manual Deploy* → *Deploy latest commit*.
3. Confirm the deploy reaches `live` and re-check the "How to test" steps
   against production, not just the branch.

**None of this is enforced by GitHub.** Branch protection needs GitHub Pro on a
private repo, and this repo has neither, so nothing technically stops anyone
pushing straight to `main` or merging their own work. Checked, not assumed - the
API returns *"Upgrade to GitHub Pro or make this repository public to enable
this feature"* for `main`, `qa` and `dev` alike. Every rule here is therefore a
convention people choose to follow, which is worth knowing: the cost of
breaking one is paid later and by someone else, not caught at push time.

This is a deliberate safety property, not an oversight: a merge can be reviewed
and corrected before it reaches users. Do not turn auto-deploy on without
agreeing it first — several rules here assume the gap exists.

### The separation is the point

- **Never test on the dev folder.** Uncommitted work, stale build artefacts and
  local-only state make a pass there meaningless.
- **Never merge or deploy from the dev folder.** That authority belongs to QA.
  Dev stops at "PR is open".
- **Never develop on the QA folder.** It exists to reproduce what a fresh clone
  of that branch actually does.
- If a Claude Code session **in the QA folder** is asked to write **application**
  code — anything under `app/`, `components/` or `lib/` — it must **flag that as
  outside the QA folder's role** instead of quietly doing it. Its own test
  tooling is a different matter, see below.

### When QA writes code — the reverse handoff

QA owns its own tooling and may write it:

| QA may author | QA may not author |
|---|---|
| `qa/` — specs, plans, fixtures | `app/`, `components/`, `lib/` |
| `playwright.config.ts` | Anything shipped to users |
| `.github/workflows/` test jobs | API routes, migrations |
| QA docs and findings | |

Everything else about the flow **reverses**, and that is the point — the author
never verifies their own work:

1. QA pushes a branch named per §1 and opens a PR **into `dev`**, using the
   full template in §3. Not into `main`: test tooling reaches `main` the same
   way everything else does, as part of a reviewed `dev` → `main` release.
2. **Dev reviews it.** This is the only case where review runs QA → dev rather
   than dev → QA.
3. Dev merges it into `dev` once it passes.

If QA finds that a fix needs an application-code change, that goes back to dev
as a **finding**, not as a commit. Describe the defect and where it lives; let
dev write it. A QA folder that starts fixing app code is no longer an
independent check on it.

This section exists because it was missing and the gap produced a real wrong
answer: with no rule for QA-authored code, the dev session simply asserted that
it would review such a branch — a role the document never gave it.

---

## 4b. Where the browser suite runs

**CI does not run the Playwright suite on most pushes.** Actions minutes are
metered on a private repo, and three days of unrestricted running burned 1,755
minutes — about $124/month annualised — and hard-stopped CI mid-release when the
spending limit was hit. Nothing was deleted to fix that. It was moved to the one
place it is worth 34 minutes.

### What GitHub runs

| Event | Lint · typecheck · unit · build | Playwright |
|---|---|---|
| Push to a feature branch | ✅ ~2 min | — |
| PR into `dev` | ✅ | — |
| PR into `qa` | ✅ | — |
| PR into `staging` | ✅ | — |
| Push to `dev` or `main` | ✅ | — |
| **PR `staging` → `main`** (the release) | ✅ | ✅ **the full suite, ~53 min** |
| Manual run (Actions → CI → Run workflow) | ✅ | ✅ if you tick the box |

**One automated browser run per release, immediately before production.**

The four-branch change did not move this gate. The release PR became
`staging` → `main` instead of `qa` → `main`, and the workflow selects on the
*base* being `main`, which is true either way.

Measured, so the cost is not a guess: the suite ran **53 minutes with no
retries** on release 2026-08-06.4, and across the 40 workflow runs around it the
browser job executed **exactly once**. At one to two releases a week that is
roughly 200–400 minutes a month against a 2,000 minute allowance.

### Nobody runs it by hand

Not dev, not QA. Dev's pre-PR gates are the four fast ones — `npm run lint`,
`npx tsc --noEmit`, `npm test`, `npm run build`. QA's job is manual testing on the
`qa` environment, following the PR's "How to test" steps.

This was deliberated and changed twice. An earlier draft had QA running
`npm run test:e2e` locally on the promotion PR. It was dropped because it landed
minutes before the release PR's CI run — **the same 187 tests, on the same
commit, twice**, differing only in environment. Between the two, CI is the
stricter one and costs nobody's afternoon, so the human run went.

If you *want* it before then — a risky release, a big refactor — run it:

```bash
npm run test:e2e                    # full suite, ~30 min, builds and serves on :3100
E2E_PORT=3000 npx playwright test   # or reuse a server already running
```

`.env.e2e.local` supplies the BOLA fixtures. Without it `bola.spec.ts` **skips
with a stated reason** rather than passing, so a green run missing that file is
not a green run. There is also a manual trigger in Actions → CI → Run workflow.

### What that means for the gap

Between a feature merging into `dev` and the release PR opening, **nothing
exercises a browser automatically**. Staging catches it instead: QA tests by hand
on a real deployed build, which is a different and in some ways better check —
a machine cannot tell you a layout looks wrong.

The cost is honest and worth stating: a browser-level regression surfaces at the
release gate with a week of changes attached, not on the PR that caused it. That
is bounded by the weekly cadence in §7a, and it is the trade made in exchange for
roughly $120/month.

### Why the release run cannot be dropped too

CI is the only place the app builds **without** developer environment variables,
and that difference has produced two real defects:

- **The labels defect (2026-08-05).** `/api/labels` answers `200 {}` on a DB
  error and the client applied it, wiping all 2,570 seeded English labels so
  every page rendered raw keys. It only reproduces **without** Supabase env — CI's
  situation, never a developer machine with `.env.local` present. It surfaced as
  `/arena` overflowing 28px and a `/login` smoke failure, and it was red on
  *every* branch, including a documentation-only PR.
- **The table-prefix gap (2026-08-05).** CI had no `NEXT_PUBLIC_APP_ENV`, so it
  built with production table names and queried the dev project, which has none
  of them. Every authenticated CI run before it was fixed asserted less than it
  looked like it did. Locally the variable is set, so the bug is invisible.

Both are *environment-difference* bugs, invisible on a developer machine by
construction. A local run is not a substitute for this one; it is a different,
weaker check.

## 5. Solo / low-ceremony work

The convention should not make a one-line dependency bump feel like paperwork.

**Always required, no exceptions:**

- Branch naming (§1)
- The `type(scope):` commit prefix (§2)

**Can be skipped for small internal chores** — dependency bumps, formatting,
comment fixes, anything with no user-visible or behavioural effect:

- The `What changed / Why / Test` commit body
- Screenshots

**Never skippable when the change is QA-relevant** — if it touches the UI,
changes behaviour, or fixes a bug, it gets the full body and a full PR template
regardless of how small the diff is. A one-line CSS change that moves a button
is QA-relevant. A 400-line refactor with no behaviour change is not.

When in doubt: would a QA person need to look at this? If yes, write the body.

---

## 6. Branches and environments

The flow is `dev` → `qa` → `staging` → `main`.

**Four branches, four deployed sites — one each.** Since 2026-08-07 the hostname
tells you the branch, so there is no longer a name to memorise. This section said
"three deployed sites: `staging` is a branch, not a place" until 2026-08-08; that
was true for roughly six hours on the 7th, and reading it afterwards put the
wrong host in front of a test plan.

| Branch | Environment | Who promotes into it | Deploys automatically? |
|---|---|---|---|
| `<type>/<description>` | none | dev | n/a |
| `dev` | liquidity-hq-dev.onrender.com | dev | **no** — trigger manually |
| `qa` | **liquidity-hq-qa.onrender.com** | **dev** merges `dev` → `qa`; **QA** deploys | **no** — trigger manually |
| `staging` | **liquidity-hq-staging.onrender.com** | **QA** merges `qa` → `staging` and deploys | **no** — trigger manually |
| `main` | liquidity-hq.com (production) | **PM/DevOps** merges `staging` → `main`, on QA's sign-off | **no** — trigger manually |

### Why `staging` exists

`qa` was doing two jobs at once: rolling integration **and** release candidate.

A release PR's head **is** its base branch, so every `dev` → `qa` promotion
silently changed what an open release PR contained. QA would sign off on a set
of commits and the release would grow underneath them. That happened **three
times on 2026-08-06**, once after QA had already completed a full manual pass.

Splitting the two jobs fixes it structurally rather than by everyone
remembering to ask first:

- `qa` keeps moving. Dev promotes into it whenever work is ready.
- `staging` only moves when **QA** decides a batch is approved and ready to
  park. Nothing dev does can change what is sitting in a release.

This is also why **dev must never promote into `staging`**. If dev can move it,
the guarantee is gone.

#### What this does and does not guarantee

Be precise, because the imprecise version is what caused the original problem.

**It guarantees:** nothing *dev* does can change what is in a release. Every one
of the three incidents on 2026-08-06 was dev promoting under QA's signoff, and
that route is closed.

**It does not guarantee immutability.** A release PR's head is still its base
branch, so if `qa` → `staging` is promoted while a `staging` → `main` PR is open,
that release still grows. The change is *single-owner*, not frozen.

So one rule the branches cannot enforce:

> **Do not promote `qa` → `staging` while a `staging` → `main` PR is open.**
> Ship the open release first, or close it.

This is the one remaining step that depends on remembering. It is written down
rather than assumed, and it is deliberately the *only* one.

If that is not enough, the version that would be genuinely immutable is a dated
`release/YYYY-MM-DD` branch cut per release, which nothing ever promotes into.
It costs a branch per release and more churn; raise it if this rule ever gets
broken in practice.

- Feature branches are cut from `dev` and merged back into `dev` via PR.
  **Dev merges its own feature branches into `dev`** — QA ownership starts at
  `main`, not here. Merging a feature branch into `dev` needs no permission
  and no QA pass.

### The `qa` and `staging` environments

**`staging` is where QA tests** — liquidity-hq-staging.onrender.com, serving the
`staging` branch, so what QA signs off IS the release candidate rather than a
branch dev keeps advancing.

**`qa` is dev's** — liquidity-hq-qa.onrender.com, serving `qa`, so dev can
confirm a promotion before QA sees it.

Both are free-plan and both are `autoDeploy: no`. Everything below about the
branch moving and the environment moving being two separate acts applies to
each.

Merging `dev` → `qa` does **not** deploy. Like prod and dev, this service is
`autoDeploy: no`, so the branch moving and the environment moving are two
separate acts. **Dev merges `dev` → `qa`; QA triggers the deploy** — the two
halves are split here, and that is deliberate rather than an oversight. Dev is
under a standing instruction not to deploy, so the handoff is the merge, and QA
closes it by deploying and saying so.

Render dashboard → `liquidity-hq-qa` → *Manual Deploy* → *Deploy latest
commit*. Say in the PR or the handoff message that you have done it, otherwise
QA tests the previous build and neither of you finds out for a while.

| | |
|---|---|
| **URL** | https://liquidity-hq-qa.onrender.com |
| **Render service** | `liquidity-hq-qa` (`srv-d9p42ke1egvs73f8car0`), free plan, Singapore |
| **Database** | Supabase `liquidity-hq-dev` (`wdtjhrilakoitfcezxpx`) |
| **Auto-deploy** | **no** — merge, then trigger manually |

**It shares the dev database, and that is a known compromise, not the design.**
The intent was a separate `liquidity-hq-qa` Supabase project. Supabase's free
plan caps a *user* at two active projects across every org they own, and
`liquidity-hq-dev` and `liquidity-hq-prod` already use both. Deleting two
unrelated paused projects did not free a slot — the cap counts active projects
only — and a new org does not help either, because the limit follows the
account, not the org. Revisit when the org moves to Pro; a separate project or
a real Supabase branch is the right answer and this is the stopgap.

What that costs you in practice: QA test accounts and dev's own data live in
the same database, so each can see and overwrite the other's rows. Do not read
a clean QA run as proof the data path is clean.

**What it must never do is point at production Supabase**
(`qdpwhnvmhqgzijuwopso`). That is a hard rule. A staging environment that can
write to production data is worse than having no staging environment, because
it looks safe.

**Free plan means it sleeps.** The service spins down after inactivity, so the
first request after an idle period is slow and can time out. That is the tier,
not a bug — retry once before reporting it. It also shares the ~500
build-hour/month cap noted above.

### Cut a branch from wherever it is going to land

**A branch destined for `main` must be cut from `main`, not from `dev`.**

Branching off `dev` and then merging that branch into `main` does not merge
your commit — it merges *everything currently on `dev`*, including work that was
deliberately being held back. The diff looks right locally, so nothing warns
you.

This is not hypothetical: it happened while writing this file. A `docs/` branch
was cut from `dev` and merged to `main` to bootstrap the convention, and it
silently carried 13 unrelated QA-scaffolding files onto `main` with it.

- Normal work → cut from `dev`, merge back to `dev`. Reaches `main` later, as
  part of a reviewed `dev` → `qa` → `staging` → `main` release.
- Hotfix or anything that must land on `main` **now** → cut from `main`, then
  merge it back into **both `dev` and `qa`** afterwards, or the next release
  silently reverts it. Merging into `dev` alone is not enough now that `qa`
  exists.

**A hotfix skips `qa`, which means it skips testing.** That is the trade you
are making by calling something a hotfix, so make it deliberately: test it
locally, keep it as small as you can defend, and say in the PR what was *not*
verified. "Urgent" is a reason to shorten the queue, not a reason to pretend
the risk is lower than it is.

### `qa` is fast-forward only

**Never commit directly to `qa`, and never open a PR against it from a feature
branch.** The only thing that goes into `qa` is `dev`:

```
git checkout qa && git merge --ff-only dev && git push
```

If that command fails, `qa` has diverged and something has gone in the wrong
way. Fix the divergence rather than forcing the merge — a `qa` that is not a
prefix of `dev` means "tested on qa" no longer tells you anything about what is
on `dev`, and the whole `dev` → `qa` → `staging` → `main` model stops meaning what it says.

After a release lands on `main`, `qa` keeps whatever it had; the next promotion
fast-forwards it again from `dev`. Nothing needs resetting.

### Delete the branch when it merges

Once a feature branch is merged, delete it locally and on the remote. A branch
list that still shows a dozen merged branches makes the two or three that
matter impossible to find, and it is not obvious from the name which are live.
`main`, `dev`, `qa`, `staging` and anything with an open PR are the only
branches that should exist.

**If a merge to `main` is ever reverted**, note that the reverted commits stay
in `main`'s history. Git treats them as already merged, so a later `dev` →
`main` merge will **not** bring their changes back — it will look like a clean
merge that silently does nothing. Recover them with `git revert <the-revert>` or
a cherry-pick, not another merge.
- `dev` is the integration branch. **Pushing to the `dev` branch is always
  fine, no need to ask. Deploying the `liquidity-hq-dev` *service* is not** —
  ask first. That service carries a ~500 build-hour/month cap that prod does
  not have, so a deploy spends a shared, exhaustible budget. Default to local
  verification (`npx tsc --noEmit`, `npm run build`, `localhost:3000`) and
  deploy dev only when something genuinely cannot be checked locally — an
  origin IP, a real Render environment variable, a cold start.
- `main` is **release only, and PM/DevOps-owned**. Dev never merges into it.
  PM/DevOps merges after QA confirms every "How to test" step passed, then
  triggers the production deploy as a separate manual action with the owner's
  approval (§4, "Who merges and deploys").
- **No** service auto-deploys. A merge is not a release; the deploy is always
  a deliberate second step.

---

## 7. Promoting a release

The three merges that carry work forward — `dev` → `qa`, `qa` → `staging` and
`staging` → `main` — get a PR like everything else. They are the merges with the highest blast radius,
so they are the wrong place to skip the paper trail. A promotion PR needs no
essay: a title, a list of what is going out, and the checklist below.

### 7a. How often a release goes out

**Features batch to a weekly release. Bug fixes and hotfixes ship when they are
ready.**

| What | Cadence |
|---|---|
| New features, additions, refactors, docs | Batched into **one release a week** |
| Bug fixes | As soon as they are verified — do not wait for the weekly slot |
| Hotfixes (production is broken) | Immediately, and they skip `qa` and `staging` — see §6 |

Merging to `dev` is not affected — that stays continuous. What batches is the
promotion out of `dev`.

Two things follow from this, and both are the point rather than side effects:

- **A regression found at the release gate arrives with a week of changes
  attached**, not one. That is the cost of batching, and it is why §4b keeps the
  full browser suite on the `staging` → `main` PR — the last automated check before a
  production deploy — rather than dropping it entirely once it came off feature
  PRs.
- **"It is not urgent" is a real answer.** A feature that misses the weekly slot
  waits. Shipping a feature mid-week to production, outside the batch, is a
  decision someone makes deliberately — not something that happens because a PR
  merged.

### 7b. The queue has a depth limit

Batching to a weekly release and letting the queue grow without limit are not
the same thing. **Target: fewer than ~5 PRs waiting on `qa` at any time.**

Measure it rather than estimating it:

```bash
git fetch origin
git rev-list --count origin/staging..origin/qa              # commits waiting
git log origin/staging..origin/qa --format=%s \
  | grep -c "^Merge pull request"                           # PRs waiting
```

A batch of fifteen PRs is not one release. It is fifteen changes whose
interactions nobody has reasoned about, arriving at the gate together — and if a
regression shows up there, the bisect surface is the whole batch rather than one
change.

This is not hypothetical. On **2026-08-08 the queue reached 37 commits / 15
PRs**, finished and unshipped, and nothing surfaced it until someone asked where
the project was. Depth is invisible unless something measures it, which is why
the number lives in [`qa/STATUS.md`](qa/STATUS.md) and is updated rather than
remembered.

**Over the limit, promoting takes priority over merging more into `dev`.** That
is the only lever — `dev` merging continuously is otherwise correct and stays
that way. The thing to watch is not how fast work is finished; it is how long
finished work waits.

### Before `dev` → `qa`

1. **Ask QA whether now is a good time.** See below — this is a timing check,
   not a review.
2. CI green on `dev`.
3. **Migrations applied.** See below — this is the one that takes prod down.
4. Merge fast-forward only: `git checkout qa && git merge --ff-only dev`.
5. **Trigger the qa deploy** and say you have. Merging does not deploy.

### QA controls *when* `dev` → `qa` happens

**Dev asks before promoting. QA answers "go" or "hold".** That is the whole
rule.

QA owns the `qa` environment because QA is the only one using it. Without this,
dev can promote and redeploy in the middle of a test run and change the thing
being tested underneath the tester — and the resulting bug report describes a
build that no longer exists. Two people both being careful does not prevent
that; only asking does.

**This is a timing gate, not an approval gate, and the distinction matters.**
QA is not being asked to review the code. The whole convention is built around
QA being someone who cannot read it (see the top of this file), and QA cannot
test the change either, because it is not on `qa` yet. Asking for approval here
would produce a signature, not a check — a gate that looks like oversight and
supplies none.

So the question is only ever *"are you mid-run?"*:

> **dev:** Ready to promote #16 to qa — ok to push?
> **QA:** Hold, 10 minutes, finishing the alerts sweep.
> *...later...*
> **QA:** Go.

QA does not need a reason to say hold, and dev does not need to justify the
promotion. If QA does not answer, dev promotes — this is a courtesy that
prevents wasted test runs, not a lock that stalls the pipeline waiting on
someone who has gone home.

**Worth being honest about what this does and does not fix.** It stops
collisions. It does **not** put a second pair of eyes on the code: everything
from a feature branch through to `main` is written, merged and promoted by dev.
That is a deliberate trade for a two-person team, but it should be a known one
rather than an assumed safety net.

### Dev QAs its own work first. QA is the second check, not the first.

Having a QA folder does not move responsibility for quality onto it. **A change
arrives at `qa` already verified**, and the PR says how it was verified. QA
exists to catch what dev could not see — a different machine, a real
environment, a user's path through the product — not to be the first person who
looks.

Before opening a PR, dev has:

- **Run the gates.** `npm run verify` runs all four in order — lint (0 errors),
  typecheck, test, build — and stops at the first failure. Individually they are
  `npm run lint`, `npm run typecheck`, `npm test`, `npm run build`.

  **All four, not the fast one.** `npm test` is `node --test __tests__/*.test.mts`:
  it typechecks nothing outside `__tests__`, so a `.tsx` can be syntactically
  broken while all 583 tests pass. That happened three times in one session
  before `typecheck` existed as a named script — the output was not wrong, it
  answered a narrower question than the one being asked. CI has always run all
  four (`.github/workflows/ci.yml:191-209`), so this is about the local loop,
  not about what can reach `main`.
- **Exercised the change**, not reasoned about it. Load the page. Call the
  route. If it is a fix, reproduce the original failure first and then confirm
  it is gone — a fix that was never seen failing is a guess.
- **Measured anything numeric, before and after.** "Feels faster" is not a
  result. This has repeatedly mattered: the obvious suspect for `/arena`'s
  layout shift turned out to be 0.1% of it, and the textbook fix measured twice
  as bad as the baseline. Neither was discoverable by reading the code.
- **Swept the whole area, not the one symptom.** If one card on a page shifts,
  check every card on that page. If one route lacks a cache, check the sibling
  routes with the same shape. Finding a second defect after saying "done" is
  the same failure as not finding it.
- **Written down what is still unverified**, in the PR's Risk level. Something
  that genuinely cannot be checked locally — a production IP, a cold start, a
  real environment variable — is named there, not left for QA to trip over.

The test to apply before handing over: *if QA finds nothing, was this PR
finished?* If the honest answer is "no, they would have found the obvious
thing", it was not ready.

### Two PRs, and who opens which

**Nobody has to remember to announce a promotion.** Pushing to `qa` opens or
updates a **"Ready for QA" issue** automatically —
`.github/workflows/ready-for-qa.yml`. It lists every PR that is on `qa` and not
yet on `staging`, and pulls each one's **"How to test (QA)" section through
verbatim**, which is otherwise buried in a PR that closed days earlier. Pushing
to `staging` closes it, because QA taking the work is the signal that it is no
longer waiting.

This replaced a rule that told dev to open a `dev` → `qa` PR "immediately after
promoting". That rule was the only thing telling QA anything was waiting, and it
depended entirely on a human remembering — which is not a mechanism. It was
missed, and #78 existed partly to paper over the result.

Two properties worth knowing, because they decide whether you can trust it:

- **It is computed from the branch range `staging..qa`, not from the push
  event.** That range *is* the definition of "work QA has not taken yet", so the
  issue stays correct after a force-push, a re-run, a revert, or three
  promotions in a row that nobody looked at. A push-event version would report
  one hop and silently under-report all of those.
- **It edits the existing issue rather than piling on comments**, so the issue
  always shows the current pending set rather than a stack of superseded
  snapshots. A short comment marks each update so the thread still shows movement.

Dev still asks before promoting (below). That is a *timing* check — it stops a
promotion landing mid-test-run. The announcement afterwards is now automatic.

**QA, when a batch is approved and ready to park: promote `qa` → `staging` and
deploy it.** Dev does not promote into `staging` — that is the whole point of the
branch. If dev can move the release candidate, the guarantee is gone.

**The `staging` → `main` release PR now opens itself**
(`.github/workflows/release-signals.yml`), aggregating each PR's "How to test
(QA)" *and* "Risk level" sections verbatim from `main..staging`. If one is
already open it is **commented on, never rewritten** — QA reports failures in
that thread and replacing the body underneath them would destroy the record.

> ⚠️ **It is switched OFF right now, and has been since 2026-08-09.**
> **Verified 2026-09-05.**
>
> The job is gated on a repository variable:
>
> ```yaml
> release-pr:
>   if: github.ref == 'refs/heads/staging' && vars.RELEASE_PR_PAUSED != '1'
> ```
>
> `gh variable list` shows **`RELEASE_PR_PAUSED = 1`**, set 2026-08-09 and never
> unset. That is deliberate — it lets `staging` accumulate without a release PR
> existing — but it means **"it opens itself" is currently false**, and both
> #828 and #842 had to be opened by hand.
>
> **Whoever pushes `staging` checks that a release PR exists and opens it by
> hand if not.** Unset or delete the variable to resume; the next push to
> `staging` then opens one for everything piled up since.
>
> **Do not diagnose this as "Actions are off".** That was this note's first
> version and it was wrong. Measured: `gh api .../actions/permissions` returns
> `{"enabled": true}` and all three workflows report `active` in
> `gh workflow list`. Separately and confusingly, there are **zero workflow runs
> of any kind between 2026-08-13 and 2026-09-05** — 23 days — which is a real
> observation with a cause I have not established. It is not this variable, and
> `docs/HANDOVER.md`'s older claim that the workflows are `disabled_manually`
> does not match what the API returns today either. Someone should settle it;
> until then, do not repeat either explanation as fact.

This was missing and it silently broke the handoff. Five changes sat on the
`qa` site — including the worst Core Web Vital in the product and a bug that
was getting users' IPs banned — with nothing anywhere saying so. Every
individual PR had already been merged and closed, `qa` had moved, the qa service
had been redeployed, and QA had no way to know.

That is why none of these three signals is an instruction any more. Each one was
written down as a rule, each rule was followed most of the time, and the times
it was not are the only times it mattered.

### Merging to `main` is not the deploy, and something now checks

Every Render service is `autoDeploy: no`. `main` can move and production keeps
serving the previous build indefinitely, with a green PR and a closed release
thread saying otherwise.

A drift check runs on every push to `main`, **daily on a schedule**, and on
demand. It reads `https://liquidity-hq.com/api/version` — what production is
actually serving, not what was merged — and raises a `release-drift` issue when:

- production's commit does not match `main`, or
- production matches `main` but the commit carries **no tag**, which is what
  makes "what is in production?" answerable without opening a dashboard.

It closes itself once both hold. The schedule matters more than the push
trigger: this class of failure happens *after* everyone has stopped watching, so
"merged Friday, never deployed" is exactly what it is for.

**If it cannot read the version endpoint it reports nothing at all.** An
unreachable host means the check could not measure, and calling that "production
is behind" would be a confident claim built on a failed measurement — the
specific mistake this whole set of signals exists to stop.

The release PR is different from a feature PR in three ways:

- **It aggregates.** One "How to test" section covering every change in the
  release, grouped by area, not a link to five closed PRs. QA should be able to
  work top to bottom without opening anything else.
- **It ends with the release steps**, because merging it *is* the release:
  merge, deploy production manually, re-check against liquidity-hq.com, tag.
- **It carries the honest caveats in Risk level** — every "this could not be
  verified locally" from every PR in the release, collected in one place.

Keep it open while QA works. It is the thread: failures get reported as comments
on it, and it stays open until the whole release either ships or is pulled
apart.

### Before `staging` → `main`

0. The candidate is parked: QA has promoted `qa` → `staging`, so what is in the
   release stopped moving. Nothing dev does can change it from here.
1. Every "How to test" step passed, on the `qa` environment — not on a feature
   branch, not on `dev`.
2. CI green.
3. **Migrations already applied to production.** Before the deploy, never after.
4. **Every environment variable the release needs exists on
   `liquidity-hq-prod`.** Check, do not assume.
5. Nothing unresolved that you would not want a user to find first.

Then merge, deploy, and re-check the steps against production rather than
against `qa`. A pass on staging is evidence, not proof: prod has different data,
different environment variables and a different Supabase project.

### When QA finds a failure

QA reports it as a comment on the release PR — **which step, what was expected,
what actually happened.** Not "looks broken".

**Dev fixes it. QA does not.** A QA folder that fixes application code stops
being an independent check on it, and the convention assumes QA cannot read code
anyway (§4, "When QA writes code"). The only thing QA fixes is QA's own test
tooling.

The loop:

1. Dev cuts a new `fix/` branch **from `dev`**, not from `qa`. `qa` is
   fast-forward only (§6) and takes nothing but `dev`.
2. Normal PR, self-QA'd first (above). The bug QA found is reproduced before it
   is fixed — a fix for a bug you never saw fail is a guess.
3. Merge to `dev`, promote to `qa`, deploy `qa`. QA re-promotes to `staging`
   and asks dev to deploy it. Say so on the release PR.
4. **QA re-tests the failed step, and anything the fix could plausibly have
   touched.** Not the whole suite, not only the one step.

The release PR stays open through all of this. Do not close and reopen it —
the comment history is the record of what failed and what was done about it.

### When part of a release fails

`qa` is a single line, so there is no cherry-picking a good change out of it
without rebuilding the branch. Two honest options:

- **Fix forward.** The default. Everything waits for the fix, which is fine when
  the fix is hours away and nothing already on `qa` is urgent.
- **Pull the failing change out of `dev`**, then re-promote. Revert the merge on
  `dev`, fast-forward `qa` again, redeploy, and tell QA the release changed
  under them. Worth it only when something else in the release genuinely cannot
  wait.

Do not merge a release to `main` with a known failing step on the theory that it
is unrelated. If it were unrelated, it would not have failed.

### Database migrations

142 migration files exist and **nothing in this workflow used to mention them**,
which is how a deploy ships code that reads a column the database does not have.
Rules:

- **Apply the migration before the deploy that needs it, never after.** New code
  against an old schema is an outage; old code against a new schema is usually
  fine. That asymmetry is why the order is fixed.
- **Prefer additive migrations.** Add a column, backfill, then switch the code
  over. Dropping or renaming in the same release as the code change leaves no
  safe moment to roll back to.
- A migration is **High risk** in §3 terms, always. It gets the full PR body and
  the file named in it.
- **`qa` shares the dev database.** Applying a migration "to qa" applies it to
  dev, for everyone, immediately. There is no isolated place to try one — the
  closest thing is a local Supabase, and if you are about to do something
  destructive, that is where to do it.
- Applied through the Supabase MCP (`apply_migration`), per
  `docs/HANDOVER.md` §5.
- **Check the project you actually hit.** After applying anything, run this
  against **prod**:

  ```sql
  select relname from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
   where n.nspname = 'public' and relname like 'lhq_dev_%';
  -- must return zero rows on prod
  ```

  A dev-prefixed table on production means a migration meant for dev was applied
  to prod. That happened **twice** and went unnoticed for weeks — `lhq_dev_alert_fires`
  and `lhq_dev_user_settings` were both sitting on prod, empty, until a network
  tab on `/alerts` surfaced the first one on 2026-08-05. Nothing broke, because
  the app resolves table names through `lib/tables.ts` and never reads those, but
  prod Supabase is on the free plan with **no backups** — the next one might not
  be harmless. Two seconds of checking beats finding out later.

### Environment variables

A variable that exists on one service and not another is a deploy that builds
and then fails at runtime, usually in a way that fails soft and goes unnoticed.
It has already happened here twice, with `CRON_SECRET` and
`NEXT_PUBLIC_SENTRY_DSN`.

- If a PR adds or renames a variable, **the PR says so**, and lists which
  services still need it. That is a checklist item in the PR template.
- Set it on `liquidity-hq-prod` **before** the release deploy, not after.
- `NEXT_PUBLIC_*` variables are **inlined at build time**. Setting one after a
  build does nothing until the next build — a rebuild is required, not a
  restart.
- Never copy a production secret onto `qa` or `dev`. If staging needs a key,
  provision a separate one.

### Tagging

**PM/DevOps tags, as the last step of the release**, because PM/DevOps is the one
who merged and deployed and is therefore the only one who knows the deploy
actually reached `live`. A tag pushed before that is a claim about production
made by someone who did not deploy it. This said "QA tags" until 2026-09-05; the
reasoning did not change, only who the sentence describes.

Tag `main` after a successful production deploy:

```
git tag -a v2026.08.05 -m "RSI aggregation, arena + scanner CLS, WebSocket fallback"
git push origin v2026.08.05
```

Date-based, because this ships continuously and has no versioned API for semver
to describe. There are **no tags at all** right now, which means the only way to
answer "what is in production?" is to read the commit hash off the Render
dashboard and hope it matches something. One command per release fixes that.

---

## 8. When production breaks

**Roll back first, diagnose second.** A production incident is not the moment to
work out what went wrong — get users onto something that works, then find out.

### Rolling back a deploy

Render keeps previous deploys. Dashboard → `liquidity-hq-prod` → **Deploys** →
find the last known-good one → **Rollback to this deploy**. It redeploys that
build; it does not touch git, so `main` still has the bad commit and someone
must revert or fix it forward afterwards.

This is fast and safe **as long as no migration shipped with the bad release.**

### Rolling back when a migration shipped

You mostly cannot, and this is worth understanding before you need it.

Rolling the *code* back is easy. Rolling the *schema* back is not: a dropped
column has taken its data with it, and **the production Supabase project is on
the free plan, so there are no backups to restore from.** Not "backups we have
not tested" — none.

So the recovery path for a destructive migration is currently: there isn't one.
That is the single strongest argument for Supabase Pro, and it is why §7 says
prefer additive migrations. An additive migration is nearly always safe to leave
in place while you roll the code back.

### Afterwards

- Say what happened in `pendings/PENDING.md`, including what was tried and did
  not work. A fix nobody can find is a fix that gets re-invented.
- If the release passed QA and still broke production, the interesting question
  is what `qa` could not have caught — different data, a missing environment
  variable, a cold start, real traffic. That gap is the actual finding, and it
  belongs in the QA test plan so it is covered next time.
