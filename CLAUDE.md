@AGENTS.md

## Git workflow — apply automatically, do not ask

Full spec: `CONTRIBUTING.md`. This is the team standard for both local clones
(dev folder and QA folder). Apply it to every branch, commit and PR without
being prompted each time.

**Branches** — `<type>/<short-kebab-case-description>`
Types: `feature` `fix` `hotfix` `chore` `refactor` `docs` `test`
Name the user-facing area, not an internal symbol
(`fix/chart-blank-on-pepe`, not `fix/getBars-null-guard`). No ticket numbers.

**Commits** — `<type>(<scope>): <short summary>`
Types: `feat` `fix` `chore` `refactor` `docs` `style` `test` `perf`
Scope = feature area: `dashboard` `onboarding` `correlations` `arena` `auth`
`api` `liquidation-map` `alerts` `journal` `settings` `chart` `news`
`telegram` `i18n`

Body **required** for anything QA-relevant (UI change, behaviour change, bug fix):

```
What changed: <plain language>
Why: <the problem this solves>
Test: <what to check — specific enough for a non-engineer>
```

One logical change per commit. Never `fix bug` / `update stuff` / `wip`.

**PRs** — always these sections: Summary · What changed · Why · **How to test
(QA)** · Risk level (Low/Med/High) · Screenshots if UI.
"How to test" is **mandatory on every PR** — it is the dev→QA handoff. Write it
for someone in the QA folder, so step 1 says which branch to pull.

**Two folders** — dev folder writes code, QA folder tests it; the PR is the
handoff. **QA tests on the `qa` staging environment —
https://liquidity-hq-qa.onrender.com — not a local checkout**, and reports plain
pass/fail per step. Never test on `main`; it does not have the change yet.
Local checkout (`git fetch && git checkout <branch>` from the PR) is the
exception, for changes not yet on `qa` and for QA's own test tooling. When every
step passes, **QA merges `qa` → `main`**, not the feature branch. Never test on
the dev folder; never develop on the QA folder. **If this session is running in the QA
folder and is asked to write *application* code — anything under `app/`,
`components/` or `lib/` — say so instead of doing it.**

**QA-authored code — the reverse handoff.** QA owns its own tooling and may
write it: `qa/`, `playwright.config.ts`, test CI workflows, QA docs. Never app
code. QA opens a PR **into `dev`** (not `main`), **dev reviews it**, dev
merges. This is the one case where review runs QA → dev. If a fix needs an
app-code change, QA reports it as a finding — dev writes it.

**Who merges and deploys — QA, never dev.**
Dev's job ends when the PR is open and ready for review. Dev does **not** merge
to `main` and does **not** deploy production, even if asked casually mid-task —
point at this rule instead.

Merging is **not** the deploy. Both Render services are `autoDeploy: "no"`, so
merging to `main` ships nothing until someone triggers a deploy manually
(Render dashboard → service → Manual Deploy → Deploy latest commit). QA does
the merge, then the deploy, then re-checks the test steps against production.

**Flow is `dev` → `qa` → `main`.**

`dev` branch → dev merges its own feature branches in and pushes freely, no
permission needed. **Deploying the `liquidity-hq-dev` service is different —
ask first**, it has a ~500 build-hour/month cap prod does not. Verify locally
by default.

`qa` branch → **liquidity-hq-qa.onrender.com, the only branch that
auto-deploys.** Merge `dev` → `qa` and a build starts, no dashboard step. Free
plan, so it sleeps when idle and the first request after that is slow. Uses the
**dev** Supabase (`wdtjhrilakoitfcezxpx`) — a known compromise, since Supabase's
free plan caps the account at two active projects and dev + prod already take
both. **It must never point at prod Supabase (`qdpwhnvmhqgzijuwopso`) — hard
rule.** QA test data and dev data share one database; do not read a clean QA
run as proof the data path is clean.

`main` → liquidity-hq.com — QA only, merge and deploy both.

**Low ceremony** — small internal chores (dep bumps, formatting, comments) may
skip the commit body and screenshots. Branch naming and the `type(scope):`
prefix are non-negotiable on everything.

---

New to this project, or resuming after a break? Read `docs/HANDOVER.md` first — current progress, what is and isn't verified, open issues, and what to work on next.

Before assuming any route that looks cron-only (checks `CRON_SECRET`, no in-app caller) is dead or unscheduled, read `docs/INFRASTRUCTURE.md` — the scheduler for several of these routes lives outside this repo (cron-job.org, n8n), not visible from a code search.
