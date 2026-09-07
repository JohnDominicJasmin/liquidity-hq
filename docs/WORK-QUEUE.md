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

**Scope still locked by the owner (2026-09-07).** Nothing gets added, and a problem
found inside a current item does **not** become a new issue — it goes on the parent
and QA audits it there.

**One sanctioned exception so far:** #1042, filed from GlitchTip with the owner's
explicit "go do it". It was live on production and user-facing. Findings that are
neither do not earn an issue — see D2.

| # | Item | Size | Notes |
|---|---|---|---|
| D0 | **REGRESSION — the rebuilt Arena's chart paints over every panel below it** | ~hours | **Found by the OWNER, not by us, hours after #853 shipped to `qa`/`staging`.** The chart's canvas renders taller than its slot and the overflow paints across Confluence, the strategy rows, market structure and the indicators. **Reproduces at every width swept — 768, 850, 900, 1000, 1058, 1100, 1150, 1200, 1300 and 1440** — including the spec's own canonical desktop width. **Root cause:** `.klc-canvas` carries a flat, unscoped `height: 800px` from its life as a self-sizing dashboard card, and `.klc-wrap` has no height of its own, so `.at-chart { height: 430px }` never reaches it — a child's explicit height is not constrained by an ancestor's box. The 614px the canvas actually rendered at is neither the 800 default nor the 430 target: it is a mid-layout read klinecharts' own resize logic landed on. **A real number that means nothing**, and PM/DevOps built a hypothesis on it before Dev measured. **Fix:** chain height through `.klc-wrap` and make `.klc-canvas` `flex: 1`, scoped to `[data-design="terminal"] .at-chart` so the dashboard's own chart keeps its self-sizing behaviour. `.at-chart`'s 430 is unchanged — the fix makes that number finally take effect. **`overflow: hidden` was explicitly forbidden**: it hides the overlap and leaves the chart drawing 184px nobody can see. **Verification is by screenshot at 768, 1058 and 1440, before and after** — criteria 24-27 all passed on this page, and none of them can see two elements occupying the same pixels. **Production is unaffected and that is checked, not assumed:** `7881bbc6` is not an ancestor of `main`. |
| D1 | **#1042 — `Notification.requestPermission` is not a function** | ~hours | PR **#1044**, with QA. An anti-fingerprinting extension replaces `Notification` with a stub lacking `requestPermission`, and the call is unguarded, so push permission dies silently — no error surfaced, the prompt never appears. **Dev found it is three call sites, not one, and byte-identical on `9f9c88f` and today's `main`** — so it is live on v2026.09.07 and was not fixed by the release. The fix is feature-detecting the **method**, not the object: `'Notification' in window` is true in this case. |
| ~~D2~~ | ~~**Two `ReferenceError` crashes GlitchTip has been recording**~~ **DONE 2026-09-08 — both were already fixed, and the negative result is the useful part.** | done | **`isGodTier is not defined`:** `lib/marketRead.ts` re-implemented session windows against the viewer's local clock with no import of `lib/session.ts` at all. Fixed in `f75492cd` (2026-07-28) — the import was added and the local re-implementation deleted. That commit is an ancestor of `dev`, `qa`, `staging` and `main` today. **Blast radius, which is why it was worth asking:** `isGodTier` appears nowhere but its definition in `lib/session.ts` and that one correctly-imported call site. No production path is near it. **`LanguageNavSwitcher is not defined`:** `git log -S` over every commit that ever touched a usage site (`AppShell.tsx`, `NavDrawer.tsx`, `TerminalNav.tsx`) shows every one added the import and the JSX in the **same** commit, never one without the other, and all four branches carry matching import+usage at all three sites today. Dev's read: a transient bad state during active terminal-nav work that self-corrected before the next commit landed — not a defect in any commit's own history. **Neither is reachable on the current build, in either environment. No PR, because there is no diff.** Kept as a struck row rather than deleted so nobody re-derives it from the same GlitchTip entries — the errors are real, they are just a month-old record of something already repaired. |
| D3 | **#1020 — strategy selection and edited params vanish on reload** | ~1 day | **PARKED on the owner, not on you.** PR **#1037** carries the migration and its write code together with a DO NOT MERGE banner, because shipping the write ahead of the schema reintroduces #1020's own bug — a silent failure, since `flushToDb`'s error surfaces on `/settings` and never on `/arena`. QA caught that bundled into #1039; Dev traced it to a branch cut from the wrong base and rebased it out. Both halves land in one step when the owner applies the migration. |

**Standing, not numbered:** review and merge QA's open PRs into `dev` without being
asked; promote `dev` → `qa` when work accumulates, asking QA for timing but not
waiting for an answer.

**Cleared 2026-09-07:** #994 (light-theme glow), #1021 (signup captcha), #853 (the
Arena rebuild — reopened at 11am after PM/DevOps closed it in error, shipped and
verified on the deployed build by 3pm), #1007, #1027, #1024. The RLS rewrite for
#1025 is merged and awaiting application by PM/DevOps.

## QA lane

Same locked scope. No new issues; findings go on the parent.

| # | Item | Size | Notes |
|---|---|---|---|
| Q1 | **#949 + #1025 — the sign-in churn fix** | **PR #1046, ready** | `qa/e2e/_auth.ts` now caches sessions per email instead of minting a fresh password grant per call. **Measured:** `a11y-auth.spec.ts`'s 5 `signedInContext()` calls collapse to **1 real mint**, all 6 tests still pass, and `bola.spec.ts`'s 10 cross-account tests still pass — so no cache cross-contamination between accounts. Build not re-run and QA said so rather than skip it silently; this touches `qa/e2e/` only, outside the Next.js app. **PM/DevOps held this merge to take a Disk IO baseline and then released it, because the baseline was weak evidence.** Idle IOPS of 3 says nothing about a cost only paid during a suite run, and the burst-credit budget is a different figure from instantaneous IOPS. **QA's 5:1 mint count is the real measurement** — counted, not inferred, and it does not depend on a flaky dashboard chart. **Sequencing constraint that survives:** the RLS rewrite targets the same budget and must not be applied in the same window, or neither change is attributable. |
| Q2 | ~~**#925 — the decisive measurement**~~ **ROOT-CAUSED 2026-09-08 by QA. Now Dev's, queued behind D0.** | done (QA half) | **`<LiqFeed>` never mounts under terminal design mode at all**, and terminal is the default everywhere. `app/arena/page.tsx:1449` branches on `designMode === 'terminal'` and early-returns at `:1533`; `<LiqFeed onClusters={handleLiqClusters} .../>` sits at `:2463`, inside the classic-mode JSX beginning at `:1535` — unreachable. **Measured, not argued:** `page.addInitScript()` wrapping `WebSocket` and `fetch` before any page script runs, 35s on deployed staging. Zero WS connections matching LiqFeed's URLs while **four other WS connections fired fine**, and zero `liq_events` fetches while **two other Supabase REST calls did fire** — so nothing page-wide is blocking. **Every earlier hypothesis was wrong**, including PM/DevOps's null-client and effect-throws-early theories, and PM/DevOps's own extension-based probe was inconclusive by its own admission. The component is simply not on the page. **Consequence nobody had joined up:** ArenaTerminal's Liquidation Clusters panel reading *"No clusters in range"* is **permanent**, not a cold-start artefact — same root cause, seen during #853 verification and not placed at the time. |
| Q3 | **Review #1044** | minutes | Dev's open PR, ahead of your own specs in the standing blocker order. |
| Q4 | **`TEST_GAPS.md` §10 — monitoring delivery** | ~hours | **UNBLOCKED 2026-09-07.** It was owner-only for weeks; the owner granted access and it is answered: **both work.** PostHog has real data (10 users the week of 30 Aug, 0% returning, ~0 this week — the live site genuinely has no traffic). GlitchTip has **24 unresolved issues, 9 of them production**, and produced a real defect within the hour (#1042). What is left of this item is writing the finding up properly, not chasing access. |
| Q5 | **`TEST_GAPS.md` §6 — accessibility is asserted, never heard** | ~1 day | axe passes and the tree is inspected; no real assistive-technology pass has ever happened. **"Cannot be verified in this environment, and here is what would be needed" IS an acceptable result** — more useful than another tree inspection labelled a pass. |
| Q6 | **#950 — `layout.spec.ts` vs a live run** | blocked | Needs CI, which is off. You established the contradiction was two tests in different consent states, not a real disagreement. The Linux datapoint arrives with the next release PR. Also recorded here rather than as its own issue: the full sweep hangs 12+ minutes against a deployed remote URL at near-zero CPU while the site is fast via curl. |
| Q7 | **`TEST_GAPS.md` §1 — server time is not controllable** | ~half day | Data and clock are pinnable; server time is not, so anything time-dependent is untestable at boundaries. |

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
