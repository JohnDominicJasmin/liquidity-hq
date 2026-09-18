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

## Dev lane

**Rewritten 2026-09-18 after the release shipped.** Everything the previous version
listed is merged and live — it described release #3 as pending for six days after it
shipped, which is exactly the failure this file warns about. `v2026.09.18` is on
production, verified two ways and tagged.

| # | Item | Size | Notes |
|---|---|---|---|
| A1 | **#1347 item 6: entitlement `unknown` enforced as free** | ~hours | **In progress.** A paying user is told they are on the free plan while their account resolves: limit drops to 1, chips block, params go read-only. Reuse the Arena Confluence card's existing three-way pattern (`EntitlementUnknownCard` + `retryEntitlements`) rather than inventing a second shape, and say in the PR that you reused it. |
| A2 | **#1347 item 4: a stale read is labelled in one place and unlabelled in three** | ~hours | The stale-selection banner works. The same stale result is still rendered unmarked by the long-form reasoning blocks, passed to the chart, and embedded in the ASK AI opening prompt — which sends the stale result and the *current* selection in one message. |
| A3 | **#1347 item 5: the prompt states a loading signal as current** | ~small | While a signal loads, the ref feeding QUICK/DEEP holds the previous coin's value and the prompt asserts it as present tense. Freezing on load is right; sending it unlabelled is not. |
| A4 | **#1347 item 11: the remaining third-state gates** | ~hours | `indicators ?? []` (a dropped prop reads as an empty selection), `createIndicator` returning null inside a catch that also swallows real errors, a failed param apply leaving the old line under the new value, `useEMAStrategy`'s `selection = []` default, and the `!user` label gates that #1338 fixed for `disabled` but not for the lock icon and title. |
| A5 | **#1347 item 15: a migration file claims it was never applied** | ~minutes | `20260907a_user_settings_strategy_selection.sql` says "NOT YET APPLIED to either". Both projects have had both columns for weeks — I read the catalogues on 2026-09-18. A reader believing that file concludes the whole persistence path is dead. |
| A6 | **#1347 item 16: four surfaces, four different carrier sentences** | ~small | `describeSelection` correctly owns the name list; every consumer writes its own sentence around it, including one in first person. Low severity, listed because the helper exists to stop exactly this. |
| A7 | **#1346: research evidence list, loading/error vs confirmed-empty** | ~hours | Open PR, built, **blocked on the owner approving two new on-screen strings.** Do not merge before that. |

**Standing, not numbered:** review and merge QA's PRs into `dev` without being asked;
promote `dev` → `qa` when work accumulates; **never promote into `staging` while a
release PR is open**; apply the visual rule to anything you touch.

**Machine rules, and they are live constraints right now:**
- **Ask PM before any build, dev server or browser run.** The owner is working on this
  machine and their browser alone holds around 4 GB of 15.
- **One heavy job at a time, across all folders.** On 2026-09-18 a build ran at 0.4 GB
  free and survived on luck; two at once is what killed builds repeatedly.
- **A Playwright command without `E2E_BASE_URL` silently starts its own build.** That is
  how two builds nearly collided. Set it explicitly.
- **No DDL on the dev database while QA has a pass running.**

## QA lane

| # | Item | Size | Notes |
|---|---|---|---|
| B2 | **#1359: stub both exchanges in the release gate** | open PR | Dev reviews and merges. **The next release run is the "after" measurement** against #1354's real "before" — no dedicated run, no extra cost. The prediction is written in the PR; if the gate still cannot finish, that is a result, not a failure. |
| B3 | **#1361: the sign-in 504/522 flake** | filed, dormant | **No action unless it recurs.** 14 occurrences across one run, spread rather than concentrated; Dev's own runs saw none, which narrows it to concurrent load. Documented with the counts and the control. It makes **every** authenticated spec unreliable, so quote it when a red run is being triaged. |
| B4 | **Coverage for #1360 (the support address)** | per PR | Dev says what to assert; you write it. The copy is DB rows in five locales, so assert by key rather than by rendered English. |
| B5 | **#1263: the coin/timeframe half** | ~hours | Still **unknown**, not failing: two attempts, two different results, one confound found and one not. The strategy-selection half is verified and its spec is committed. |
| B6 | **#1333: mobile drawer focus** | ~small | Open and unconfirmed; 25/25 passed locally, never confirmed on a deployed build. |
| B7 | **`TEST_GAPS.md` §6: accessibility asserted, never heard** | ~1 day | No real assistive-technology pass has ever happened. "Cannot be verified here, and here is what it would take" is an acceptable result. |

**B1 came out and B3 was downgraded on QA's review, within an hour of this file being
written.** Both had moved between drafting and reading — which is the failure this file
exists to prevent, arriving in the fix for it. The production re-check is done (#1347),
its blocker is filed (#1364), and the sign-in flake is documented and dormant.

## Unassigned — take with a reason

| Item | Why it is here |
|---|---|
| **#1347 item 17: the Strategy Panel is English-only across five locales** | The premise that blocked it — that keys added there cannot survive `labels:regen` — is **false**, and the regen script's own header says so. The path is open. Needs the owner's sign-off on the translated copy once written, and it carries the landing hard gate. |
| **#1347 item 14: the alerts copy claims parity the divergence removed** | `ALERTS_EMA_SIGNAL_DESC` promises "the same confirmed buy or sell call your Arena chart draws". True of the markers, silent about the selection-gated verdict. DB rows, five locales, owner signs the wording. |
| **#1292: settings conflict notice** | Built, QA-clean, **needs all four images re-shot** after the toast/floating-button fix, then the owner's approval. |
| **#1025: why the dev Supabase project hangs** | Unchanged: any DDL fires PostgREST schema reloads; two live candidates are memory headroom and our own retry storm. |
| **#1152: the FREE plan described differently in two places** | Two independent sources, nothing linking them. Editing both leaves the mechanism. One source is the fix, and it touches pricing, so the owner approves first. |

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
