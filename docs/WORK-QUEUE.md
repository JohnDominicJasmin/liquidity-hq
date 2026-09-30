# Work queue — pull from here, never idle

**Lanes rewritten 2026-09-30 by PM/DevOps, after the closing sweep.** The owner resumed the
team the same day he paused it (recorded on #861), then said to work every open item, with
payments (BoomFi, Polar) last. Rows below name open work only; the Lemon Squeezy rows are
gone because those issues closed (#1422, #1423, #1429, #1400, #1428) and the processor
rejected the store.

**This file exists because the PM was the bottleneck.** On 2026-09-06 both the Dev
and QA sessions finished their work and then *waited* for the next assignment.
Twice. The owner's instruction, verbatim:

> *"Your number one job here as project manager is to assign items to dev and QA,
> also to keep them working, to avoid them pausing or having blockers."*

A queue that lives in one session's head is a queue that stops when that session is
mid-task. This one lives in the repo.

---

## The rule

**Never end a turn with no work in progress.**

1. Finish your current item.
2. Take the **next unclaimed item in your lane** below. Claim it by editing this
   file — one line, `**CLAIMED** <session> <date>` — in the same PR as the work, or
   before it if the work is long.
3. **If your lane is empty**, take from the other lane if it is yours to do
   (QA never writes app code; Dev never writes QA tooling), otherwise take the
   highest-value thing you can see and **add it here** so the next reader knows it
   was deliberate.
4. **Never wait for the PM to hand you an item.** If a decision is needed, make it,
   do it, and say what you decided. Only three things genuinely require someone
   else: merging to `main`, production deploys, and writes to the shared database.

**Blocked is not idle.** If item 1 blocks, take item 2 and say on the issue what
blocked and why. A session that stops is more expensive than a session that picks
the wrong item.

**Filing issues: group them, don't scatter them.** This is the owner's instruction from
2026-09-12, when open issues reached 52: *"if we have multiple small issues and they are
related to each other or in similar page or problem just create one issue and put it all
there"*. So:
- **Before filing, check the open trackers** (`gh issue list --search "tracker in:title"`).
  If one covers the page or problem, add your finding there as a checklist line in a
  comment. Open a new issue only when nothing fits. If you're starting an area that will
  collect findings, give it its own tracker, titled "… (tracker)".
- **To fold an issue into a tracker,** run `gh issue close N --duplicate-of T` and leave a
  comment that says where it went.
- **A tracker closes only when every item on it is verified on production.** Folding an
  issue in doesn't close it early, and the five conditions in `CLAUDE.md` still apply to
  every item.
- **Leave an issue alone while a PR that says "Fixes #N" is in flight.** Fold it in after
  that PR lands.

On 2026-09-12 this took the open count from 52 to 24: 13 trackers absorbed 28 issues. In
the week before, 154 issues had been opened and 107 closed.

---

## How to read this file

**Live state comes from `gh pr list`, `gh issue list` and `git ls-remote`, not from this
file.** Rewritten 2026-09-24 by PM/DevOps, after a week in which it named finished work
and pointed at releases that had long shipped. What is recorded below is the *shape* of
each lane and the reasons, which survive; PR numbers are the durable handles, and a
PR's state is whatever GitHub says it is today.

**Priority is the label, and the owner's order is the tiebreak:** the reliability of the
data, the signals, the macro and the technicals first; payments and getting users next;
UI polish last and only when there are paying users (`CONTRIBUTING.md`, *What "closed"
means*). **Every issue carries exactly one `priority:` label.**

## Dev lane

| # | Item | Notes |
|---|---|---|
| D1 | **One "is Pro buyable" check** (`fix/pro-buyable-one-predicate`) | `/upgrade`, the upgrade prompts on locked features and the trial-ending email each decided "can Pro be bought" from the Lemon Squeezy link. On `qa` that link is still set, so a locked-feature prompt sent a Free user to the rejected store. Blocks crypto on production. |
| D2 | **#1434 - unknown URLs return 200 on production again** (medium) | #157 regressed. Small and production-facing, so it goes first among the backlog. |
| D3 | **#1263 - Arena and Strategy Panel: saved selections vs settings load** (high) | Read the tracker first; say on it what you are taking. |
| D4 | **#1113 - onboarding and first run** (high) | Same. |
| D5 | **#1404 and #1397 - zero upstream calls per visitor, traffic readiness** (high) | Partly shipped. The trackers say what is left; do not assume from this row. |
| D6 | **#1173 - auth and session timeouts** (medium) | |
| D7 | **#1403 - record which plan a subscriber bought** | Rethink: the issue was written for Lemon Squeezy variants. Under BoomFi it is `billing_provider` plus which plan. Say on the issue what it becomes before building. |
| D8 | **Payments (#861), parked by the owner on 2026-09-30: "put boomfi in last"** | Built and waiting: the entitlement decision as a pure function (`feature/boomfi-entitlement-prep`, local), the landing reframe for Polar (`feature/landing-reframe-review`, local). Blocked on the owner: his $10 test payment (the only source of a real BoomFi event), a cancel route for a BoomFi subscriber, the Polar application. |

**UI polish and accessibility audit work: last, not parked.** The owner parked it on
2026-09-19 and on 2026-09-30 said to work "all items, issues, PRs and backlogs". So it is
in the queue after everything above, lowest priority first to be dropped if time runs out.
The trackers hold the built branches, which are kept: **#1309** (#1386, #1393, #1390),
**#1347** (#1392), **#1185** (#1387, #1407), **#1111** (#1391, #1408), plus **#1455** and
**#1114**. Anything visual still needs the owner's look before it closes. **A screen that
crashes or does not show data is worked at once.**

**Standing, not numbered:** review and merge QA's open PRs into `dev` without being
asked (QA writes every test; Dev reviews them); apply the visual rule - **bordered outlines
only for things that respond to a click; one corner radius for containers, one for
controls** - to anything you touch.

**Machine rules, added 2026-09-12 after two memory kills and a 30-minute dev outage:**
- **One local `next build` at a time, across all folders.** Check for another `next` process before starting.
- **Stop local servers you aren't using.** Each one is ~0.5–1 GB, and it joins the retry storm whenever the dev database degrades.
- **No DDL on the dev database while QA has a pass running.** Any DDL fires a PostgREST schema reload, and on 2026-09-12 one additive column caused 30+ minutes of degradation. See #1025.

**Added 2026-09-24, from measurements rather than inference** (`docs/HANDOVER.md` section 14):
- **The harness reaper, not the build guard, is the binding limit.** It kills background
  shells at roughly **1.5-1.9 GB free**; the guard's 350 MB line has never fired first. A
  build passed the 2.6 GB start floor at 3.56 GB free and was reaped mid-run.
- **Launch bars: >= 4.5 GB free, held for five minutes, for a `next build`; >= 3.0 GB for a
  narrowed gate.** **Read free memory again at the instant of launch** - a hold window
  certifies the past, and a go-ahead given on a stale figure lost the race on 2026-09-24.
- **Heavy jobs run in BATCHED WINDOWS, not one push at a time (owner's order, 2026-09-27).** A window
  is opened by PM, once or twice a day at a time the owner names (default: the end of his day).
  **Heavy = any `git push` (the hook runs lint, `tsc` and every unit test), any full suite, any
  browser spec run, any local `next build`.** Between windows Dev and QA code and commit LOCALLY
  (file-scoped lint is fine) and post what is waiting on the issue or PR; in the window everything
  queued is pushed sequentially in one pass. The owner should not have to close his browser or stop
  what he is doing more than once a day. **Emergencies only** (production down, a security problem)
  may break the rule, and need the owner's word. **No local `next build` as a routine gate:** Render's
  hosted build on the `qa` deploy is the build gate; build locally only when a change touches build
  settings or dependencies. **Never terminate the owner's programs** (game, browser): a memory
  shortfall is solved by the window, not by closing his things. Why: on 2026-09-26 the shotgun pattern
  (a push per small change) produced repeated reaped jobs and made the owner close his browser five
  times in one day.
  **Light work stays allowed between windows:** a single-file `node --test`, a mutation run of one
  test file (~300 MB) and file-scoped lint are not "heavy"; "any full suite" means the whole suite.
- **What the gates cost, measured as the LOWEST free memory reached (MIN_FREE) - not as memory
  consumed.** Launched at >= 3.0 GB free, a test-only gate bottomed out at **~2.3-2.6 GB free
  during `tsc`**, and a full `eslint .` reached **~1.67 GB free**, just above the reaper line;
  a file-scoped `eslint <file>` (~150 MB) is the lightest step. **Do not read "floor" as
  consumption:** a first version of this note said a push "is a 2.5 GB job", which misread those
  figures. One run (3.15 GB start, 0.49 GB low) shows what happens when something else is also
  running, and its cause was never attributed. **The pre-push hook runs lint, `tsc` and the unit
  tests, so a `git push` is itself a gate run - start it with >= 3.5 GB free.** File-scoped
  lint is enough for a test-only PR whose base tree already lints clean; say in the PR that it
  was narrowed.
- **Foreground commands are not subject to the idle reaper; background shells are.** Run a
  quick push-and-merge in the foreground.
- **A killed `next build` leaves `.next` partial**, so `tsc` afterwards reads a broken
  `.next/types` and reports type errors that are not real. Delete `.next/types` first.
- **The owner's own apps are usually the largest holders** (Brave 2.7-4.8 GB, VS Code 2.3 GB,
  a chat app 0.4-0.9 GB). Attribute a dip with a per-step trace, not a guess.

## QA lane

| # | Item | Notes |
|---|---|---|
| Q1 | **Tests for what merges** | QA owns every test (owner ruling, 2026-09-07). A test file must pass the PROJECT typecheck, not only a file-scoped one: on 2026-09-30 a new test passed alone and failed the hook, costing a push. |
| Q2 | **Review Dev's open PRs** | Dev's blockers first, then open PRs, then your own specs. |
| Q3 | **Cross-browser harness (#1410)** | Unparked 2026-09-30. Two extra routes (`/`, `/funding`) to commit, then a run against staging. A browser run is a heavy job: one at a time, measure first. **WebKit is not installed: Safari is unclaimed.** |
| Q4 | **#1259 - make a red E2E run mean something** | |
| Q5 | **`qa` and `staging` deploys** | Yours. **Setting a variable on a Render service deploys it by itself** (PM learned this on 2026-09-30 by doing it); expect a deploy id from whoever sets one, and read `/api/version` after. |
| Q6 | **Payments (#861), parked with Dev's D8** | Waiting on the owner's test payment: the second reading of the recorded event, then tests for the entitlement decision. Two PM rulings are on #861 (an email mismatch credits the account the link named; "overdue" does not end access, the paid-through date does). |
| Q7 | **Load testing beyond one address** | A single source hits our own per-IP limit long before the service. Real load needs many source IPs, a paid tool, so the owner's cost decision. **The page ramp yielded no ceiling and none is claimed.** |
| Q8 | **Older items still open** | `TEST_GAPS.md` §1 (server time not controllable) and §6 (accessibility asserted, never heard). |

## PM/DevOps lane

| # | Item | Notes |
|---|---|---|
| P1 | **The closing sweep, after every production deploy** | Five conditions per issue; a tracker ticks only when verified on production (`git merge-base --is-ancestor <merge> <prod sha>`). |
| P2 | **Drift check by hand while Actions cannot run** | Production served commit vs `main`, plus tags, recorded on #1413 every run. **A gap in that record is an unmeasured window, not a clean one.** |
| P3 | **The release batch** | Wording and database changes the owner must approve. See "Owner-only" below; nothing is applied without his word each time. |
| P4 | **Owner's batch** | One list, recommendation first. Drop what the owner has acknowledged and cannot act on. |
| P5 | **The heavy-job slot** | One heavy job at a time on the laptop; PM assigns it. |

## Unassigned - take with a reason

| Item | Why it is here |
|---|---|
| **#1411 - sign-in shows a machine-generated domain** | Needs a paid Supabase plan for a custom auth domain; **deferred by the owner.** The Supabase paid-plan decision lives on that issue now. |
| **#1152 - plans and upgrade messaging** | PR #1463 (one source for the Free and Pro feature lists) and its test #1464 are built and pushed; **held for the owner's look**, screenshots taken 2026-09-30. Do not merge #1464 first: it sits on #1463. |
| **#1413 - GitHub Actions cannot start** | The account is locked for billing; acknowledged by the owner. The drift check is done by hand meanwhile. |

---

## Release and loop guardrails

**Added 2026-09-12 with the owner's go-ahead**, adapted from a proposed "swarm guardrails"
doc. Both tools are read-only.

**1. Before every release, check that its migrations are applied.** Run
`node scripts/migration-check.mjs --range origin/main..origin/staging --absent-only`, then
run the SQL it prints through the Supabase tool's `execute_sql` on production. Do the same
with `--env dev` on dev. **Every object must be present before the deploy that needs
it.** Paste the result into the release PR. A migration file that's merged but not applied
isn't done: applying it goes to the owner first, because it's a write to the shared
database, and it must be additive, because production has no backups. Leaving out
`--range` audits every migration file, not just the release's.

**2. Three failed QA rounds on one PR: freeze that PR, not the team.** QA starts a
failing verdict with `**QA: not ready**`. Before sending a PR back to Dev, the PM runs
`node scripts/qa-rounds.mjs <PR>`, which exits 3 once a PR has had 3 failed rounds. When
it does: say on the PR that it's frozen, add it to `docs/OWNER-BLOCKERS.md`, and move Dev
and QA to their next items. **Nobody stops.** The "never idle" rule outranks any single PR.

**Not adopted from that doc, and why:**
- A drift check that needs a local Supabase stack (there isn't one on this machine) and
  generates migrations itself. A generated diff can contain DROPs.
- A circuit breaker that halts every session.
- Scripts that carry Slack or Telegram tokens. Secrets stay in the git-ignored `.env.local`.

Visual sign-off stays with the owner (condition 5).

## Owner-only - do not queue these

**Payments go-live (#861) — REPLANNED 2026-09-30, the Lemon Squeezy paragraph that used to
sit here is DEAD.** Lemon Squeezy rejected the store application outright (crypto
trading-signals business, no specific fix offered, no reapply path) — the "Copy to Live
Mode" / store-activation flow below never happens now. Full record and the current plan:
**#861's 2026-09-30 comment.** Short version:
- **BoomFi (crypto) is live** — 3 real payment links exist (Monthly $35, Yearly $350, Weekly
  $10 as the BoomFi-only 2wk substitute). Settlement runs Base/Binance/Solana/TON; Polygon
  and Arbitrum are off (they caused a real duplicate-account bug there, root-caused not
  guessed).
- **Polar (fiat/card) is spec'd, not started.** No entity needed (individual/sole-proprietor
  onboarding), needs a landing-page copy reframe before applying (exact swaps + a footer
  disclaimer are on #861), then the application itself (~14 day review).
- **Phase 1 is on `qa` and `staging` (commit `c67a61b`, 2026-09-30), not on production.**
  `/upgrade` on `qa` shows a "Pay with Crypto" step; a record-only webhook at
  `/api/boomfi/webhook` stores what BoomFi sends and grants nothing. BoomFi's one webhook
  address points at `qa`. `staging` has none of the BoomFi variables, so it shows the
  coming-soon card; that is the parked state, not a fault.
- **What keeps crypto off production, all the owner's:** his one real $10 payment (BoomFi has
  no test mode and publishes no example event, so auto-unlock is built from that recording);
  a cancel route for a BoomFi subscriber; then the migration, the variables and the webhook
  address on production. He ruled on 2026-09-30 that the buttons wait for auto-unlock, and
  later the same day that BoomFi goes last.
- **Known about the network:** from the owner's home connection `pay.boomfi.xyz` resolves to
  an address that is not BoomFi's and the page does not open. Record which network any
  checkout result came from.

**Also the owner's:** the recurring 5-minute `POST /api/market/ingest` entry with
`x-cron-secret` (one entry per environment, each with its own secret - never a prod secret on
`qa`/`staging`); the two dashboard checks (PostHog receipt, GlitchTip alert recipient);
wording approval for #1346 and #1292 and the label rows they need; the pricing copy on the
landing page ("$35/mo", "every 2 weeks", "2 months free"); **#1116** (redistribution rights
for proxied exchange data - a legal question); **#1117** (whether to tell customers the AI
is included); **#1159** (leaked-password protection, deferred with the Supabase upgrade);
**#372** (annual subscription - paused by the owner). **#1413:** GitHub Actions cannot start
while the account is locked; nothing else depends on it.

**Backups remain deferred to funding** (`docs/OWNER-BLOCKERS.md` row 1), with the rule that
follows: **while there is no backup, no destructive migration touches production.** Additive
only - `add column if not exists`, new tables, new policies.

---

## Keeping this file honest

**It goes stale the moment it stops being edited in the same PR as the work.** That
is the failure this repo has hit repeatedly — a document asserting a state it cannot
observe. See `CONTRIBUTING.md` §3 on Risk-level caveats, and `.githooks/pre-push`'s
header on comments that assert external state.

So: **claim in this file, and close in this file.** If an item is done, delete the
row rather than marking it — git history is the record. If an item turns out to be
wrong or already fixed, say so in the commit that removes it.

**Counts and sizes here are estimates from 2026-09-06 and will drift.** The issue
numbers and file paths are the durable parts; the sizes are not.
