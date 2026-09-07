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
| D0 | **#970 — `.gchat-fab`'s dropped `box-shadow`, and terminal's light-theme glows** | ~hours | Census done: **1 of 11 sites composes into a list, not the three I claimed.** Fix `.gchat-fab`'s dark drop **and** scope terminal's light glows away — the "terminal has no shadows" rule was never enforced in light theme and only held because nobody ran it. **Leave `--glow-accent`'s missing light value alone**, that one is with the owner. **Check the hover afterwards:** PM predicts QA's zero-alpha reading is a transition artefact of the dropped base and vanishes with the fix. **If it survives, that prediction is wrong and it needs its own issue** — say which happened. |
| D0b | **#985 gap 3 — a QUICK/DEEP result outlives the selection it was computed from** | ~hours | **Owner requirement, 2026-09-07.** Nothing clears or marks `result` when `strategySelection` changes, so a trader reads a recommendation built from indicators they no longer have selected. Smallest of the three, most likely to be hit, no decision needed. Re-run vs. stale-marker is Dev's call — **stale-marker preferred**, a re-run spends a Grok call the user did not ask for. |
| D0c | **#985 gap 2 — LiquidityAI is seeded once, not kept aligned** | ~hours | `app/arena/page.tsx:1775` builds the opening message only; change the selection mid-conversation and the assistant still reasons from the set it was handed at open. Resend-on-change or carry-per-turn is Dev's call. |
| D0d | **#985 gap 1 — the buy/sell signal follows the user** | ~1 day | **Unblocked by the owner directly, 2026-09-07, with a constraint that is part of the change.** Client-side only: `useEMAStrategy` takes the selection; `app/api/telegram/alert/route.ts` and `checkEMASignal` **do not change**. Alerts keep firing on the standard rule. **Three things ship with it, not after:** rewrite the comment at `app/arena/page.tsx:250` (it promises alerts fire under the same filter as the chart — that guarantee is being deliberately given up), label **both** surfaces, and state in the PR what a user can now see that would previously have been a bug. **Last of the three despite being unblocked** — gaps 3 and 2 are correctness, this is capability. |
| D2 | **Merge QA's open PRs into `dev`** | minutes | Standing. An open QA PR is Dev's queue — review and merge without being asked. |
| D3 | **Promote `dev` → `qa`** when work accumulates | minutes | Ask QA for timing, do not wait for an answer. Nothing merged should sit on `dev` waiting for an unrelated long task. |
| D4 | **34 extensionless *value* imports in `lib/`** | ~half day | This — not a TypeScript loader — is what blocks unit-testing `marketStore`. Node 24 strips `.ts` types natively, so the documented reason was half wrong. **The raw count is 43 across 19 files, but nine are `import type` and are erased before Node resolves anything — the real sweep is 34.** Sizing from 43 over-sizes it; grepping for 43 afterwards looks like nine were missed. Re-measure before starting, this moves with `dev`. ~~**Do not start before #853 lands**~~ **STRUCK 2026-09-07.** That trade made sense while #853 looked imminent. **QA answered #853's own open question — `/arena` looks unremarkable, not broken — so the rebuild is owed rather than urgent and has dropped behind smaller wins.** Waiting to piggyback now means waiting behind something that may not start for weeks, to save a few seconds per file. **Startable.** |
| D5 | **`docs/HANDOVER.md` T6 — tour step-dot animation timing** | ~hours | Claim of `c4e6044`, never verified. Needs a **fresh** signup; the tour only fires for a new account. |

## QA lane

| # | Item | Size | Notes |
|---|---|---|---|
| Q0 | **Confirm #986 by rendering, then `TEST_GAPS.md` §6 (Q4 below)** | ~1 day | #986's mutual-exclusivity claim is **structural, argued from the component branches — nobody has rendered terminal and found the element absent.** That check is minutes and converts an argument into a measurement, which is the issue's own point. Then §6: axe passes and the tree gets read; **no real assistive-technology pass has ever happened.** If one is not practical here, **"cannot be verified in this environment, and here is what would be needed" IS the result** — more useful than another tree inspection labelled as a pass. |
| Q1 | **Verify #985 when Dev's gaps land** | ~hours each | **Gap 1 flips a behaviour from bug to design:** once it ships, a chart showing BUY while a Telegram alert disagrees is **correct**. Today it is a defect worth filing. Hold Dev to the three that ship with it — the comment rewrite at `app/arena/page.tsx:250`, **both** surfaces labelled, and the PR stating what now flips. Without that last sentence there is no way to tell a pass from a failure. |
| Q2 | **`TEST_GAPS.md` §10 — monitoring delivery is unconfirmed** | ~half day | **Reframed as a read, not a write (#918, merged) — still BLOCKED.** Neither QA nor PM/DevOps has Sentry/PostHog dashboard access. Needs the owner to check one number on each (any event ever, prod project/environment) before this can move again. |
| Q3 | **`TEST_GAPS.md` §2 — geometry is checked, appearance is not** | ~1 day | **First pass done, posted on #914.** Structure/geometry measured (rail 352, nav 44, ticker 34, heatmap confirmed struck), all 45 live `at-*` classes matched a CSS rule, colour-as-data confirmed on a real live-fired signal (OI 1h green value+marker) vs. a real non-firing positive value (Funding 8h, correctly neutral). Open: mobile 390, entitled/pro view, non-BTC clusters ladder came back empty on 4/4 tries (inconclusive, not claimed as broken). **Criteria 12-19 are void** - #853 is closed not-planned (owner, 2026-09-07) and they were its acceptance criteria, so the `arenaEvidence` fixture stub they needed is no longer owed. What is left of this item is measured against the CURRENT `/arena`, not against a spec. |
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
