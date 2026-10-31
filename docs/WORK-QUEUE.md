# Work queue — pull from here, never idle

**Lanes rewritten 2026-10-21 by PM/DevOps**, after that day's full audit, QA's full
regression and the owner's decisions (indexed in `docs/OWNER-BACKLOG.md`, "Owner decisions,
2026-10-21"). The lanes had not been rewritten since 2026-09-30 and still named BoomFi and
Polar, which the owner replaced with Whop only on 2026-10-17. Rows below name open work only.

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
| D1 | **#1631 - AI correctness** (high) | Owner-approved 2026-10-21 09:10 UTC. **CORRECTED 2026-10-30: E+B+C and A+D both SHIPPED nine days ago** - #1665 merged 2026-10-21T15:59:58Z, #1668 at 19:55:11Z. This row said "committed, PR next (heavy slot after QA's staging sign-off)", which was true for about four hours, and **PM assigned work from it on 2026-10-30 as though it were current.** Also further along than the issue text: item 3's refund is on `dev` AND `main`, and `lib/grok.ts:851`'s `?? 'FLAT'` trapdoor is no longer reachable from product code (`parseCombinedRead` refuses instead) - deleting the pair was blocked on QA moving two test imports - **PR #1832 (2026-10-30, tests only) took the last importer off `parseCombinedResponse`, so the deletion is now Dev's to write as app code.** Read QA's half-fix proof first: with the trapdoor gone but the `parseVerdict` gate ALSO removed, a verdictless answer throws, and a throw inside the route's `try` becomes a 503 - a different lie, not a fix. Proved red, not asserted. **What is genuinely open:** item 4 (forwarded size, output caps, cost - measured 2026-10-30, three real gaps, PR #1833); item 5's second half (the browser still supplies the prompt body, and the gates check *declared* coin/timeframe rather than what the prompt asks for); and a daily Deep Research check asserting a *parseable verdict* rather than HTTP 200, which is QA's. The item-4 text itself carries four claims that are no longer true - read #1631's 2026-10-30 comment, not the item. |
| D2 | **#1649 - exchange data never blocked** (high) | Phase 1 merged (#1659: shared breaker, budgets, klines range limit). Phase 2: server Bybit WebSocket. Phase 3: OKX + our own 5-minute snapshots (a table, so a migration: owner's word first). Phase 4: Hyperliquid as third source + funding-comparison inputs (owner, 2026-10-21 ~14:00 UTC). The first PR that calls OKX or Hyperliquid logs host + HTTP status once per process; PM reads the qa logs. |
| D3 | **#1662 - real liquidation levels from Hyperliquid positions** (medium) | Estimate only, at a natural break: days, memory, DB, request budget, what a first version cuts. No build before D1 and D2. |
| D4 | **#1651 - data guardrails** (high) | Owner order 2026-10-21. Reading type with ok/stale/unknown, freshness budgets, one formatter, AI input and answer checks. The PR template's data checklist (#1652) applies to every PR that adds or changes a number. |
| D5 | **#1600 - all coins** (owner, 2026-10-21 08:58 UTC) | After the server fixes; more coins may not mean more upstream calls per minute (#1649 item 5). |
| D6 | **#1632 - security items left** (high) | Includes the Next.js dependency bump (Dependabot), the liquidation page's 5,000-row download, and the AI prompts moved server-side (#1263). |
| D7 | **Fails from QA's 2026-10-21 regression** (#1640) | R1 Arena 11 px too wide at 390; R2 `/api/ath` 502 when CoinGecko answers 429; R3 `/alerts` signed-out 401s; R4 `bot-info` 500; R9 `/about` still names Finnhub; R13 econ 429 shown as "No upcoming events" (PR #1637 open). R6-R8 are visual: the owner's look first. |
| D8 | **#1818 — chart structures, Phase 0** (medium) | **The owner ordered this started on 2026-10-30 13:19 UTC — *"start it."*** Deliverable: `lib/chartStructures.ts` — swing-pivot detection with configurable left/right strength, least-squares line fit, and fit quality (R², touch count, first and last touch timestamp). **Pure functions. No UI, no AI, no network, no new dependency.** Spec: `docs/proposals/ai-chart-structures.md`, §2 and §7. **The load-bearing decision is §2: geometry is computed in code and the AI never returns a coordinate** — a model-placed line misses the candles and the user's own eyes are the test instrument. QA owns the fixtures, so the PR says what to assert and why. **Do not start Phase 1 (overlays) in this PR.** §4a binds Phase 2 and is a constraint, not advice: each rung of the timeframe ladder is a fixed-limit request, never a range, because `canFailoverForRequest(isRange)` returns `!isRange` and a range request therefore has no Bybit fallback. |

**D8 sits at the bottom of that table and is nevertheless Dev's CURRENT item.** The owner ordered
it started on 2026-10-30 at 13:19 UTC and the rows above it are not cancelled — they resume the
moment Phase 0 lands. It is written out rather than left to position because this table is read
top-down as the order of work, so a row added at the bottom reads as "later" by default, which is
the opposite of the instruction. Phase 0 is small on purpose (one file of pure functions), so the
high-priority reliability lane pauses for one item, not for a feature.

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
  running, and its cause was never attributed.

  **CORRECTED 2026-10-30: a `git push` is NO LONGER a full gate run, and the figure this note
  carried was two moves out of date.** It said the hook runs lint, `tsc` and the unit tests, so
  start a push with >= 3.5 GB free. **The hook runs `npx tsc --noEmit` and nothing else.**
  `node --test` moved to CI on 2026-10-29 and `eslint .` moved to CI on 2026-10-30; both moves
  are recorded in `.githooks/pre-push`, whose own header carries the measurement:
  **`npx tsc --noEmit`, NINE SECONDS, free 2,895 -> 1,484 MB, biggest process 428 MB** — against
  `npm run lint` at 46 seconds and free 3,622 -> 1,044 MB, which was essentially the entire cost.
  **This note gives NO replacement launch bar, deliberately, and QA was right to send the first
  version back for giving one.** That version said "~2.5 GB free", which is the figure the
  paragraph four lines above calls a misreading, and it is contradicted by a successful foreground
  push of this very branch **at 512 MB free** — a factor of five. It is also not derivable from the
  numbers beside it: a biggest-process of 428 MB and a system-wide drop of 1,411 MB measured on a
  different day, with unattributed other load, do not combine into a bar. **Replacing a stale
  number with a confident fresh one is the same error wearing clean clothes.** Whoever wants a bar
  measures it: launch, watch MIN_FREE, write down the date. Until then: read `.githooks/pre-push`,
  which is the thing that actually runs, rather than this file's copy of what it used to do.

  **Why this was wrong in a way worth recording:** the 3.5 GB figure was measured correctly on
  2026-09-24 and was never re-read after the hook was narrowed twice in two days — including once
  on the same day this correction is being written. A measured number with no re-read date behaves
  exactly like a config that was never true: it keeps being quoted, and it makes the team defer
  pushes that would now fit. File-scoped lint is still enough for a test-only PR whose base tree
  already lints clean; say in the PR that it was narrowed.
- **Foreground commands are not subject to the idle reaper; background shells are.** Run a
  quick push-and-merge in the foreground.
- **A killed `next build` leaves `.next` partial**, so `tsc` afterwards reads a broken
  `.next/types` and reports type errors that are not real. Delete `.next/types` first.
- **The owner's own apps are usually the largest holders** (Brave 2.7-4.8 GB, VS Code 2.3 GB,
  a chat app 0.4-0.9 GB). Attribute a dip with a per-step trace, not a guess.

## QA lane

| # | Item | Notes |
|---|---|---|
| Q1 | **Release v2026.10.21 on `staging`** (#1654) | Regression passed (#1640); promoted and deployed 2026-10-21 14:10-14:13 UTC (`4cfd53c`). Staging checks and sign-off; open the `staging` → `main` PR (PM's go). The staging AI check waits for 00:00 UTC (dev daily AI cap). |
| Q2 | **Review Dev's open PRs** | Dev's blockers first, then open PRs, then your own specs. #1631 E+B+C is next; its test plan is on #1631 (04:03 UTC). |
| Q3 | **#1661 - test pins for #1653** | Reaped for low memory at 14:05 UTC on 2026-10-21; retry in the foreground after Dev's #1631 push. |
| Q4 | **Tests for what merges** | QA owns every test (owner ruling, 2026-09-07). A test file must pass the PROJECT typecheck, not only a file-scoped one. |
| Q5 | **`qa` and `staging` deploys** | Yours. **Setting a variable on a Render service deploys it by itself**; expect a deploy id from whoever sets one, and read `/api/version` after. |
| Q6 | **Language scan of the ~29 pages not covered on 2026-10-21** | Chromium crashed for memory at 12:36 UTC; the 7 key pages and the release's wordings were checked. English found so far is all tracked on #1475. |
| Q7 | **Cross-browser harness (#1410)** | Owner backlog item 15: Firefox and WebKit. A browser run is a heavy job: one at a time, measure first. |
| Q8 | **Older items still open** | #1259 (make a red E2E run mean something); `TEST_GAPS.md` §1 and §6; load testing beyond one address needs many source IPs, a paid tool, so the owner's cost decision. |
| Q9 | **Fixtures for #1818 Phase 0** | QA owns every test (owner ruling, 2026-09-07). Fixture candle series plus exact expected pivots, slopes, R² and touch counts for `lib/chartStructures.ts`. **No AI call and no network — that is the whole point of Phase 0** (`docs/proposals/ai-chart-structures.md` §2), so these are the cheapest tests in the repo and they can be exact rather than approximate. **Include a negative fixture:** a series with no clean structure must return none, because "nothing clean on this timeframe" is the shippable answer — and an absence assertion needs a positive control beside it, or it passes while measuring nothing (`docs/INFRASTRUCTURE.md` §9b). Dev's PR says what to assert; whether it is covered is yours. |

## PM/DevOps lane

| # | Item | Notes |
|---|---|---|
| P1 | **Release v2026.10.21** (#1654) | After QA's sign-off: one owner approval (production migrations `20261017a` and `20261021e` plus the label files; no env change; payments stay off), then apply (`20261017a` before the deploy: this release's claim route reads its table on every signed-in page load), merge, deploy, check `/api/version`, one real AI read, a 5-minute watch, tag, closing sweep. |
| P2 | **The closing sweep, after every production deploy** | Five conditions per issue; a tracker ticks only when verified on production (`git merge-base --is-ancestor <merge> <prod sha>`). |
| P3 | **Drift check by hand while Actions cannot run** | Production served commit vs `main`, plus tags, recorded on #1413 every run. **A gap in that record is an unmeasured window, not a clean one.** |
| P4 | **Owner's batch** | One list, recommendation first. Open on 2026-10-21: the X account and a yes/no on the reply plan; the $1 Whop test; 2FA on every account; pinning `NODE_VERSION`; the three visual fails R6-R8. Drop what the owner has acknowledged and cannot act on. |
| P5 | **The heavy-job slot** | One heavy job at a time on the laptop; PM assigns it. Order set 2026-10-21: QA's staging checks, then Dev's #1631 push, then QA's #1661 retry. |
| P6 | **Record every owner decision the same day** | The "Owner decisions" table in `docs/OWNER-BACKLOG.md`, the issue it belongs to, and the Marketing seat's `FACTS.md` when it changes what Marketing may say. |

## Unassigned - take with a reason

| Item | Why it is here |
|---|---|
| **#1411 - sign-in shows a machine-generated domain** | Needs a paid Supabase plan for a custom auth domain. Owner, 2026-10-21: Supabase Pro is bought the day payments go live; the custom domain (+$10) stays later. |
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

**3. Before promoting, check that CI has actually built the head you are promoting —
and when there is no run for it, DIFF THE TWO HEADS rather than explaining the
absence.**

Found by Dev on 2026-10-30, before a 58-commit promotion. `dev`'s head
`92f27f9b` had **no CI run at all**; the newest was on `842ed35f` and still in
progress. Verified independently by PM: `git diff --name-only 842ed35f origin/dev`
returns **`CONTRIBUTING.md` and nothing else**, so the uncovered commit was
docs-only and the code being promoted *was* covered. The absence was correct.

**The reason this is a guardrail and not a note is the shape of the trap, not the
instance.** A true fact about this repository stood ready to explain the missing
run: `ci.yml`'s `push` trigger really does carry `paths-ignore` for `**.md` and
`docs/**`, and its own comment says that is deliberate and deliberately not on
`pull_request`. **Citing it would have produced the right answer for the wrong
reason** — and the same explanation would have been equally available, and wrong,
if the uncovered commits had been application code.

> **A missing CI run on a release branch is indistinguishable from a correctly
> skipped one until you diff the two heads.**

**What it costs when the guess goes the other way:** QA receives a promotion whose
final state nothing has built, **with every PR in it green** — because each PR was
built at its own head, and nothing builds the result of merging them in order.
That is a gap no individual PR's status can show.

**So, two commands, every promotion:**

```sh
gh run list --branch <branch> --limit 6 --json headSha,status,conclusion   # is there a run for the head?
git diff --name-only <newest-built-sha> origin/<branch>                    # if not, what is uncovered?
```

**A run that exists but has not finished is the same answer as no run.** Found on
this guardrail's first real use, 2026-10-30: `df1abe97` was pending at promotion
time. Wait for it to complete green, then re-read it at the moment of promoting.

**Code in that diff means wait for a run on the real head.** Docs-only means
proceed and say so. **Do not resolve it by reading `ci.yml`** — the path filter
tells you what CI *would* skip, not what it *did*.

### AMENDED 2026-10-30: `dev` no longer builds on push, so "no run" is now the DEFAULT answer

The owner removed the per-merge recheck (36 of 129 runs in two days). **`dev` is
gone from `ci.yml`'s `push` trigger**, so the first command below will normally
report **no run for a `dev` head** — and that is now the designed state rather
than the signal it used to be.

**So for `dev` → `qa` the guardrail changes shape: you create the run instead of
looking for one.**

```sh
gh workflow run ci.yml --ref dev          # leave `e2e` UNCHECKED: build-only
gh run list --workflow=ci.yml --branch dev --limit 3 \
  --json headSha,status,conclusion        # wait for conclusion=success on the head you are promoting
```

**The diff-the-two-heads step loses its meaning here**, because there is no
"newest built sha" on `dev` to diff against any more. It still applies to
`staging` and `main`, which remain on the `push` trigger.

**And the two promotions are not the same check, which the original text did not
distinguish:**

- **`dev` → `qa` is fast-forward**, so the commit landing on `qa` is bit-identical
  to the one on `dev` — `ci.yml`'s own comment is why `qa` is absent from the
  trigger. **Dispatch, wait for green, then promote.**
- **`qa` → `staging` is a MERGE COMMIT.** The resulting tree has never existed
  anywhere, so no run for it can possibly exist before the push. **There the
  check happens AFTER the push and before sign-off** — the new head's own run,
  not a diff.

**What this gives up, and it is the owner's choice made with the cost in front of
him:** between merges, `dev` is unchecked. `.githooks/pre-push` runs `tsc` and
nothing else, so lint, unit tests and build are unverified on `dev` until someone
dispatches. **This guardrail stops being a good habit and becomes the only thing
standing between a broken merge and `qa`.**

**THE TWO HOPS ARE NOT THE SAME CHECK, and the first version of this guardrail
could not be executed on one of them.** QA caught it against the promotion they
own:

> **`dev` → `qa` is fast-forward, so dev's run IS the coverage and this check
> happens BEFORE promoting. `qa` → `staging` is a merge commit that has never
> been built anywhere, so there the check happens AFTER the push and before
> sign-off — the new head's own run, not a diff.**

A merge commit's tree has never existed in any branch, so **no run for it can
possibly exist before the push.** "Check CI built the head you are promoting" is
not a check that can pass or fail there; it is structurally unavailable. `staging`
is in the `push` trigger, so the run does happen — what this guardrail asks for on
that hop is that **sign-off waits for it.**

### A coupling that is load-bearing and lives nowhere a promoter reads

**The browser suite reaches `staging`'s content only because the release PR is
opened BY HAND.** `ci.yml` records that `staging` joined the `push` trigger on
2026-08-10 because the fast-forward argument *"turned out not to cover the browser
suite"*, and that the 38-minute e2e job *"was reaching `staging` through a release
PR that has since stopped being opened"* (#207).

That is still the situation: `RELEASE_PR_PAUSED=1` since **2026-08-09**, and
PM/DevOps opens the `staging` → `main` PR manually. **That PR has base `main`,
which the `pull_request` trigger covers — so the hand-opened PR is what pulls the
browser suite over staging's content.**

> **If the release PR is ever skipped as a convenience, staging's browser coverage
> goes with it, and nothing announces that.**

Recorded here rather than left in a `ci.yml` comment referencing an issue, because
this is the page a promoter actually reads. Found by QA while reviewing the
guardrail above.

**Not adopted from that doc, and why:**
- A drift check that needs a local Supabase stack (there isn't one on this machine) and
  generates migrations itself. A generated diff can contain DROPs.
- A circuit breaker that halts every session.
- Scripts that carry Slack or Telegram tokens. Secrets stay in the git-ignored `.env.local`.

Visual sign-off stays with the owner (condition 5).

## Owner-only - do not queue these

**Payments go-live (#1567) — Whop only since 2026-10-17. The BoomFi/Polar plan below is
SUPERSEDED and kept only as history.** Lemon Squeezy, Polar and Paddle rejected the store; the
owner chose Whop on 2026-10-17. The Whop unlock is built and ships in release v2026.10.21, but
**production has no Whop variables, so nothing can be bought there** (PM read the names on
Render, 2026-10-21 ~14:17 UTC). What turns it on, all the owner's: his $1 test payment; the
three checkout links, the webhook secret, the company id and the plan ids set together on
production (never the links alone); Supabase Pro the same day.

**Superseded 2026-10-17: Payments go-live (#861) — REPLANNED 2026-09-30, the Lemon Squeezy paragraph that used to
sit here is DEAD.** Lemon Squeezy rejected the store application outright (crypto
trading-signals business, no specific fix offered, no reapply path) — the "Copy to Live
Mode" / store-activation flow below never happens now. Full record and the current plan:
**#861's 2026-09-30 comment.** Short version:
- **BoomFi is PAUSED — owner, 2026-10-23. Whop is the payment route and the priority.**
  This line read **"BoomFi (crypto) is live"** until then, which would have had the next
  reader treat crypto as a working path to revenue. It is not.

  **What is still true and is why the pause matters:** three real payment links were
  created, priced at the **superseded** figures — **Monthly $35, Yearly $350**, Weekly $10.
  Live prices are **$20 / $49 / $490**. `lib/boomfiEntitlement.ts` maps a plan by the exact
  amount paid, and its table holds 49 / 490 / 20 / 10 — so **a $35 payment matches nothing
  and goes to review, never Pro.** Combined with `boomfiWebhook: false` on production, a
  payment on a stale link would arrive at BoomFi and the product would never hear about it:
  money in, nothing out, no alert. **Raised with the owner 2026-10-23; he confirmed the
  pause.** Whether the links are deleted is his call and lives in his BoomFi dashboard, not
  in this repo.

  Settlement ran Base/Binance/Solana/TON; Polygon and Arbitrum were off (they caused a real
  duplicate-account bug, root-caused not guessed). Kept for whenever crypto resumes.
- **Polar (fiat/card) is spec'd, not started.** No entity needed (individual/sole-proprietor
  onboarding), needs a landing-page copy reframe before applying (exact swaps + a footer
  disclaimer are on #861), then the application itself (~14 day review).
- **Phase 1 is on `qa` and `staging` (first deployed as `c67a61b` on 2026-09-30; read `/api/version` for the commit served now), not on production.**
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

**CORRECTED 2026-10-30: backups were NEVER blocked by funding, and reading it that way cost
seven weeks.** The sentence here said they were deferred until the owner paid for Supabase Pro.
What Pro buys is *managed* backups. **It does not make a backup possible; it makes one convenient.**

**The production database is 32 MB.** A nightly export is small, free, and runs on machinery that
already exists - `app/api/liq-events/purge/route.ts` is cron-authed with `checkCronAuth`, driven
by cron-job.org, and `CRON_SECRET` is already set on production. **A nightly backup route is being
built on that pattern.** Owner raised it on 2026-10-30 and was right to ask why it had not moved.

**The rule that follows is UNCHANGED while no backup exists: no destructive migration touches
production.** Additive only - `add column if not exists`, new tables, new policies. **It stops
applying only when a restore has been PROVEN**, not when a backup file first appears. A backup
nobody has restored is not a backup.

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
