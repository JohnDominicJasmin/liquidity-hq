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

---

### AMENDED 2026-11-07: THIS RULE FAILED, AND IT FAILED BECAUSE IT IS ADDRESSED TO A SESSION THAT CANNOT HEAR IT

**On 2026-11-07 the project sat still for about six hours with every session idle, and the
OWNER was the one who noticed.** He had to say *"Why no one is working? Dev and QA."* and then
*"You should ping the team."* That is precisely the bottleneck this file was created to remove,
reappearing with the owner in the PM's old seat.

**What actually happened, in order:**

1. Dev finished #2024, messaged QA, and ended its turn. Correctly — it reported and handed off.
2. QA had its own work, kept going, and did not look at whether anyone else had stopped.
3. PM/DevOps went offline mid-release with the prod deploy and `20261031a` both on its lane.
4. Three merge-ready PRs (#2021, #2025 and one parked) sat untouched. Nothing was blocked. Nothing moved.

**WHY "NEVER END A TURN WITH NO WORK IN PROGRESS" DID NOT PREVENT IT.** These are interactive
sessions, not autonomous loops. A session's turn ends when it replies; it cannot choose to keep
itself running. So the rule is addressed to the one party structurally unable to act on it — the
session that has already stopped. **An idle session is not refusing to read this file. It has no
turn in which to read anything.**

Writing the rule more firmly cannot fix that. The gap is that **nothing and nobody was watching
for a stall**, so the first detector was the owner.

### THE MECHANISM, NOT ANOTHER RULE

**1. QA holds the stall watch.** Not because QA is senior, but because QA reviews every PR and
therefore sees the merge flow — a stall is visible from that seat and from no other. So, every
time QA finishes an item, before it ends its turn:

- `gh pr list --state open` — is anything merge-ready and sitting?
- `ListAgents` — is a peer idle, or offline with items on its lane?
- If either, **ping that session with specific work before replying.** Not "are you busy" — the
  next item, named, with its dependency stated.

**2. A handoff names the receiver AND what happens if they are absent.** "Over to you" is not a
handoff when the receiver is offline. It becomes: *"X is yours; if you are not back by the time Y
lands, it falls to Z"* — or, when there is no Z because the item is owner-gated, say so in the
same breath.

**3. A QUEUE WHOSE NEXT STEP IS OWNER-GATED IS A STALLED PROJECT, AND MUST BE REPORTED AS ONE.**
This is the part that was missing. On 2026-11-07 the owner had already approved the release and
the migration; the remaining blockers were a permission layer and an offline session. Every
session correctly reported "not mine" and then stopped, and "everyone is behaving correctly" added
up to a dead project. **If the critical path's next step belongs to the owner, say that plainly
and say what it is blocking — not only that the item is not yours.**

**4. Do not confuse activity with progress when reporting.** Seven PRs merged that night and the
live site did not change once. A status that leads with the merges is true and useless. **Lead
with what the user can see; name what is parked and on whom.**

**What this does not fix, stated so nobody assumes it is solved:** nothing here detects a stall
while *every* session is idle, including QA. That needs a scheduled check, which costs money and
is the owner's call — it is in `OWNER-BACKLOG.md` as a question, not queued as work.

---

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

**Rewritten 2026-11-05 by PM/DevOps; every issue named here was checked open or folded that day.** The previous table (2026-10-21) named a shipped release, a locked
Actions account and Phase 0 of a feature that has since shipped as Draw Structure. Order is the order of work.

| # | Item | Notes |
|---|---|---|
| D1 | **#1959 and #1956 - merge on QA's word** | #1959 deletes `/api/exchange-reach`; its results are on #1649 (2026-11-04: OKX, Hyperliquid, Kraken, Bitget reachable from the server region, controls passed). #1956 makes Draw Structure refuse and refund on an unreadable or undrawable reply. |
| D2 | **#1961 - pages under `app/(main)/` hid their copy from clients without JavaScript** (#1740, high) | Cause: `app/(main)/loading.tsx`. Measured at about 42-50 rendered words on all five pages checked (`/`, `/upgrade`, `/learn`, `/about`, `/faq`). Do not re-investigate. Open, waiting on QA's review. After merge, PM deploys `liquidity-hq-dev` and Dev takes the after-measurement from that URL. Losing the transition skeleton needs the owner's sign-off before `staging` -> `main`. |
| D3 | **OKX step 3 — DECIDED AGAINST, and the measurement is the deliverable** (#1651) | **Build nothing as a fallback for the five Binance-only metrics.** Measured 2026-11-05 across 5 coins and 30 aligned 5-minute buckets each: none is substitutable as a VALUE. Whole-market long/short flips `calcSqueezeScore`'s 0.52/0.58/0.65 buckets in **93 of 150** buckets (`sand`: Binance net short 0.473, OKX net long 0.651, same five minutes). Funding disagrees on **sign** (`eth` −0.0000265 against +0.0000737). Taker ratio 24-67% median apart. Top-trader pair correlates 0.86-0.89 with a **28-51% level gap**, because "top trader" is an exchange-specific definition. So #1649's existing rule holds for all five: *those panels show "unavailable" when Binance is down, never a stale or default value.* **Audited the existing paths too — no live cross-venue substitution anywhere** (funding is side-by-side and labelled; `lsr-global`/`lsr-top` are Binance-only by #1238; `oi-hist`'s fallback is safe because `useOI1h` routes each coin to one source; the telegram L/S Bybit branch covers only `pepe`/`bonk`/`xau`, none on Binance). **Parked as an option, not queued:** OKX's 5-minute OI as a second **labelled** series — OI is per-venue and `oiTrend1h` computes a change between samples, so it is a reading of OKX rather than a stand-in. New visible source, so an owner visual, and no demand behind it. |
| D4 | **Hyperliquid client — price and klines ONLY** (#1651) | **Not funding.** Funding is a per-venue price, not a shared measurement (see D3), so no Hyperliquid stand-in; a cross-venue funding comparison panel is a new feature and the owner's call. Price IS the shared quantity — measured 2026-11-05 at **0.9991-0.9997** against Binance across btc/eth/sol/link/sand, holding on the low-cap as well as the majors. Three findings the build must encode, all on #1651: **(1)** the 1000x trap is present as a `k` prefix (`kPEPE`, `kSHIB`, `kBONK`, `kLUNC`, `kFLOKI`, `kDOGS`, `kNEIRO`) and `normaliseBase` matches digits only, so it is **blind** to it — six of the seven measure 1000x and **`kDOGS` measures 4390x**, so `k` is a hypothesis to verify per name, never a rule to apply, and a name that fails verification is refused at any multiplier; **(2)** candles are **oldest-first**, the opposite of OKX and Bybit, with no `confirm` flag — the forming bar is `T > now` and nothing else; **(3)** errors are the weakest of the four venues — HTTP 500 with body literally `null`, or 422 with plain text that makes `JSON.parse` throw — so the guard needs three parts, not `r.ok`. Intervals are a fourth dialect: `1m 3m 5m 15m 30m 1h 2h 4h 8h 12h 1d 3d 1w 1M`, and `60`/`4H`/`1D` are rejected. No paging needed: 5001 contiguous 5-minute bars in one request. `/api/health` already reports `attempted` (#1927), so a never-called venue no longer reads as healthy. |
| D5 | **~~#1861 `fet` gap~~ - MEASURED, NOT A GAP. Replaced by the snapshot work-list item below.** #1861 still merges on the owner's copy approval. | **`fet` is reachable and this row was wrong.** Measured on prod 2026-11-06: `/api/market/snapshot` carries `fet` with price 0.1495, change, high, low, vol24 and klines. It is true that `fet` has no Bybit symbol - it is the only one of 463 universe rows without one - but nothing on its path is Bybit-sourced: every `BYBIT_SYMS` lookup it touches is a *fallback*, so the absence means "no second source", which is the documented #1233 decision. The arena guard is `if (!binanceSym && !bybitSym)` and `fet` passes on the Binance half. **Do not re-investigate `fet`.** |
| D5b | **Three tracked coins are absent from the server market snapshot** (new, from D5's measurement) | `pepe`, `bonk` and `xau` have no entry in `ticker` or `klines` - 46 of the 50 tracked coins are present (`hype` is the fourth and is excluded deliberately, by name). Mechanism: `missingCoins` derives from `SYMS` which derives from `BINANCE_SYMS`; `BINANCE_HOLD` keeps `pepe`/`bonk` out and `xau` has no Binance symbol, so none reaches the work list and the Bybit single-shot that could serve all three is never asked. All three have Bybit symbols. **Not a release blocker** - `arenaServerNumbers` returns `ok: true` with empty fields for an uncovered coin, generically rather than by name, so an AI read degrades to the browser's numbers instead of refusing. PM confirmed normal priority. Fix: add the three via their Bybit symbols with the per-token factor, plus a control asserting `pepe`'s snapshot price matches the ticker within 1%. Own PR - it changes what every AI route sees. |
| D6 | **Pre-existing E2E reds that are app code** | Only as QA assigns them. `entitlement-unknown:40` (#1630), `arena-venue-fallback:81` (#1263). The Confluence cluster is QA's first (Q3). |
| D7 | **One-line exports for QA's #1413 per-pin table** | Paired workflow: QA names the pin and the value, Dev exports the symbol, QA converts. |
| D8 | **Widen the `20261031c` location sweep** (low) | Misses bare "Manila" and the server region (Seoul / Singapore / `ap-northeast`). Both label tables measured clean 2026-11-04, so this guards a future replay only. New file, same value-not-key design. |
| D9 | **Hyperliquid liquidation levels** (#1662, folded into #1651; medium) | Estimate only, after D4. |
| D10 | **#1631's remainder** | Item 4 size/caps/cost and item 5's second half. Read the issue's latest comment, not its body. |

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
| Q1 | **STALL WATCH — before ending any turn** | Added 2026-11-07 after the six-hour stall. `gh pr list --state open` for merge-ready work sitting still, `ListAgents` for an idle or offline peer with items on its lane. Ping with a NAMED next item, not "are you busy". See the amendment under **The rule**. |
| Q2 | **Release PR #1995** (staging `31ff76a1`) | **SIGNED OFF 2026-11-07** on run 42098346588: desktop 45 failed / 1 flaky / 92 skipped / 502 passed = 640, so it reached the end. Zero cells not in the 48-cell baseline from 42057776390. One new mobile cell (`arena-seed-effect-real-selection:71`), environmental — its sibling `strategy-panel-preload-race` flipped the other way in the same run. `/arena` CLS recovered from a failing 0.146 to passing under 0.1. **Mobile's green is `continue-on-error` and is not evidence.** Owner approved go-live; PM/DevOps executes. |
| Q3 | **#2013 — ROUTES +5 pages, PARKED not forgotten** | Adds `/accessibility` `/changelog` `/help` `/security` `/status`; 20 specs were sweeping 30 of 35 routes. Needs ONE dispatched e2e run to produce six baselines (`pagesWithoutH1`, `pagesWithCanonical`, `contrast`, `tapTargetsUnder24`, `axeTargetSizeViolations`, `controlsWithoutName`). The dispatch is PM's and CI spend is the owner's call — **do not trigger it unasked.** |
| Q4 | **Review Dev's open PRs** | Standing. Dev's blockers first, then open PRs, then your own specs. |
| Q5 | **Confluence guards** (#1263, #1651) | 11 cells share "the Confluence card did not appear at all". Two guards cannot tell a spec bug from an app one: the `econ-staleness:106` Pro-gate control passes on the couldn't-verify card, and `marketDataUnavailable` probes klines while the card needs the snapshot ticker. QA first; Dev only if the fixed guards still point at app code. |
| Q6 | **Mobile reds and tap targets** (#1413) | 30 triaged, 25 remain after #1958 and #1960. #1814 stays held until the Confluence cluster clears. `a11y:51` went 113 -> 146 on a CI-built app, so measure deployed staging before hunting. |
| Q7 | **Tests Dev's PRs name** | OKX/Hyperliquid cells: newest-first ordering, `confirm: 0` forming bar, the 300-row cap and paging, case-sensitive `bar`, errors on HTTP 200. |
| Q8 | **#1413 per-pin conversions** | 17 structural + 8 CSS files dropped permanently with reasons; 21 files remain, paired with D7. |
| Q9 | **`qa` and `staging` deploys** | Yours. Read `/api/version` after every one. |
| Q10 | **Older items** | `TEST_GAPS.md` sections 1 and 6. |

## PM/DevOps lane

| # | Item | Notes |
|---|---|---|
| P1 | **Owner batch - one message, options + recommendation, when he engages** | Release #1955 approval; visual sign-off on #1939's empty-state string, #1915's 404 chart and the #1950 changelog text; 20 Draw Structure / Arena strings; ko/zh/ar/ru 404 subtitle; **Draw Structure decision** (apply prod migration `20261031a` with the release so it works on day one, hide it, or ship it visible-but-refusing); the dev-DB migration blocked by PM's permission layer; OWNER-RULES section 13 vs section 3 on who applies dev-DB migrations. **Never sent while he sleeps (OWNER-RULES section 15).** |
| P5 | **BLOCKED ON THE OWNER DIRECTLY, 2026-11-07 — not queueable, and the critical path runs through all of it** | (a) **`20261031a` apply.** He APPROVED it; QA's attempt and PM's were both refused by Claude Code's permission layer as a production action. Needs his hand in the Supabase editor or a permission grant. Paste-ready prod-only extract at `../APPLY-ON-PROD-20261031a.sql`, verified additive and same-16-columns-plus-one against the LIVE prod function. **Draw Structure answers 503 on all four environments until it lands.** (b) **The prod deploy** — PM/DevOps is the executor and was offline; his go is recorded on #1995. (c) **Terms billing sections** have NO rows in any locale, so they render in English on `/ko /zh /ar /ru` while the rest of the page is translated — approved translations or a governing-language clause. **QA told him the legal pages were English-only, which is FALSE (58 of 78 legal keys are fully translated), so his "keep English only" answer was to a wrong question and must not be acted on.** (d) **Visual sign-off** on the five `#1810` pages, live and never approved. |
| P2 | **After every production deploy** | `/api/version`, a 5-minute log watch, tag, `/changelog` entry exists, closing sweep, drift check. |
| P3 | **`liquidity-hq-dev` deploys** | PM's, only when a deployed check is genuinely needed (~500 build-hour cap). |
| P4 | **Keep this file and `docs/HANDOVER.md` current** | Same session an instruction or state change lands. |

## Unassigned - take with a reason

| Item | Why it is here |
|---|---|
| **Sign-in shows a machine-generated domain** (#1411, folded into #1173) | Needs a paid Supabase plan. The owner has postponed Supabase Pro; do not re-raise. |
| **#1688 - Dev and QA to cloud sessions** | Blocked on architecture, not money: a cloud session cannot message a local one back. Credit figure corrected on the issue 2026-11-04. |

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
by cron-job.org, and `CRON_SECRET` is already set on production. **The nightly backup route is BUILT - #1851, merged to `dev`.** Owner raised it on 2026-10-30 and was
right to ask why it had not moved.

**It has never written a file, and that gap is the whole item (2026-10-31).** #1851 has only ever run in
`mode=count`. That proves every paging key *exists*; it does not prove any key is *unique*, and a
non-unique paging key truncates an export without erroring. The dev-Supabase export was approved on
2026-10-30 and **could not run** - that database was degraded for 17 hours. So **no export has ever been
produced, and no restore has ever been attempted.**

**The next three steps, in this order, and none of them is "merge it":**

1. **Run `mode=export` once and keep the artifact.** Against production (a read, so ungated) once the
   route is on `main`; against dev the moment that database answers. Record row counts per table from
   the export and **separately** from the database, then compare - an export counting itself is not a
   measurement.
2. ~~**Prove each paging key is unique**, per table.~~ **DONE 2026-10-31 against PRODUCTION, reads only,
   on #1413.** Not by counting rows - **16 of 16 declared `orderBy` tuples are a PRIMARY KEY on exactly
   those columns**, read from the catalog, both composite keys included. The row-count version was run
   first and discarded: **six of the sixteen tables hold zero rows, so six of sixteen "greens" measured
   nothing**, and equal counts describe today’s rows while a primary key governs every future one.
   Three controls fired, two of them by dropping the second column of a composite key - `labels` collapses
   13,367 rows into 2,726 keys, `muted_alerts` 109 into 2. **Dev’s side-effect:** the `orderBy` comment in
   `lib/backupTables.ts` still calls four keys UNVERIFIED and credits `mode=count` with proving them; all
   four carry a primary key, and `mode=count` answers existence, never uniqueness.
3. **Restore it somewhere and read the rows back.** Never into the shared dev/qa/staging tables - that is a
   write to the shared database and needs the owner. Into a throwaway target, or give
   `scripts/restore-backup.mjs` a plan-only mode whose output is diffed against the export. **A plan-only
   pass proves the parser, not the restore, and must be reported as exactly that.**

**Until step 3 passes, every document reads "the mechanism exists and is unproven" and nothing reads
"we have backups".**

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
