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

1. ```
   git fetch && git checkout <branch-name>
   ```
   The **exact branch from the PR**. Never assume "latest `main`" — the change
   under test is not on `main` yet, and testing `main` will silently pass.
2. Run the "How to test" steps **literally, in order**. Do not improvise a
   different path; if the steps are wrong or impossible, that itself is the
   finding and belongs in the report.
3. Report as a PR comment (or directly to the user) in **plain pass/fail per
   step**:

   > Step 1: pass
   > Step 2: **fail** — font size did not change on mobile dark theme
   > Step 3: pass

   Not "looks broken". Which step, what was expected, what actually happened.
4. If the QA folder has no `CLAUDE.md` / `CONTRIBUTING.md`, it has not pulled
   since this convention landed. **Pull `main` first**, then check out the
   feature branch, so both folders are working to the same standard.
5. **When every step passes, QA merges the branch into `main`** and then
   deploys — both steps, in that order. See below.

### Who merges and deploys

**QA owns the merge to `main` and the deploy. Dev never does either.**

Merging is not the deploy. Both Render services are configured
`autoDeploy: "no"` / `autoDeployTrigger: "off"`:

| Service | Branch | Auto-deploy |
|---|---|---|
| `liquidity-hq-prod` → liquidity-hq.com | `main` | **no** |
| `liquidity-hq-dev` → liquidity-hq-dev.onrender.com | `dev` | **no** |

So **merging to `main` ships nothing on its own.** Production keeps serving the
previous build until someone triggers a deploy. QA must do both:

1. Merge the approved branch into `main` and push.
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
- If a Claude Code session **in the QA folder** is asked to write code changes —
  as opposed to testing, reporting, merging or deploying, all of which are its
  job — it must **flag that as outside the QA folder's role** instead of quietly
  doing it.

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

| Branch | Environment | Who pushes | Deploys automatically? |
|---|---|---|---|
| `<type>/<description>` | none | dev | n/a |
| `dev` | liquidity-hq-dev.onrender.com | dev | **no** — trigger manually |
| `main` | liquidity-hq.com (production) | **QA only** | **no** — trigger manually |

- Feature branches are cut from `dev` and merged back into `dev` via PR.
  **Dev merges its own feature branches into `dev`** — QA ownership starts at
  `main`, not here. Merging a feature branch into `dev` needs no permission
  and no QA pass.

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
