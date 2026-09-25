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

| # | Item | Notes |
|---|---|---|
| D1 | **#1422 - paying REVOKES Pro** -> PR #1424 | **Critical.** `subscription_payment_success` carries an *invoice* (`status: 'paid'`), and the role rule read that as "not active". Fixed by ignoring the event; the two dated owner decisions in `lib/lemonsqueezy.ts` (payment failed ends access, cancelled keeps it to `ends_at`) are untouched. **It also stops the event overwriting `ls_subscription_id` with the invoice's id.** Still unverified on `qa` until the owner re-buys (Q2), and renewal plus recovery-after-decline are assumptions (Q6). |
| D2 | **#1423 - upgrade page** -> PR #1425 | Per-plan redirect state (one shared flag made all three buttons say "Redirecting..."), and "Billed annually" removed from the three-plan trust row. **Visual: the merge does not need the owner, the close does** (condition 5). No automated guard exists and none is planned - the E2E harness signs in by typing passwords, which no seat does. |
| D3 | **#1416 - NUL bytes in `app/arena/page.tsx`** | Two raw NULs made ripgrep treat the file as binary: a directory search returns *nothing and no warning*, so every "nothing calls this" claim about the Arena page was unproven. Two-character fix, approved by QA. Needs a build (app code). |
| D4 | **Promote `dev` -> `qa`** after D1 and D2 | Ask QA "ok to push?" first. **QA deploys `qa`; the branch moving is not the service moving** - the claim is `/api/version`. |
| D5 | **#1403 - record which plan a subscriber bought** | **Held.** The subscription row has no variant or plan column, so an account cannot say which plan it holds. Start after #1422 is verified on `qa`. |
| D6 | **Build identity on `/api/version`** (medium) | The endpoint reports the *commit*, so a rebuild of the same commit with different `NEXT_PUBLIC_*` values is invisible to it - observed twice on 2026-09-24 (`cronSecret`, `lemonsqueezyWebhook` flipped, commit unchanged). One field beside `commit`/`branch`/`appEnv` closes it. |
| D7 | **Small tracker lines** (low) | #1397: on a mixed row `dataAgeMs`/`overdueMs` report the age of refreshing symbols only (the verdict needs that exclusion; the reported age does not). The specifier sweep matches single-quoted `from '...'` only. The build guard's 350 MB line never fires before the harness reaper does - measure the single-worker build's real peak before giving it its own threshold. |
| D8 | **#1396 - cancel a plan** | **Not started, and blocked on the owner:** it needs a Lemon Squeezy API key (customer-portal URLs are pre-signed and expire, so each click fetches one), and a decision on what happens when someone buys a *second* plan - the webhook keeps one row per user and lets any of a user's subscriptions overwrite it, last writer wins. |

**Parked by the owner - do not start, do not reopen without an order:** all UI polish and
accessibility audit work. The four trackers hold the built branches, which are kept:
**#1309** (#1386, #1393, #1390), **#1347** (#1392), **#1185** (#1387, #1407),
**#1111** (#1391, #1408). **The one exception: a screen that crashes or does not show
data is worked at once.**

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
- **What the gates cost, measured as the LOWEST free memory reached (MIN_FREE) - not as memory
  consumed.** Launched at >= 3.0 GB free, a test-only gate bottomed out at **~2.3-2.6 GB free
  during `tsc`**, and a full `eslint .` reached **~1.67 GB free**, just above the reaper line;
  a file-scoped `eslint <file>` (~150 MB) is the lightest step. **Do not read "floor" as
  consumption:** a first version of this note said a push "is a 2.5 GB job", which misread those
  figures. One run (3.15 GB start, 0.49 GB low) shows what happens when something else is also
  running, and its cause was never attributed. **The pre-push hook runs lint, `tsc` and the unit
  tests, so a `git push` is itself a gate run - start it with >= 3.5 GB free.** File-scoped
  lint is enough for a test-only PR whose base tree already lints clean; say in the PR that it
  was narrowed.
- **Foreground commands are not subject to the idle reaper; background shells are.** Run a
  quick push-and-merge in the foreground.
- **A killed `next build` leaves `.next` partial**, so `tsc` afterwards reads a broken
  `.next/types` and reports type errors that are not real. Delete `.next/types` first.
- **The owner's own apps are usually the largest holders** (Brave 2.7-4.8 GB, VS Code 2.3 GB,
  a chat app 0.4-0.9 GB). Attribute a dip with a per-step trace, not a guess.

## QA lane

| # | Item | Notes |
|---|---|---|
| Q1 | **Deploy `qa` after the promotion** | Row 2 of the deploy table. Confirm the served commit from `/api/version`, then **diff the whole `configured` block** against the previous reading: `checkout`, `checkoutAnnual`, `checkoutFortnightly`, `lemonsqueezyWebhook` and `cronSecret` must still read true after the rebuild. |
| Q2 | **#1422 on `qa`** | After the owner's one re-buy: `role` stays `pro`; `ls_status` is a subscription status, not `paid`; `current_period_end` is not null; `ls_subscription_id` differs from the pre-fix value; **`updated_at` equals the `subscription_updated` time and sits before the payment event** (the fix makes that event write nothing); still exactly one row. Assertions are written before the run so they cannot bend to fit it. **The owner re-buys first; old test subscriptions are cancelled only after the read is recorded** (`subscription_cancelled` writes to the row). |
| Q3 | **#1423 on `qa`** | Manual before/after script, needs the owner's signed-in browser session. **Record "incomplete" if there is none - never sign in.** Passing is not "closed": the owner approves anything visual. |
| Q4 | **Tests for what merges** | QA owns every test (owner ruling, 2026-09-07). Unit where the input can be forced; an E2E over whatever the exchange happens to produce passes because the interesting path never ran. |
| Q5 | **Cross-browser harness (#1410)** | Ran clean 30/30 on 2026-09-23 (Chromium, Firefox, Brave; 1440 and 390 wide) against deployed staging. Open the PR into `dev` **stating it is manual-only and not to be wired into CI.** **WebKit is not installed: Safari is unclaimed** - keep that line on the tracker. |
| Q6 | **Two Lemon Squeezy assumptions nobody has seen** | Renewal (does `subscription_updated` carry a fresh `renews_at`?) and **recovery after a declined card** (does `subscription_updated` with status `active` arrive when a retry succeeds?). Both are what the code depends on since #1422. Verify at the first real renewal and first real decline; until then they are assumptions, not findings. |
| Q7 | **Load testing beyond one address** | A single source hits our own per-IP limit long before the service (`cmc`, `econ-calendar`, `cycle` cap at 20/min). Real load needs many source IPs - a paid tool, so the owner's cost decision. **The page ramp yielded no ceiling and none is claimed.** |
| Q8 | **Older items still open** | #1259 (make a red E2E run mean something); `TEST_GAPS.md` §1 (server time not controllable) and §6 (accessibility asserted, never heard). |

## PM/DevOps lane

| # | Item | Notes |
|---|---|---|
| P1 | **The closing sweep, after every production deploy** | Five conditions per issue; a tracker ticks only when verified on production (`git merge-base --is-ancestor <merge> <prod sha>`). |
| P2 | **Drift check by hand while Actions cannot run** | Production served commit vs `main`, plus tags, recorded on #1413 every run. **A gap in that record is an unmeasured window, not a clean one.** |
| P3 | **The release batch** | Wording and database changes the owner must approve. See "Owner-only" below; nothing is applied without his word each time. |
| P4 | **Owner's batch** | One list, recommendation first. Drop what the owner has acknowledged and cannot act on. |
| P5 | **The heavy-job slot** | One heavy job at a time on the laptop; PM assigns it. |

## Unassigned - take with a reason

| Item | Why it is here |
|---|---|
| **#1411 - sign-in shows a machine-generated domain** | Needs a paid Supabase plan for a custom auth domain; **deferred by the owner.** |
| **#1113 onboarding, #1342 auth-token races, #1282 database stalls, #1263 saved selections, #1157 database security and capacity** | High-priority trackers **not touched in the 2026-09-19 -> 24 push**, which went to payments and traffic. Read the tracker before assuming its status. |
| **#1152 - the FREE plan described differently in two places** | The landing page reads `dict.pricing.*` and the upgrade screen reads `UPGRADE_*` label keys, with nothing linking them. Editing both leaves the mechanism. One source, and the owner approves anything user-visible. |

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

**Not adopted from that doc, and why:**
- A drift check that needs a local Supabase stack (there isn't one on this machine) and
  generates migrations itself. A generated diff can contain DROPs.
- A circuit breaker that halts every session.
- Scripts that carry Slack or Telegram tokens. Secrets stay in the git-ignored `.env.local`.

Visual sign-off stays with the owner (condition 5).

## Owner-only - do not queue these

**Payments go-live (#861, #243):** test-mode plans exist and the test purchase has run end to
end; what remains is the owner's. **Products created in test mode do not transfer to live
mode** - copy them with "Copy to Live Mode" and set the *new* links on production. Activate
the store (business details, identity), then production's own live-mode webhook and its own
`LEMONSQUEEZY_WEBHOOK_SECRET`. **The API key is created only when #1396 is built.** A
production secret is never copied to a non-prod service.

**Also the owner's:** the recurring 5-minute `POST /api/market/ingest` entry with
`x-cron-secret` (one entry per environment, each with its own secret - never a prod secret on
`qa`/`staging`); the two dashboard checks (PostHog receipt, GlitchTip alert recipient);
wording approval for #1346 and #1292 and the label rows they need; the pricing copy on the
landing page ("$35/mo", "every 2 weeks", "2 months free"); **#1116** (redistribution rights
for proxied exchange data - a legal question); **#1117** (whether to tell customers the AI
is included); **#1159** (leaked-password protection, deferred with the Supabase upgrade);
**#372** (annual subscription - paused by the owner). **#1413:** GitHub Actions cannot start
while the account is locked; nothing else depends on it.

**Backups remain deferred to funding** (`docs/OWNER-BLOCKERS.md` row 1), with the rule that
follows: **while there is no backup, no destructive migration touches production.** Additive
only - `add column if not exists`, new tables, new policies.

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
