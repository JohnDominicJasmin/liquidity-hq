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
| D0 | **#1008 — Pro subscribers edit indicator parameters and the edits reach nothing** | ~1 day | **AHEAD of the remaining indicators. PM ruling 2026-09-07: a paid feature that does not work outranks a new one.** `readOnly={!entitled}` gives Pro real inputs; `params` is local `useState` that never leaves `StrategyPanel`; `createIndicator` gets no `calcParams`. **QA confirmed by canvas hash — bit-for-bit identical pixels** on Bollinger 20→5 and RSI 14→2. Input updates in the DOM, so the user gets positive feedback for a change that did not happen. Does **not** persist across reload. Plan is on the issue: `overrideIndicator` (not recreate — recreate fights #966/#981's identity tracking), and **PSAR's ×100 conversion ships in the SAME PR**, in a per-indicator `toCalcParams` adapter. Uncovered by the plan and named there: debouncing, persistence, the free-tier gate. |
| D0b | **#985 gap 1 — PSAR, then MACD** | ~1 day each | SMA (#1006) and Bollinger (#1010) done. **One indicator, one PR, never two.** **PSAR's verification section must say the ×100 conversion is tested or untested — never silent.** It is the one where a wrong number draws a plausible chart: a trail hugging price that never flips reads as a calm market. **MACD's fast line is EMA(12) and SMA's default is EMA(12)** — same calculation, so selecting both is one signal, not two (#1007). |
| D1 | **#853 — rebuild `ArenaTerminal.tsx`** | ~1 week | In flight. Densest screen, 15 modules, restyle not restructure. `arenaEvidence.ts` and `useViewport.ts` need restoring from `dd39c9bb^` — removed by a *different* revert (`c4921954`). `useViewport` exports `LANDING_MOBILE_QUERY`, so the `docs/HANDOVER.md:383` landing gate applies and is verified by **rendering**, not by reading the diff. |
| D2 | **Merge QA's open PRs into `dev`** | minutes | Standing. An open QA PR is Dev's queue — review and merge without being asked. |
| D3 | **Promote `dev` → `qa`** when work accumulates | minutes | Ask QA for timing, do not wait for an answer. Nothing merged should sit on `dev` waiting for an unrelated long task. |
| D4 | **34 extensionless *value* imports in `lib/`** | ~half day | This — not a TypeScript loader — is what blocks unit-testing `marketStore`. Node 24 strips `.ts` types natively, so the documented reason was half wrong. **The raw count is 43 across 19 files, but nine are `import type` and are erased before Node resolves anything — the real sweep is 34.** Sizing from 43 over-sizes it; grepping for 43 afterwards looks like nine were missed. Re-measure before starting, this moves with `dev`. **Do not start before #853 lands**; adding extensions while already in a file is free. |
| D5 | **`docs/HANDOVER.md` T6 — tour step-dot animation timing** | ~hours | Claim of `c4e6044`, never verified. Needs a **fresh** signup; the tour only fires for a new account. |
| D6 | **The Arena liquidation slot — a realized-liquidation panel, or nothing** | ~1 day, **not inside #853** | The predicted-levels heatmap is struck from criterion 3 (PM ruling, 2026-09-06): its data source is permanently empty — Coinglass v2 retired, v4 is 401 on this tier, upgrade deferred to revenue in `pendings/PENDING.md:18`. The current design had already removed the card because it *"drew zero times, for every coin, in every theme."* **`LiqFeed` realized liquidations are a different claim from predicted levels**, so a replacement panel is a new design, not a restore — see the handoff's Honest labels rule. Needs a design decision before code. Unblocks nothing; the slot simply reflows today. |

## QA lane

| # | Item | Size | Notes |
|---|---|---|---|
| Q0 | **Live-verify Bollinger (#1010) BEFORE the next `dev` → `qa` promotion** | ~hours | **Merged on Dev's own review — unit-level only.** Dev rendered the chip and saw the checklist row, but **price never crossed the middle band while a `LONG_SETUP`/`SHORT_SETUP` was active**, so `verdictChangedBySelection` has never been observed firing. **Hunt: a coin and timeframe where price sits near or across a 20-period rolling mean while the ribbon is already in a setup state.** Baseline sweep with Bollinger OFF first — that is what makes a flip attributable. **Watch both ends: "fires too often" is as much a defect as "never fires"**, and Bollinger is genuinely independent of the ribbon so it is less damped than SMA was. |
| Q1 | **`TEST_GAPS.md` blocker census** | ~half day | **Three items found this session naming blockers that had since closed** — RSI's bullet, and squeeze/flush citing #952 (closed, blocking import long gone). **Closing an issue does not touch the file citing it, so a gap stays "blocked" forever by default.** Walk every item naming a blocking issue, `gh issue view <n> --json state`. Three outcomes, all results: blocker closed and gap now actionable; **blocker closed but still blocked for another reason — the most valuable, because the doc is wrong in a way that reads right**; blocker still open, confirmed. **The census is the deliverable, not the fixes.** |
| Q2 | **`TEST_GAPS.md` §10 — monitoring delivery is unconfirmed** | ~half day | **Reframed as a read, not a write (#918, merged) — still BLOCKED.** Neither QA nor PM/DevOps has Sentry/PostHog dashboard access. Needs the owner to check one number on each (any event ever, prod project/environment) before this can move again. |
| Q3 | **`TEST_GAPS.md` §2 — geometry is checked, appearance is not** | ~1 day | **First pass done, posted on #914.** Structure/geometry measured (rail 352, nav 44, ticker 34, heatmap confirmed struck), all 45 live `at-*` classes matched a CSS rule, colour-as-data confirmed on a real live-fired signal (OI 1h green value+marker) vs. a real non-firing positive value (Funding 8h, correctly neutral). Open: mobile 390, entitled/pro view, non-BTC clusters ladder came back empty on 4/4 tries (inconclusive, not claimed as broken). Criteria 12-19 still need a fixture-injection stub for `arenaEvidence` that doesn't exist yet - unchanged by #914, not a regression. |
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
