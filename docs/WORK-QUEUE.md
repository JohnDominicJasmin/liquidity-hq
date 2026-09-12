# Work queue — pull from here, never idle

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

## Dev lane

**Rewritten a third time on 2026-09-12, at ~15:30Z.** The second rewrite's D1 (#1202,
via #1217) and D2 (#1025's retry storm, via #1219) both merged into `dev` and ship in
release #2 (#1252). D3's #1114, #1121 and #1147 are open PRs: #1222, #1220 and #1225.
#1246 and #1249, assigned in chat, are open PRs too: #1253 and #1250. **A queue
that names finished work is worse than an empty one: it costs a session the time to
discover it is wrong.**

| # | Item | Size | Notes |
|---|---|---|---|
| D3 | **#1233–#1238: #1077's remaining server routes, Binance → Bybit** | ~half day each | **CLAIMED Dev 2026-09-12.** agg-trades, funding-rate, rsi, snapshot, the proxy's ticker+depth, and the proxy's futures-derivatives. **Follow #1240's shape:** a whole series from one source, never spliced, with an honest source label. **#1249 is the trap to avoid: a fallback that gets an empty 200 fails loud and names the cause. It never caches that as a success.** Go in number order unless two routes share a helper. |
| D3a | **#1266: Telegram alerts call Binance directly at 13 sites, with no failover** | step 1 ~hours, step 2 ~1 day | **Goes ahead of #1237 and #1238, straight after #1236.** Alerts reach users' phones, and the remaining D3 routes only feed the UI. Each check silently returns on `!res.ok`, so a Binance block stops most alerts while the log still reads `fired=0`. **Step 1:** add a skipped-check count to the `[alert]` log line, so a block is visible the same day. **Step 2:** per-check failover to Bybit, with threshold alerts suppressed on a source switch, the same reasoning as #1228. |
| D4 | **#1199: one retry-with-backoff utility** | ~half day | Two hand-written implementations exist, though #1188 said to reuse #1119's shape rather than write a second one. Extract a shared one, and **don't change either caller's timing** while doing it. The PR says what to assert; QA writes the tests. |
| D5 | **#1200: direction/evidence glyphs and an unlabeled delete button** | ~hours | #939's shape: meaning carried by a glyph alone, and a control with no accessible name. **Visual, so the owner sees it before it ships.** |
| D6 | **#1113 tour rework · #1185 visual-rule instances** | mixed | Both visual. **Screenshots go to the owner before merge.** #1220 and #1225 are waiting on exactly that right now. |

**Standing, not numbered:** review and merge QA's open PRs into `dev` without being
asked; promote `dev` → `qa` when work accumulates, asking QA for timing but not
waiting for an answer; apply the visual rule — **bordered outlines only for things
that respond to a click; one corner radius for containers, one for controls** — to
anything you touch.

**Machine rules, added 2026-09-12 after two memory kills and a 30-minute dev outage:**
- **One local `next build` at a time, across all folders.** Check for another `next` process before starting.
- **Stop local servers you aren't using.** Each one is ~0.5–1 GB, and it joins the retry storm whenever the dev database degrades.
- **No DDL on the dev database while QA has a pass running.** Any DDL fires a PostgREST schema reload, and on 2026-09-12 one additive column caused 30+ minutes of degradation. See #1025.

## QA lane

| # | Item | Size | Notes |
|---|---|---|---|
| Q1 | **Release #2 (#1252): the browser suite, then production** | hours | **#1252's E2E came back RED on 2026-09-12 (15 failed). The triage is done and audited, and none of the 15 comes from the release** (the table is on #1252). **The release now waits on the owner's go.** There's no E2E re-run: it can't come back green while #1259's pre-existing failures stand, and CI stays off. After the deploy, re-check #1252's steps 1–4 on liquidity-hq.com. Then **close release #2's issues once production is verified, not when they merge:** #1202, #1192, #1177, #1167, #1107 and #1059. #1077 stays open for #1233–#1238. **Release #1's signed-in production check waits on the owner's A or B** (`docs/OWNER-BLOCKERS.md` row 12). |
| Q2 | **Review dev's open PRs** | hours | #1245 once Dev's focus-return fix lands, then #1254 (docs). #1250, #1253, #1222 and #1257 are merged. **#1220 and #1225 stay unmerged until the owner signs off their screenshots** (`docs/OWNER-BLOCKERS.md` row 11). **Release #3's candidate is building on `qa` (#1261). Don't promote `qa` → `staging` until #1252 has shipped.** |
| Q3 | **Tests for what merges** | per PR | QA owns every test (owner ruling, 2026-09-07). #1250's are done (#1256). **#1253's are still owed**, and its PR says what to assert. |
| Q4 | **#950: `layout.spec.ts` against a live run** | read-only | **Answered by #1252's run on 2026-09-12:** `layout.spec.ts` **passed** at `:430`, `:478` and `:626`, on both desktop and mobile. Post that on #950 with the run id (`34701414071`), then close it or say what's left. |
| Q5 | **Open issues whose fix may already be on production** | ~1 hour | #1168, #1191, #1020, #1075 and #1173. For each one, check production or the issue's own thread, then **close it, or say on the issue exactly what's left.** #1119 also needs the owner's sign-off (`docs/OWNER-BLOCKERS.md` row 6). |
| Q5a | **#1259: make a red E2E run mean something again** | ~1 day | Six specs fail on production's own code, and three more depend on CI or account state. **For each one, fix it or quarantine it with a reason and an issue link.** For the ratchets, find what raised the count before re-baselining. Until this lands, every release needs a manual triage like #1252's. |
| Q5b | **#1260: does the price ticker return to its WebSocket after ~30 s of failed retries?** | ~1 hour | Check the CI trace first (run `34701414071`), then reproduce on `main` with an outage longer than 30 s. **If it never reopens, it's a product defect on production (#306), and it goes to Dev.** |
| Q6 | **#1171: the ~2.5 s nobody can account for** | ~half day | **Two causes have been disproved: the triple `/api/grok` call (re-measured, no improvement) and the entitlements read (measured on the wrong environment, by PM/DevOps's instruction).** What survives: network is quiet by ~4.5 s, content settles ~7 s. **The gap is AFTER network activity ends**: client-side render cost, or a WebSocket feed Resource Timing cannot see. **Measurement noise on these dynos exceeds the effect**, so either take many samples or say the environment cannot settle it. |
| Q7 | **`TEST_GAPS.md` §6: accessibility asserted, never heard** | ~1 day | No real assistive-technology pass has ever happened. **"Cannot be verified here, and here is what would be needed" is an acceptable result.** |
| Q8 | **`TEST_GAPS.md` §1: server time is not controllable** | ~half day | Anything time-dependent is untestable at boundaries. |

## Unassigned — take with a reason

| Item | Why it is here |
|---|---|
| **#1025: why the dev Supabase project hangs** | **The trigger is known. Why dev can't absorb it is still a candidate.** Any DDL fires PostgREST schema reloads, including Realtime's hourly partition DDL and, on 2026-09-12, **one additive column at 09:16:24Z, which caused 30+ minutes of degradation**: `PGRST002` loops, `PGRST003` pool exhaustion, and PostgREST backends idle-in-transaction on `ClientRead`. **Postgres itself was idle, and PostgREST was the stalled side.** Two live candidates, not exclusive: **memory headroom** (dev at 99.77% of its commit limit) and **our own servers' retry storm**, which #1219 damps, shipping in release #2. The **dashboard memory graph for 09:16–09:50Z** would confirm or kill the first. Production has never failed on a reload, and a manual DDL there under traffic has not been measured. |
| **#1152 — the FREE plan described differently in two places** | **Root cause identified:** two independent sources. The landing page reads `dict.pricing.*` in `lib/i18n/dictionaries.ts`; the upgrade screen reads `UPGRADE_*` label keys. Nothing links them. **Editing both to match leaves the mechanism and they drift again.** The fix is one source — and it touches user-visible pricing, so the owner approves before anyone builds. |
| **#1185 — the visual rule's remaining instances** | Corner consistency and the scroll affordance. The rule is adopted; these are what it applies to. **Owner approves anything visual.** |
| **#1157: five unindexed foreign keys** | **The migration file is in release #2** (from #1221). **Applying it to production waits on the owner** (`docs/OWNER-BLOCKERS.md` row 10). **Whether it's on the dev database hasn't been checked.** Anyone applying it there asks QA for a quiet window first (machine rule 3). |
| **`TEST_GAPS.md` §11 / §7** | CI being off is the owner's cost decision; the shared dev/staging database is a Supabase free-tier structural limit. Neither is actionable without a purchase. |

---

## Owner-only — do not queue these

**#861 and #243** (payments — four steps on production, and a real purchase to prove
Pro is granted). **#372** (annual subscription — *paused* by the owner, not blocked).
**#1159** (leaked-password protection — deferred with the Supabase upgrade).
**#1116** (redistribution rights for proxied exchange data — a legal question).
**#1117** (whether to tell customers the AI is included).

**Backups remain deferred to funding** (`docs/OWNER-BLOCKERS.md` row 1), with the rule
that follows: **while there is no backup, no destructive migration touches production.**
Additive only — `add column if not exists`, new tables, new policies.

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
