# Contributing — Git Workflow & Naming Convention

This is the shared standard for **both** local clones of this repo: the **dev
folder** (where code is written) and the **QA folder** (where it is tested).

The test it has to pass: **a QA person who cannot read code should be able to
look at a branch name, a commit, or a PR and know what changed and what to
check.** Everything below exists to serve that. Where a rule would slow down
solo work without helping QA, it is explicitly relaxed — see
[Solo / low-ceremony work](#solo--low-ceremony-work).

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
into `dev`, promotes `dev` → `qa`, deploys the qa service, and opens the release
PR that tells QA there is something to test (§7). What dev never does is merge
to `main` or deploy production — see "Who merges and deploys" below.

This used to read "dev's responsibility ends here", which was true when there
were two branches and is not now. Stopping at "PR is open" is how a change sits
on `dev` for a day with nobody wondering why it never reached staging.

### QA folder — when testing a PR

1. **Test on the `qa` staging environment, not a local checkout.**

   https://liquidity-hq-qa.onrender.com

   That is the point of the `qa` branch: dev merges `dev` → `qa`, deploys it,
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
5. **On a `dev` → `qa` promotion PR, run the browser suite locally before the
   promotion is merged.** This is QA's, and it is the only automated browser
   check that change gets before staging — CI does not run the suite on that PR.
   Full detail in §4b; the short version:

   ```
   npm run test:e2e
   ```

   ~30 minutes, 187 tests. Report pass/fail on the PR like any other step.
6. **When every step passes, QA merges `qa` into `main`** and then deploys —
   both steps, in that order. See below.

   `qa` → `main`, not the feature branch → `main`. By the time QA is testing,
   the change is already on `dev` and `qa`; merging the original feature branch
   straight into `main` would skip whatever else `qa` was validated with, and
   ship a combination nobody tested.

### Who merges and deploys

**Dev never merges `qa` → `main` and never deploys production.** Not with
permission, not "just this once", not when QA is busy. The whole value of the
gate is that it is never the person who wrote the code.

**QA does the merge and the deploy — that is QA's job and the normal case.**
The owner may also do it. Both are legitimate; the rule is about excluding dev,
not about excluding everyone but QA. In practice QA should be doing it most of
the time, because it is the natural end of the testing they just did: they know
which steps passed, so they know whether it is ready.

The owner stepping in is for when QA is genuinely unavailable and something
needs to ship. It is not a way to skip the testing — whoever merges is
asserting the "How to test" steps passed, and that assertion is worth the same
whoever makes it.

Dev's authority stops at `dev` and `qa`. Dev may merge its own feature branches
into `dev`, may merge `dev` → `qa`, deploys the `qa` service, and deploys
nothing else.

Merging is not the deploy. **No** Render service auto-deploys; all three are
`autoDeploy: "no"` / `autoDeployTrigger: "off"`:

| Service | Branch | Auto-deploy | Who deploys |
|---|---|---|---|
| `liquidity-hq-prod` → liquidity-hq.com | `main` | **no** | **QA** (owner may) — never dev |
| `liquidity-hq-qa` → liquidity-hq-qa.onrender.com | `qa` | **no** | whoever merged `dev` → `qa` |
| `liquidity-hq-dev` → liquidity-hq-dev.onrender.com | `dev` | **no** | dev, ask first |

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

## 4b. What CI runs, and what QA runs

**CI does not run the browser suite on most pushes.** Actions minutes are metered
on a private repo, and three days of unrestricted running burned 1,755 minutes —
about $124/month annualised — and hard-stopped CI mid-release when the spending
limit hit. Nothing was deleted to fix that. The expensive half moved to a person
with a name.

### What GitHub runs

| Event | Lint · typecheck · unit · build | Playwright |
|---|---|---|
| Push to a feature branch | ✅ ~2 min | — |
| PR into `dev` | ✅ | — |
| PR into `qa` | ✅ | — |
| Push to `dev` or `main` | ✅ | — |
| **PR into `main`** (the release) | ✅ | ✅ **full, 187 tests, ~34 min** |
| Manual run (Actions → CI → Run workflow) | ✅ | ✅ if you tick the box |

One automated browser run per release, immediately before a production deploy.

### What QA runs

**On a `dev` → `qa` promotion PR, before merging it:**

```bash
npm run test:e2e                    # full suite, ~30 min, builds and serves on :3100
E2E_PORT=3000 npx playwright test   # or reuse a server you already have running
```

`.env.e2e.local` supplies the BOLA fixtures. It is gitignored and already in both
checkouts; if it is missing, `bola.spec.ts` **skips with a stated reason** rather
than passing, so a green run without it is not a green run.

Report pass/fail on the PR. **This is the gate.** Nothing else exercises a browser
against that change before it reaches staging.

### What dev runs

Unchanged — the four fast gates before opening any PR: `npm run lint`,
`npx tsc --noEmit`, `npm test`, `npm run build`. E2E was never on dev's list and is
not being added to it.

### Be honest about what a local run cannot catch

A green local run is **not** equivalent to CI, and the gap has already produced two
real defects:

- **The labels defect (2026-08-05).** `/api/labels` answers `200 {}` on a DB error
  and the client applied it, wiping all 2,570 seeded English labels so every page
  rendered raw keys. It only reproduces **without** Supabase env — CI's situation,
  never yours locally with `.env.local` present. It surfaced as `/arena` overflowing
  28px and a `/login` smoke failure, and it was red on *every* branch, including a
  documentation-only PR.
- **The table-prefix gap (2026-08-05).** CI had no `NEXT_PUBLIC_APP_ENV`, so it
  built with production table names and queried the dev project, which has none of
  them. Every authenticated CI run before it was fixed asserted less than it looked
  like it did. Locally the variable is set, so the bug is invisible.

Both are *environment-difference* bugs, invisible on a developer machine by
construction. That is the entire reason one CI run survives at the `main` gate
rather than the suite moving completely onto laptops.

### The trade being made

A browser regression now surfaces on QA's machine, not on the PR that introduced
it — and dev ships to QA with no browser verification at all. When QA's run fails
it is a round trip: report, dev cuts a `fix/` branch, re-promotes, QA re-runs 30
minutes. That cost is accepted in exchange for roughly $120/month and a clear
division of labour, and it is bounded by the weekly release cadence in §7a.

---

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

The flow is `dev` → `qa` → `main`.

| Branch | Environment | Who pushes | Deploys automatically? |
|---|---|---|---|
| `<type>/<description>` | none | dev | n/a |
| `dev` | liquidity-hq-dev.onrender.com | dev | **no** — trigger manually |
| `qa` | **liquidity-hq-qa.onrender.com** | dev merges `dev` → `qa` | **no** — trigger manually |
| `main` | liquidity-hq.com (production) | **QA** (owner may), never dev | **no** — trigger manually |

- Feature branches are cut from `dev` and merged back into `dev` via PR.
  **Dev merges its own feature branches into `dev`** — QA ownership starts at
  `main`, not here. Merging a feature branch into `dev` needs no permission
  and no QA pass.

### The `qa` staging environment

Merging `dev` → `qa` does **not** deploy. Like prod and dev, this service is
`autoDeploy: no`, so the branch moving and the environment moving are two
separate acts. **Whoever merges `dev` → `qa` also triggers the deploy** —
normally dev, since getting a build in front of QA is part of the handoff. QA
may trigger it too, for a re-deploy or after a config change.

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
  part of a reviewed `dev` → `qa` → `main` release.
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
on `dev`, and the whole `dev` → `qa` → `main` model stops meaning what it says.

After a release lands on `main`, `qa` keeps whatever it had; the next promotion
fast-forwards it again from `dev`. Nothing needs resetting.

### Delete the branch when it merges

Once a feature branch is merged, delete it locally and on the remote. A branch
list that still shows a dozen merged branches makes the two or three that
matter impossible to find, and it is not obvious from the name which are live.
`main`, `dev`, `qa` and anything with an open PR are the only branches that
should exist.

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
- `main` is **release only, and QA-owned**. Dev never merges into it. QA merges
  after every "How to test" step passes, then triggers the production deploy
  as a separate manual action (§4, "Who merges and deploys").
- **No** service auto-deploys. A merge is not a release; the deploy is always
  a deliberate second step.

---

## 7. Promoting a release

The two merges that actually reach users — `dev` → `qa` and `qa` → `main` — get
a PR like everything else. They are the merges with the highest blast radius,
so they are the wrong place to skip the paper trail. A promotion PR needs no
essay: a title, a list of what is going out, and the checklist below.

### 7a. How often a release goes out

**Features batch to a weekly release. Bug fixes and hotfixes ship when they are
ready.**

| What | Cadence |
|---|---|
| New features, additions, refactors, docs | Batched into **one release a week** |
| Bug fixes | As soon as they are verified — do not wait for the weekly slot |
| Hotfixes (production is broken) | Immediately, and they skip `qa` — see §6 |

Merging to `dev` is not affected — that stays continuous. What batches is the
promotion out of `dev`.

Two things follow from this, and both are the point rather than side effects:

- **A regression found at the `qa` gate arrives with a week of changes attached**,
  not one. That is the cost of batching, and it is why §4b puts a full browser run
  in QA's hands before the promotion is merged rather than after.
- **"It is not urgent" is a real answer.** A feature that misses the weekly slot
  waits. Shipping a feature mid-week to production, outside the batch, is a
  decision someone makes deliberately — not something that happens because a PR
  merged.

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

- **Run the gates.** `npm run lint` (0 errors), `npx tsc --noEmit`, `npm test`,
  `npm run build`. All four, not the fast one.
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

### The release PR is how QA finds out there is work

**Immediately after promoting `dev` → `qa`, dev opens a `qa` → `main` PR.** Not
later, not when the release feels big enough. That PR is the only thing that
tells QA anything is waiting.

This was missing and it silently broke the handoff. Five changes sat on the
staging site — including the worst Core Web Vital in the product and a bug that
was getting users' IPs banned — with nothing anywhere saying so. Every
individual PR had already been merged and closed, `qa` had moved, staging had
been redeployed, and QA had no way to know. Promoting without opening this PR is
deploying into silence.

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

### Before `qa` → `main`

1. Every "How to test" step passed, on `qa` — not on a feature branch, not on
   `dev`.
2. CI green on `qa`.
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
3. Merge to `dev`, promote to `qa`, redeploy staging, say so on the release PR.
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

**QA tags, as the last step of the release**, because QA is the one who merged
and deployed and is therefore the only one who knows the deploy actually
reached `live`. A tag pushed before that is a claim about production made by
someone who did not deploy it.

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
