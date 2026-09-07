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

**Scope locked by the owner, 2026-09-07:** *"list it down ... make sure to work on
these remaining items. stop checking other items and trying to make more issues.
If if you find more issues within this current items, then get it tested and
audited by the other team member."*

**So: nothing gets added to this lane, and a problem found inside one of these
items does NOT become a new issue.** It goes on the parent issue and QA tests and
audits it there. The open count is not allowed to grow. The rows for #1008 and
#985 are gone because both closed today, not because they were dropped.

| # | Item | Size | Notes |
|---|---|---|---|
| D1 | **#994 — `--glow-accent` has no light-theme value** | ~hours | In flight. **PM ruled it an OVERSIGHT rather than sending it back to the owner (2026-09-07): add the value.** The glow fires in dark and has never fired in light; the absence reads as a bug. QA audits the result. If the ruling is wrong that is PM/DevOps's error, not Dev's. The census stands from before: **1 of 11 sites composes into a list, not the three originally claimed.** Also scope terminal's light glows away — the "terminal has no shadows" rule was never enforced in light theme and only held because nobody ran it. |
| D2 | **#925 — `LiqFeed`'s `liq_events` backfill does not fire** | ~hours | **CONFIRMED REAL by QA on deployed `qa`, 2026-09-07**, after PM pushed back once on a first report that could be read two ways. Not "fires and returns nothing" — **nothing reaches the wire at all**: no request to any supabase.co host for `liq_events` across two captured loads, with the observer proven live on the same loads by catching other real requests including 503s. **Reconcile the environment difference FIRST** — it fires on Dev's local dev and not on a deployed build, so the cause is environmental or build-time and chasing handler logic wastes the day. QA's lead, worth taking: env inlining, `NODE_ENV`-gated code, or StrictMode masking a dev-only firing. **The dedup question is a dead end and must not be re-derived** — the handler dedupes on read with a `ts+coin+price+side+source` key before the panel's threshold is computed, so the 72% row duplication is wasted IO, not a distorted density figure. **Not a release blocker**: it predates all 195 commits in #1030. |
| D3 | **#949 + #1025 — one root cause, two issues** | ~half day | The dev Supabase project is at **91% of its Disk IO budget** and E2E sign-ins time out. The driver is our own test sign-ins: `qa/e2e/_auth.ts`'s `signedInContext()` mints a fresh password-grant session per call, used by QA's specs and Dev's verification scripts alike. **PM ruling: cut the churn, do NOT upgrade the plan — no money is being spent on this.** Session reuse is the fix. **The file is QA's**, so Dev supplies any app-side change only and QA writes the tooling change. Close both when the load drops. |
| D4 | **#1021 — no session can complete a signup** | ~hours | Nothing gated on a new account is testable; `docs/HANDOVER.md` T6 is the visible instance. **The owner already approved the test-mode key on non-production** — no decision is owed. If the fix lands in `qa/` it is QA's to write and Dev supplies the app-side change only. |
| D5 | **#1020 — strategy selection and edited params vanish on reload** | ~1 day | **The owner ruled it must SYNC ACROSS DEVICES**, explicitly rejecting browser-local storage: *"What if the user has multiple devices?"* Account-level store, **additive migration only**. **WRITE the migration, do NOT apply it** — a shared-database write is one of the three things that go to the owner directly. |
| D6 | **#853 — rebuild `ArenaTerminal.tsx`** | ~1 week | **LAST, deliberately, and this supersedes an earlier PM message calling it top priority.** That contradiction was PM/DevOps's and is recorded rather than quietly corrected. Reasoning: everything above closes today, this is a week — six closures plus a started rebuild beats a started rebuild and nothing closed. **REOPENED on the owner's instruction, 2026-09-07**, the same day it was reported closed; the closure was PM/DevOps's error and was voided within the day. `components/ArenaTerminal.tsx` exists on no branch. Restore `arenaEvidence.ts` and `useViewport.ts` from `dd39c9bb^`. **Re-integration, not `git revert`** — `app/arena/page.tsx` has moved a long way. **One tree, not two**: select with `useSyncExternalStore` over `matchMedia('(min-width: 768px)')`; rendering both layouts and hiding one means two `KLineProChart` instances and two candle subscriptions, which already shipped once. QA writes the tests. |

**Standing, not numbered:** review and merge QA's open PRs into `dev` without being
asked; promote `dev` → `qa` when work accumulates, asking QA for timing but not
waiting for an answer.

**Merged today, open only until they reach `qa`:** #1007 (SMA is now a genuine
rolling mean — the new threshold disagrees with the old EMA(12) on 2 of 10 real
coins, and DOGE/4h flips `LONG SETUP` → `TRENDING LONG`) and #1027 (clicking an
already-selected chip reopens its params instead of deselecting it). **Both are
blocked from closing by the release, not by anyone's work** — QA correctly froze
`qa` → `staging` while #1030 is open, so nothing verifies on `qa` until the
release ships.

## QA lane

Same locked scope as the Dev lane above. No new issues; findings go on the parent.

| # | Item | Size | Notes |
|---|---|---|---|
| Q1 | **#950 — `layout.spec.ts` and a live run disagree about `/briefing`'s CTA** | ~hours | **TIME-LIMITED. CI is ON as of 2026-09-07 and gets switched off again after the production deploy**, so the Linux datapoint this needs exists only while that window is open. QA has already established the contradiction was **two different tests in different consent states**, not a real disagreement, and that the button's Y-position is genuinely data-dependent under the file's own Windows/Linux font-metric policy. **Record here rather than as a new issue:** the full `layout.spec.ts` sweep hangs 12+ minutes against a deployed remote URL at near-zero CPU while the site itself is fast via curl; a minimal targeted script runs in 3-5s. |
| Q2 | **Audit Dev's rulings as they land** | ~hours | #994 (PM ruled the missing light value an oversight — say so on the issue if that ruling is wrong), #1021, #949 + #1025, and #1007's coverage. **QA's "not ready" outranks any PM sequencing**, including these. |
| Q3 | **`TEST_GAPS.md` §10 — monitoring delivery is unconfirmed** | ~half day | **BLOCKED, owner-only.** Neither QA nor PM/DevOps has Sentry or PostHog dashboard access. Needs the owner to check one number on each. Raised with the owner on 2026-09-07; the recommendation was to grant the team read access rather than answer it once. |
| Q4 | **`TEST_GAPS.md` §6 — accessibility is asserted, never heard** | ~1 day | axe passes and the tree is inspected; no real assistive-technology pass has ever happened. #883, #899 and #902 all turned on what a screen reader would announce and were all verified by reading the tree. **"Cannot be verified in this environment, and here is what would be needed" IS an acceptable result** — more useful than another tree inspection labelled as a pass. |
| Q5 | **`TEST_GAPS.md` §2 criteria 12-19** | blocked | A **#853 dependency** again after the reopen. `lib/arenaEvidence.ts` and `components/ArenaTerminal.tsx` exist on no branch, so whether evidence arrives as an injectable prop or a hookless read cannot be decided and the stub cannot be scoped. Everything else in §2 is done: geometry measured, all 45 live `at-*` classes matched to a rule, colour-as-data confirmed against a real fired signal versus a real non-firing positive value, mobile 390 unblocked via Playwright's own context viewport, entitled/Pro view cleared. |
| Q6 | **`TEST_GAPS.md` §1 — server time is not controllable** | ~half day | Data and clock are pinnable; server time is not, so anything time-dependent is untestable at boundaries. |

**Closed today and kept off the lane deliberately:** #1024 (verified on deployed
`qa` 582fdfb by source inspection — the live error could not be reproduced because
all 8 coins currently have full history), #990 (**the audit found no result was
ever contaminated**: the committed suite never used `resize_window`, every closed
mobile bug was found by working checks, and nothing needs retracting — Playwright's
context viewport is the method of record), and #925's audit, handed to Dev as D2.

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
