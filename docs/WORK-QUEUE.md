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

**Rewritten a second time on 2026-09-12: the morning's D1–D7 all merged into `dev`
the same day.** #1188 via #1198, #1201 and #1215. #1187. #1177 via #1206 and #1216.
#1192 via #1207. #1167. #1107 via #1212 and #1213, which found a live
fabricated-zero CVD alert. **A queue that names finished work is worse than an
empty one: it costs a session the time to discover it is wrong.**

| # | Item | Size | Notes |
|---|---|---|---|
| D1 | **#1202: per-field `field_updated_at`, optimistic concurrency on settings writes** | ~1 day | **CLAIMED Dev 2026-09-12. PR #1217 is open and unmerged: it's waiting on a live read/write pass, which waits on the dev database recovering.** The design is on the issue. **Use the corrected accept rule:** `server_ts is null` OR (`client_ts` present AND `client_ts >= server_ts`). A client that never confirmed a read must not win. **Fold in the `flushToDb` race:** on success, delete the marker only if it still equals the value that flush sent. **The column is on the dev database. On production it goes in just before the release carrying this deploys** (`docs/OWNER-BLOCKERS.md` row 7). **Put the prod migration file in the PR, and write "requires prod migration before deploy" in Risk.** |
| D2 | **#1025: our own servers amplify dev outages** | ~half day | During the 2026-09-12 outage, `service_role` clients sent **~280 `POST /rpc/lhq_dev_record_api_health` in ~8 s**, plus hundreds of `lhq_dev_labels` and `lhq_dev_app_config` reads, all 503/504. **`lib/apiHealth.ts`'s `shouldWrite` is meant to coalesce to one write per source per 30 s, so find what defeated it:** many processes, dynamic source keys, or flapping state. **Add backoff on 5xx to the labels and app-config reads.** This helps production too. |
| D3 | **#1114 nav overflow 768–945px · #1121 route slugs as screen names · #1147 signup skeleton · #1113 tour rework** | mixed | Small, real, none urgent. #1121 is ~15 pages showing a lowercase URL slug where a designed label exists. **All visual, so the owner sees each one before it ships.** |

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
| Q1 | **Release #1210: the staging pass, then production verification** | hours | **The owner approved the production deploy on condition of your sign-off**, so your "ready" is the last gate. **Void from 09:16Z on 2026-09-12**: the dev database outage. Re-run from a clean window, check `PGRST00x` for any failure, and record which windows were clean. **After deploy, the release's issues close when production is verified, not when they merge.** |
| Q2 | **Review and verify the next `qa` promotion** | ~half day | #1207 (#1192), #1167, #1212 and #1213 (the #1107 sweep, including HYPE CVD: **does the held reading show as stale?**), **#1214 + #1215 (per-account unconfirmed settings: test with two accounts holding different values in the same field, and assert A's own value comes back after B's session)**, #1216 (#1177 source fix in `AuthProvider`: ban enforcement and Grok usage still work). |
| Q3 | **#1173: isolate what removed the 13 s** | ~1 hour | Run the corrected method on **`30b5c911`** (pre-#1206) on localhost. **~22 s means #1206 was the fix. ~9 s means the 22.7 s came from the setup.** One local build at a time. |
| Q4 | **#1171: the ~2.5 s nobody can account for** | ~half day | **Two causes have been disproved: the triple `/api/grok` call (re-measured, no improvement) and the entitlements read (measured on the wrong environment, by PM/DevOps's instruction).** What survives: network is quiet by ~4.5 s, content settles ~7 s. **The gap is AFTER network activity ends**: client-side render cost, or a WebSocket feed Resource Timing cannot see. **Measurement noise on these dynos exceeds the effect**, so either take many samples or say the environment cannot settle it. |
| Q5 | **`TEST_GAPS.md` §6: accessibility asserted, never heard** | ~1 day | No real assistive-technology pass has ever happened. **"Cannot be verified here, and here is what would be needed" is an acceptable result.** |
| Q6 | **`TEST_GAPS.md` §1: server time is not controllable** | ~half day | Anything time-dependent is untestable at boundaries. |
| Q7 | **#950: `layout.spec.ts` against a live run** | read-only | **CI is switched on for release #1210**, so its E2E run is the one live result available. Read `layout.spec.ts`'s outcome there before CI goes back off. |

## Unassigned — take with a reason

| Item | Why it is here |
|---|---|
| **#1025: why the dev Supabase project hangs** | **The trigger is known. Why dev can't absorb it is still a candidate.** Any DDL fires PostgREST schema reloads, including Realtime's hourly partition DDL and, on 2026-09-12, **one additive column at 09:16:24Z, which caused 30+ minutes of degradation**: `PGRST002` loops, `PGRST003` pool exhaustion, and PostgREST backends idle-in-transaction on `ClientRead`. **Postgres itself was idle, and PostgREST was the stalled side.** Two live candidates, not exclusive: **memory headroom** (dev at 99.77% of its commit limit) and **our own servers' retry storm** (D2). The **dashboard memory graph for 09:16–09:50Z** would confirm or kill the first. Production has never failed on a reload, and a manual DDL there under traffic has not been measured. |
| **#1152 — the FREE plan described differently in two places** | **Root cause identified:** two independent sources. The landing page reads `dict.pricing.*` in `lib/i18n/dictionaries.ts`; the upgrade screen reads `UPGRADE_*` label keys. Nothing links them. **Editing both to match leaves the mechanism and they drift again.** The fix is one source — and it touches user-visible pricing, so the owner approves before anyone builds. |
| **#1185 — the visual rule's remaining instances** | Corner consistency and the scroll affordance. The rule is adopted; these are what it applies to. **Owner approves anything visual.** |
| **#1059 / #1077 — Binance to Bybit** | Client-side failover and server-side egress. Distinct scopes. **#1059 merged into `dev` (PR #1228) and #1077's `klines`/`ribbonCandles` piece merged (PR #1240)** - both code-reviewed and unit-tested by QA, but **the live failover pass is still pending** (blocking the Binance hosts locally, checking source labels and alert suppression). **Gates the next `dev` → `qa` promotion** - don't promote until that pass is done. #1077's remaining routes are filed as their own issues: #1233 (agg-trades), #1234 (funding-rate), #1235 (rsi), #1236 (snapshot), #1237 (proxy ticker+depth), #1238 (proxy futures-derivatives). |
| **#1157 — five unindexed foreign keys** | From the database audit. Mechanical, low risk, and the cost grows with usage. |
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
