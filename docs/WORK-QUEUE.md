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
| D1 | **#1042 — `Notification.requestPermission` is not a function** | ~hours | PR **#1044**, with QA. An anti-fingerprinting extension replaces `Notification` with a stub lacking `requestPermission`, and the call is unguarded, so push permission dies silently — no error surfaced, the prompt never appears. **Dev found it is three call sites, not one, and byte-identical on `9f9c88f` and today's `main`** — so it is live on v2026.09.07 and was not fixed by the release. The fix is feature-detecting the **method**, not the object: `'Notification' in window` is true in this case. |
| D2 | **Two `ReferenceError` crashes GlitchTip has been recording** | ~hours | `isGodTier is not defined` and `LanguageNavSwitcher is not defined`. About a month old, one event each, **test environments only — not production.** Never reported because nobody browses `qa` or `staging` casually and nothing was reading the error stream until 2026-09-07. **No issue is being filed** — one PR, GlitchTip cited as the source, environments named. **A `ReferenceError` is a component that died where it stood**, so QA may have been testing around a broken region without knowing. Establish two things the issue-less route would otherwise lose: whether each is still reachable on the current build, and whether the same identifier appears on any production path — `isGodTier` sounds like an entitlement check, and one that throws deserves a known blast radius before it is called test-only. |
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
| Q1 | **#949 + #1025 — the sign-in churn fix** | ~half day | **Highest-value item on the board that needs nobody's permission.** `qa/e2e/_auth.ts`'s `signedInContext()` mints a fresh password grant per call against a database at 91% of its IO budget. Your file, Dev has already traced it, no owner gate touches it. **It also unblocks what you currently cannot do** — until it lands, running the full suite makes the problem it is measuring worse. Session reuse first, full sweep second; that ordering is why the suite has not run clean since 2026-09-05. **Measure before and after**, because the RLS rewrite is landing separately and two fixes with one measurement is how a wrong hypothesis survives. |
| Q2 | **#925 — the decisive measurement** | ~hours | **Yours because your instrument works and PM/DevOps's does not.** A probe of deployed staging returned no Supabase request, matching your two captures — **but it is not reported as confirmation**: `/api/cmc` read `pending` across two reads seconds apart and the console returned zero messages after an armed reload, which is an observer arming late rather than a silent page. **Already established, do not redo:** the code survives the production build (minified chunk read directly — `getSupabase()`, the `if (s)` guard and the select are all present), and the client cannot be null on that build because you signed in on deployed staging for #1027 using the same client. **Three facts cannot all be true.** The untested one: whether the effect **throws before reaching the Supabase block** — `connectBN()`/`connectBB()` run first in the same effect and a synchronous `new WebSocket(...)` throw aborts the rest invisibly. The tell: the 30-second `rebuild` interval is set in that same effect *before* the Supabase call, so if it never fires either, the effect died early and the Supabase call was never the problem. |
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
