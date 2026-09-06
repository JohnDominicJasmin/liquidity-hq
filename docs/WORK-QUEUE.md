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

| # | Item | Size | Notes |
|---|---|---|---|
| D1 | **#853 — rebuild `ArenaTerminal.tsx`** | ~1 week | In flight. Densest screen, 15 modules, restyle not restructure. `arenaEvidence.ts` and `useViewport.ts` need restoring from `dd39c9bb^` — removed by a *different* revert (`c4921954`). `useViewport` exports `LANDING_MOBILE_QUERY`, so the `docs/HANDOVER.md:383` landing gate applies and is verified by **rendering**, not by reading the diff. |
| D2 | **Merge QA's open PRs into `dev`** | minutes | Standing. An open QA PR is Dev's queue — review and merge without being asked. |
| D3 | **Promote `dev` → `qa`** when work accumulates | minutes | Ask QA for timing, do not wait for an answer. Nothing merged should sit on `dev` waiting for an unrelated long task. |
| D4 | **42 extensionless relative imports across 18 files in `lib/`** | ~half day | This — not a TypeScript loader — is what blocks unit-testing `marketStore`. Node 24 strips `.ts` types natively, so the documented reason was half wrong. Mechanical and compiler-checked. Sized on #883. **Do not start before #853 lands**; adding extensions opportunistically while already in a file is free. |
| D5 | **`docs/HANDOVER.md` T6 — tour step-dot animation timing** | ~hours | Claim of `c4e6044`, never verified. Needs a **fresh** signup; the tour only fires for a new account. |

## QA lane

| # | Item | Size | Notes |
|---|---|---|---|
| Q1 | **#243 harness — everything up to the LemonSqueezy handoff** | ~1 day | **CLAIMED QA 2026-09-06.** In flight. Entitlement assertion written in advance so it runs the moment #861 unblocks. **Must skip cleanly** while prod reports `checkout: false`, not fail — a red suite on a known hold trains people to ignore it. Watch #786's shape: verify the **page-level** `{entitled && (…)}` gate, not only the route's own auth check. |
| Q2 | **`TEST_GAPS.md` §10 — monitoring delivery is unconfirmed** | ~half day | Prod reports `sentry: true`, `posthog: true`. Nobody has established an error thrown in production **arrives**. Same distinction as `gh workflow list` reporting `active` for a workflow that had not run in 22 days: configured ≠ working. |
| Q3 | **`TEST_GAPS.md` §2 — geometry is checked, appearance is not** | ~1 day | **Timed against #853.** The Arena handoff's acceptance criteria are largely appearance — colour-is-data, marker bars, the verdict band. A suite that checks geometry and not appearance passes a wrong-looking Arena. Worth more before #853 lands than after. |
| Q4 | **`TEST_GAPS.md` §6 — accessibility is asserted, never heard** | ~1 day | axe passes and the tree is inspected; no real AT pass has happened. #883/#899/#902 all turned on what a screen reader would announce, and all were verified by reading the tree. |
| Q5 | **`TEST_GAPS.md` §1 — server time is not controllable** | ~half day | Data and clock are pinnable; server time is not, so anything time-dependent is untestable at boundaries. |

## Unassigned — take with a reason

| Item | Why it is here |
|---|---|
| **`TEST_GAPS.md` §11 — the browser suite has not been running in CI** | Actions are the owner's cost decision. Everything the suite asserts is dated until it runs again. Not actionable without that call, but worth re-reading whenever CI comes back on. |
| **`TEST_GAPS.md` §7 — `staging` and `dev` share one database** | Structural: Supabase free tier caps the account at two active projects and dev + prod take both. Records a real limit on what a clean QA run proves. |
| **`qa/mobile-audit.mjs` / `platform-audit.mjs` comment accuracy** | #910 removed the scraped mirror. Check no comment still claims a guarantee the code no longer makes. |

---

## Owner-only — do not queue these

**#861** (LemonSqueezy merchant verification — external, gates #243 and #372),
**#372** (annual subscription, product decision), **#243**'s final leg (needs a real
purchase, which needs #861).

When #861 lands the sequence is: **set both variables, then trigger a build.**
`NEXT_PUBLIC_*` inlines at build time, so setting them alone changes nothing and
looks like a bug somewhere else.

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
