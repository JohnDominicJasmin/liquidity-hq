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

Every PR description uses this structure:

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

**Rules**

- **"How to test" is mandatory on every PR, including small ones.** This is the
  dev→QA handoff, not optional documentation. A PR without it is not ready.
- Write "How to test" for someone sitting in the **QA folder**, not the dev
  folder. That means step 1 is almost always which branch to pull — see below.
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
3. Write "How to test" assuming the reader is in the **QA folder** — so it
   includes *which branch to pull*, not only what to click.

**Dev's responsibility ends here.** Once the PR is open and ready for review,
dev is done. Dev does **not** merge to `main` and does **not** deploy — see
"Who merges and deploys" below.

### QA folder — when testing a PR

1. **Test on the `qa` staging environment, not a local checkout.**

   https://liquidity-hq-qa.onrender.com

   That is the point of the `qa` branch: dev merges `dev` → `qa`, it deploys
   itself, and QA gets a real running build with no setup. Testing a branch you
   built locally tests your machine as much as the change.

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
5. **When every step passes, QA merges `qa` into `main`** and then deploys —
   both steps, in that order. See below.

   `qa` → `main`, not the feature branch → `main`. By the time QA is testing,
   the change is already on `dev` and `qa`; merging the original feature branch
   straight into `main` would skip whatever else `qa` was validated with, and
   ship a combination nobody tested.

### Who merges and deploys

**QA is the only one who merges `qa` → `main`, and the only one who deploys
production. Dev never does either.** Not with permission, not "just this once",
not when QA is busy. If production needs to move and QA is unavailable, that is
a scheduling problem, not a reason to route around the rule — the whole value
of the gate is that it is never the person who wrote the code.

Dev's authority stops at `dev` and `qa`. Dev may merge its own feature branches
into `dev`, may merge `dev` → `qa`, and may deploy nothing.

Merging is not the deploy. Both permanent Render services are configured
`autoDeploy: "no"` / `autoDeployTrigger: "off"`:

| Service | Branch | Auto-deploy | Who deploys |
|---|---|---|---|
| `liquidity-hq-prod` → liquidity-hq.com | `main` | **no** | **QA only** |
| `liquidity-hq-qa` → liquidity-hq-qa.onrender.com | `qa` | **yes** | nobody — it deploys itself |
| `liquidity-hq-dev` → liquidity-hq-dev.onrender.com | `dev` | **no** | dev, ask first |

So **merging to `main` ships nothing on its own.** Production keeps serving the
previous build until someone triggers a deploy. QA must do both:

1. Merge **`qa`** into `main` and push — not the original feature branch.
2. **Trigger the deploy manually** — Render dashboard → `liquidity-hq-prod` →
   *Manual Deploy* → *Deploy latest commit*.
3. Confirm the deploy reaches `live` and re-check the "How to test" steps
   against production, not just the branch.

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
| `qa` | **liquidity-hq-qa.onrender.com** | dev merges `dev` → `qa` | **yes** — on every push |
| `main` | liquidity-hq.com (production) | **QA only** | **no** — trigger manually |

- Feature branches are cut from `dev` and merged back into `dev` via PR.
  **Dev merges its own feature branches into `dev`** — QA ownership starts at
  `main`, not here. Merging a feature branch into `dev` needs no permission
  and no QA pass.

### The `qa` staging environment

`qa` is the only branch that deploys on its own. Merge `dev` → `qa` and a
build starts; no dashboard step. That is deliberate — QA should be able to get
a testable environment without waiting on dev, which is the whole reason the
branch exists.

| | |
|---|---|
| **URL** | https://liquidity-hq-qa.onrender.com |
| **Render service** | `liquidity-hq-qa` (`srv-d9p42ke1egvs73f8car0`), free plan, Singapore |
| **Database** | Supabase `liquidity-hq-dev` (`wdtjhrilakoitfcezxpx`) |
| **Auto-deploy** | **yes**, on every push to `qa` |

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
  part of a reviewed `dev` → `main` release.
- Hotfix or anything that must land on `main` **now** → cut from `main`, and
  merge it back into `dev` afterwards so the two do not drift.

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
- Neither service auto-deploys. A merge is not a release; the deploy is always
  a deliberate second step.
