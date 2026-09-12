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

**Rewritten 2026-09-12 after a full triage of all 40 open issues.** The previous
lanes were five days stale — they named the Arena rebuild (rejected by the owner,
third time), #1049 and #925 (superseded), and listed #1020 as "parked on the owner"
after the owner applied its migration on 2026-09-11. **A queue that names finished
work is worse than an empty one: it costs a session the time to discover it is wrong.**

| # | Item | Size | Notes |
|---|---|---|---|
| D1 | **#1188 — settings saves fail silently AND are then overwritten** | ~1 day | **The most serious thing on the board.** `flushToDb` sets `saveStatus: 'error'`, but only `app/settings/page.tsx` mounts `SaveToast` — **eight other call sites show the user nothing.** Worse: the sign-in effect overwrites local state from the database on the next load, so **a silently-failed save is clobbered back to the stale value.** A user changes a setting, watches it apply, and loses it tomorrow with nothing ever telling them. **Order: (1) retry with backoff, reusing #1119's exact shape — do not invent a second one; (2) an app-wide visible failure; (3) the reconciliation fix.** **The data-loss path stays open until (3) lands** — do not let (1) and (2) shipping be read as "fixed". |
| D2 | **#1187 — close out #1168's remaining `getSession()` sites** | open PR | In QA's review. `OnChainScore`, `TradeJournal` ×3 including the `checkThesisHealth` silent failure, plus two found by sweeping rather than working the list: `lib/grok.ts`'s `callGrokViaProxy` and `SettingsProvider`'s `flushToDb`. |
| D3 | **#1177 — `AuthProvider` fires `setUser()` 3× with distinct object references** | ~half day | The root cause behind the tripled entitlements fetch, the tripled `/api/grok` call, and the ban channel subscribing three times per load. **Fixed per-consumer so far by keying on `user?.id`; the source still produces three references.** The trap stays armed for the next component anyone writes, and the only thing protecting them is a comment in `ops/layout.tsx`. **Stabilising at source is the real fix — but check first whether anything legitimately needs a new object when fields change.** |
| D4 | **#1173 — auth timeouts stack: 22.7s to report an expired session** | ~half day | **Proven by controlled experiment**, not inferred: `/auth/v1/token` blocked outright, correct "Session expired" message, 22.7 s to deliver it. **The degrade is honest; it is just slow.** Trace `generateBriefing`'s own chain before fixing — **do not assume it is the same three stages documented for `GlobalMacroContext`.** **Do not shorten `ENTITLEMENTS_FETCH_MS`**: 15 s was measured, not guessed, and shortening it reintroduces #1089's false failures. |
| D5 | **#1192 — `/api/cmc` and `/api/macro` fetched twice on every page load** | ~hours | `setTimeout(fetchCMCGlobal, 12_000)` is unconditional. The comment says "retry"; the code never asks whether the first attempt succeeded. **Does not block rendering** — fires ~12 s after `loadEventEnd` at 780 ms. Make it conditional; **do not delete the timers**, cold-start misses are real. Sweep the file for the same shape while there. |
| D6 | **#1167 — mute preferences cannot tell "signed out" from "timed out"** | ~hours | Named and deliberately excluded from #1166. Smaller consequence than #1188 (a default mute state, not lost data), same class. |
| D7 | **#1107 — the `r.ok` sweep** | ~half day | **Treat as one sweep with the silent-failure class, not a separate Binance task.** Four instances found in two days were all the same defect: a non-OK response falling into a generic path. |
| D8 | **#1114 nav overflow 768–945px · #1121 route slugs as screen names · #1147 signup skeleton · #1113 tour rework** | mixed | Small, real, none urgent. #1121 is ~15 pages showing a lowercase URL slug where a designed label exists. |

**Standing, not numbered:** review and merge QA's open PRs into `dev` without being
asked; promote `dev` → `qa` when work accumulates, asking QA for timing but not
waiting for an answer; apply the visual rule — **bordered outlines only for things
that respond to a click; one corner radius for containers, one for controls** — to
anything you touch.

## QA lane

| # | Item | Size | Notes |
|---|---|---|---|
| Q1 | **Review #1187** | hours | Dev's open PR — ahead of your own specs per the standing blocker order. **`flushToDb` deserves the hardest look:** it is a write path, and #1188 came out of tracing it. |
| Q2 | **#1171 — the ~2.5 s nobody can account for** | ~half day | **Two causes have been disproved: the triple `/api/grok` call (re-measured, no improvement) and the entitlements read (measured on the wrong environment, by PM/DevOps's instruction).** What survives: network is quiet by ~4.5 s, content settles ~7 s. **The gap is AFTER network activity ends** — client-side render cost, or a WebSocket feed Resource Timing cannot see. **Measurement noise on these dynos exceeds the effect**; either take many samples or say the environment cannot settle it. |
| Q3 | **Verify the next release on production** | per release | Four fixes sit on `qa` awaiting promotion: #1037 (Strategy Panel), #1181 (entitlement tri-state), #1078 (Arena liq labels), #1195 (backtest de-advertising + Option C copy). **Their issues close when production is verified, not when they merge.** |
| Q4 | **`TEST_GAPS.md` §6 — accessibility asserted, never heard** | ~1 day | No real assistive-technology pass has ever happened. **"Cannot be verified here, and here is what would be needed" is an acceptable result.** |
| Q5 | **`TEST_GAPS.md` §1 — server time is not controllable** | ~half day | Anything time-dependent is untestable at boundaries. |
| Q6 | **#950 — `layout.spec.ts` vs a live run** | blocked | Needs CI, which is off by owner cost decision. |

## Unassigned — take with a reason

| Item | Why it is here |
|---|---|
| **#1025 — why the dev Supabase project hangs** | **Still unknown, and a credible answer was announced then retracted on 2026-09-11.** Realtime is exonerated — 58.6 sec/day, #1194, closed. `pg_stat_statements` says it is not query execution time on either project, so the cost is somewhere those counters do not look. **Access token expiry is 600 s against Supabase's recommended 3600**, so every client hits the failing path six times an hour — a plausible contributor, not a cause. |
| **#1152 — the FREE plan described differently in two places** | **Root cause identified:** two independent sources. The landing page reads `dict.pricing.*` in `lib/i18n/dictionaries.ts`; the upgrade screen reads `UPGRADE_*` label keys. Nothing links them. **Editing both to match leaves the mechanism and they drift again.** The fix is one source — and it touches user-visible pricing, so the owner approves before anyone builds. |
| **#1185 — the visual rule's remaining instances** | Corner consistency and the scroll affordance. The rule is adopted; these are what it applies to. **Owner approves anything visual.** |
| **#1059 / #1077 — Binance to Bybit** | Client-side failover and server-side egress. Distinct scopes, deliberately not merged. |
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
