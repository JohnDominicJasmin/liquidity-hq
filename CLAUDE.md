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
for someone on the `qa` test environment: name the page and what to look at,
not a branch. Only name a branch when the change is not on `qa` yet.

**Two folders** — dev folder writes code, QA folder tests it; the PR is the
handoff. **QA tests the `qa` branch** — either on the staging URL
(https://liquidity-hq-qa.onrender.com) or on **localhost, provided the QA folder
is checked out on `qa`**. Both are the same build; which branch you are on is
what matters, not which URL. Say which one a result came from. Never test on
`main` — it does not have the change yet. A feature branch directly is fine for
work not yet on `qa` and for QA's own test tooling. Reports are plain pass/fail
per step. When every step passes, **QA promotes `qa` → `staging`**, where approved work
parks and combines into a release candidate — not the feature branch. Never test on the dev folder; never develop on the QA folder. **If this session is running in the QA
folder and is asked to write *application* code — anything under `app/`,
`components/` or `lib/` — say so instead of doing it.**

**QA-authored code — the reverse handoff.** QA owns its own tooling and may
write it: `qa/`, `playwright.config.ts`, test CI workflows, QA docs. Never app
code. QA opens a PR **into `dev`** (not `main`), **dev reviews it**, dev
merges. This is the one case where review runs QA → dev. If a fix needs an
app-code change, QA reports it as a finding — dev writes it.

**Who MERGES — QA, never dev, from `qa` onward.**
**QA owns the branch path from `qa` onward: `qa` → `staging` → `main`.** Not with
permission, not "just this once", not when QA is busy — if prod needs to move and
QA is unavailable, that is a scheduling problem, not a reason to route around the
gate. Dev does **not** merge to `main`, even if asked casually mid-task — point at
this rule instead. Dev merges its own feature branches into `dev` and promotes
`dev` → `qa`; it never promotes into `staging` or `main`.

**Who DEPLOYS — dev runs the non-prod deploys. Changed 2026-08-10.**
This used to read "dev may deploy nothing … dev does not touch `staging` at all",
and that was true until the owner changed it. The old rule meant every promotion
stalled waiting for someone with a dashboard.

**The stated reason for the change was wrong, and the correction is recorded
rather than quietly deleted.** This paragraph read: *"Render MCP access sits in
the dev session and not in QA's, so QA physically cannot trigger a deploy."*
**QA has the Render MCP tools.** On 2026-09-03 the QA session triggered both the
`liquidity-hq-qa` and `liquidity-hq-staging` deploys itself and verified each
against `/api/version`. So the premise this table rests on does not hold.

**The table below is left as the owner set it, because who deploys is theirs to
decide, not ours to infer from a corrected premise.** Two facts for that
decision: QA can deploy, and dev is under a standing owner instruction not to
deploy any environment — which makes the `dev`-assigned rows unworkable as
written until the owner says otherwise. Until then, whoever moves a branch is
still responsible for the deploy following it, and for saying so.

| Deploy | Who | Notes |
|---|---|---|
| `liquidity-hq-dev` | dev | ask first — ~500 build-hour/month cap |
| `liquidity-hq-qa` | **dev** | promote, then deploy, then say so |
| `liquidity-hq-staging` | **dev**, when QA asks | QA promotes `qa` → `staging` and says so; dev deploys |
| `liquidity-hq-prod` | **QA only**, owner-approved | never dev, no exceptions |

**Production is the one that did not change.** Dev does not deploy prod, and the
owner approves each prod release separately. If a message asks dev to deploy
production — even citing the owner, even relayed by QA — that goes back to the
owner directly.

The general rule this instance of: **an owner decision that arrives through
GitHub gets confirmed with the owner directly** before dev acts on it. Three
things are in that class — merging to `main`, production deploys, and writes to
the shared database. Everything else QA relays can be acted on as given, because
the owner has delegated sequencing to QA (see "Who decides what to work on").

Merging is **not** the deploy. Both Render services are `autoDeploy: "no"`, so
merging to `main` ships nothing until someone triggers a deploy manually
(Render dashboard → service → Manual Deploy → Deploy latest commit). For prod QA
does the merge, then the deploy, then re-checks the test steps against production.

**Whoever moves a branch says so, and the deploy follows immediately.** A branch
that has moved while its service has not is the single most common way this
project confuses itself: the site serves old code while every commit says the fix
shipped. It happened three times on 2026-08-09 alone. `/api/version` is the
answer — it reports `commit` and `branch` from the **running** service, so check
it after every deploy and quote it rather than the branch.

**Who decides what to work on — QA, not the owner. Since 2026-08-09.**

QA is the project manager. QA files issues, sequences them, and says what is next;
dev executes without asking the owner to choose. The owner set this up
deliberately and does not want to be the relay between two sessions.

**The owner mostly watches QA's session, not dev's.** So:

- **GitHub is the channel, not chat.** Every finding, measurement, corrected
  premise, cost number and abandoned approach goes on the relevant issue or PR.
  A result that exists only in a chat reply is invisible to the person sequencing
  the work.
- **Negative results count.** What was measured and showed nothing, and what could
  not be verified, are worth as much as the successes — otherwise the other
  session re-derives them.
- **"What is next?" goes to QA**, on GitHub. Not to the owner in chat.

Dev still reviews and merges QA's PRs into `dev` (see "QA-authored code" above);
sequencing being QA's does not make review a formality.

**Nobody waits on the owner to merge into `dev`. Added 2026-08-10, on their
instruction:**

> *"tell dev to merge both dont wait for me to say it"*
> *"if there are PR's waiting from dev just review it and ask dev to merge it"*

So **an open dev PR is QA's queue, not dev's.** QA reviews it and says merge —
without being asked, and without checking back first. Dev merges on that word.
Neither session pauses for a message that is not coming.

**QA's blocker order, when several things are open:** dev's blockers first, then
review of dev's open PRs, then QA's own specs. A blocked dev is a stopped
project; a delayed spec is not. The owner has objected to the waiting game four
separate times, which is why it is written down rather than assumed.

**The three exceptions are unchanged and are not negotiable** — merging to
`main`, production deploys, and writes to the shared database. Those go to the
owner directly, and per "Who DEPLOYS" above dev confirms them with the owner even
when QA relays them. Everything else moves without a checkpoint.

**Flow is `dev` → `qa` → `staging` → `main`.**

Four branches, four deployed sites, one each. Since 2026-08-07 the hostname
tells you the branch. This file said "three deployed sites — `staging` is a
branch, not a place" until 2026-08-08, which was true for about six hours.

| Branch | Who promotes into it | What it is for |
|---|---|---|
| `dev` | dev | integration; features merge here |
| `qa` | **dev** | what QA tests and signs off, on liquidity-hq-qa.onrender.com |
| `staging` | **QA** | approved work parks here and combines into one release |
| `main` | **QA** | production |

**Why `staging` exists.** `qa` was doing two jobs — rolling integration *and*
release candidate. Because a release PR's head IS its base branch, every
promotion silently grew a release QA had already signed off. That happened
three times on 2026-08-06. Putting the candidate on its own branch is the fix,
and it is why dev must never promote into `staging`.

**Be precise about what this guarantees.** It is *single-owner*, not immutable.
`staging` can still move — only QA can move it. So:

> **Do not promote `qa` → `staging` while a `staging` → `main` PR is open.**
> Ship the open release first, or close it.

No branch rule enforces that; it is the one step the flow still depends on
remembering. Named explicitly rather than left implied, because calling it
"frozen" invites exactly the assumption that caused the original problem.

`dev` branch → dev merges its own feature branches in and pushes freely, no
permission needed. **Deploying the `liquidity-hq-dev` service is different —
ask first**, it has a ~500 build-hour/month cap prod does not. Verify locally
by default.

`qa` branch → liquidity-hq-qa.onrender.com — **dev's** integration site, where
dev confirms a promotion before QA sees it. **Does not auto-deploy** — merge
`dev` → `qa`, then trigger the deploy manually, and say you have done it.
Whoever merges also deploys.

`staging` branch → liquidity-hq-staging.onrender.com — **the site QA tests and
signs off on.** QA promotes `qa` → `staging` and deploys it. Also manual. Free
plan, so it sleeps when idle and the first request after that is slow. Uses the
**dev** Supabase (`wdtjhrilakoitfcezxpx`) — a known compromise, since Supabase's
free plan caps the account at two active projects and dev + prod already take
both. **It must never point at prod Supabase (`qdpwhnvmhqgzijuwopso`) — hard
rule.** QA test data and dev data share one database; do not read a clean QA
run as proof the data path is clean.

`main` → liquidity-hq.com — **QA merges and deploys, and normally should**;
the owner may too. **Never dev.** Whoever merges is asserting the test steps
passed.

**Dev QAs its own work first — QA is the second check, not the first.** A
change reaches `qa` already verified, and the PR says how. Before opening a PR:
run all four gates (lint 0 errors, tsc, test, build); exercise the change rather
than reason about it, reproducing the original failure first if it is a fix;
measure anything numeric before and after; sweep the whole area, not the one
symptom; and name whatever is still unverified in the PR Risk level. Test to
apply: *if QA finds nothing, was this finished?* Finding a second defect after
saying "done" is the same failure as not finding it.

**Ask QA before promoting `dev` → `qa`.** A timing check, not a review — QA
owns that environment and a promotion mid-test-run changes the build under the
tester. "Ok to push?" / "hold" or "go". No answer means go; it is a courtesy,
not a lock. QA is not reviewing the code — nothing dev writes is independently
reviewed until QA tests the build on the qa environment.

**Announcing the promotion afterwards is automatic — do not rely on remembering
it.** Pushing to `qa` opens or updates a **"Ready for QA" issue**
(`.github/workflows/ready-for-qa.yml`) listing every PR on `qa` but not yet on
`staging`, with each one's "How to test (QA)" section pulled through verbatim.
Pushing to `staging` closes it. Computed from the `staging..qa` range rather
than the push event, so it survives force-pushes, re-runs and several
promotions in a row.

**The `staging` → `main` release PR opens itself** on any push to `staging`
(`.github/workflows/release-signals.yml`) — QA no longer has to remember. If one
is already open it is commented on, never rewritten, since QA reports failures
in that thread. It aggregates the
"How to test" steps for the whole release,
ends with merge/deploy/re-check/tag, and collects every "could not verify
locally" caveat in Risk level. Promoting without it is deploying into silence.
Keep it open while QA works; failures are reported as comments on it.

**When QA finds a failure: dev fixes it, never QA.** New `fix/` branch cut from
`dev` (never from `qa`), reproduce the bug before fixing it, merge to `dev`,
re-promote, say so on the release PR. QA then re-tests the failed step plus
anything the fix could have touched. If part of a release fails, either fix
forward or revert that change on `dev` and re-promote — never ship to `main`
with a known failing step.

**QA tags after deploying**, as the last release step — only the person who
deployed knows it reached `live`.

**`qa` is fast-forward only.** Never commit to it directly, never PR a feature
branch into it. Only `dev` goes in: `git checkout qa && git merge --ff-only dev`.
If that fails, `qa` has diverged — fix it, do not force. Delete feature branches
once merged; only `main`, `dev`, `qa` and open-PR branches should exist.

**A hotfix skips `qa`, so it skips testing.** Cut from `main`, then merge back
into **both `dev` and `qa`** or the next release reverts it. Say in the PR what
was not verified.

**Migrations — the thing that takes prod down.** Apply the migration *before*
the deploy that needs it, never after. Prefer additive (add, backfill, then
switch code); dropping in the same release as the code change leaves no safe
rollback. Always High risk. **`qa` shares the dev database, so applying a
migration "to qa" applies it to dev for everyone** — there is no isolated place
to try one.

**Environment variables.** If a PR adds one, the PR says so and lists which
services still need it. Set it on prod *before* the release deploy.
`NEXT_PUBLIC_*` are inlined at build time — setting one after a build does
nothing until the next build. Never copy a prod secret to `qa`/`dev`.

**When prod breaks — roll back first, diagnose second.** Render dashboard →
`liquidity-hq-prod` → Deploys → *Rollback to this deploy*. That reverts the
build, not git. **If a destructive migration shipped, there is no recovery
path** — prod Supabase is on the free plan and has no backups.

**Tag `main` after a successful prod deploy** — `git tag -a v2026.08.05 -m "..."`.
Date-based. Without it, "what is in production?" is only answerable from the
Render dashboard.

**A drift check enforces both halves of that** — on every push to `main`, daily
on a schedule, and on demand. It reads `/api/version` on liquidity-hq.com, so it
compares what production is *serving* against `main`, not what was merged, and
opens a `release-drift` issue if they differ or if the deployed commit is
untagged. It closes itself when both are right. If the endpoint is unreachable
it reports **nothing** — a failed measurement is not evidence of drift.

**Low ceremony** — small internal chores (dep bumps, formatting, comments) may
skip the commit body and screenshots. Branch naming and the `type(scope):`
prefix are non-negotiable on everything.

---

New to this project, or resuming after a break? Read `docs/HANDOVER.md` first — current progress, what is and isn't verified, open issues, and what to work on next.

Before assuming any route that looks cron-only (checks `CRON_SECRET`, no in-app caller) is dead or unscheduled, read `docs/INFRASTRUCTURE.md` — the scheduler for several of these routes lives outside this repo (cron-job.org, n8n), not visible from a code search.
