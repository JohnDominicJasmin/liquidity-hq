# Owner blockers — everything waiting on one person

**Why this file exists.** On 2026-09-07 the owner asked a question nobody had asked before:
*"what else or scenario that i accidentally blocking the team without me knowing it?"*

The answer was five things, then nine, and two of them had been sitting undone for a month.
None was a mistake. **Every one was a reasonable instruction that outlived the moment it was
given**, and nothing in this repo was watching for that.

The trigger was concrete. On 2026-08-11 the owner said no Playwright run happens without
their go-signal, every time. Sensible while they were watching the project hour by hour. By
2026-09-07 they were on roughly two hours a day, and the rule meant **QA could not verify its
own work without waking them**. PM/DevOps relayed a request to run one spec; QA refused,
correctly, because a relay does not satisfy an owner gate. The owner cancelled the rule in one
sentence the moment they understood it was costing a day.

**So the failure mode is not bad instructions. It is instructions with no expiry.** This file
is the expiry check.

---

## How to use this

**Owner:** read the two tables. The first costs money or minutes and unblocks work. The second
is settled and needs nothing — it is here so it is not re-raised at you.

**Dev / QA / PM:** if something is blocked on the owner and is not in this file, **add it**,
in the same PR as the discovery. A blocker that lives only in a session's head is a blocker
that stalls for a day when that session ends.

**Anyone:** when a row is cleared, delete it and say so in the commit. Git history is the
record — see `docs/WORK-QUEUE.md`'s "Keeping this file honest" for the same rule and the same
reason.

---

## Live — waiting on the owner

| # | What | Why only the owner | What it costs to leave |
|---|---|---|---|
| 1 | **Production database has ZERO backups** | Supabase Free includes no backups at all — not a short window, none. Upgrading needs a payment method. ~$25/mo. | **DEFERRED BY THE OWNER 2026-09-11, pending funding.** Their words: *"later we can get the $25/mo once funding is okay"* — they are actively raising. **This is a deliberate decision with a named trigger, not an oversight: revisit when funding lands, and BEFORE the first payment is taken either way.** **What it costs meanwhile:** there is no recovery path from a bad migration, a mistaken delete, or a Supabase-side incident. Defensible at approximately zero users; indefensible the day someone pays. **The operational consequence, which is not optional:** while this stands, **no destructive migration touches production** — no `drop`, no `alter ... type`, no data-rewriting backfill. Additive only (`add column if not exists`, new tables, new policies), which is reversible by dropping what was added. A destructive change with no backup behind it is the one combination on this board with no undo. **The same upgrade also clears the leaked-password protection (#1159) and the dev project's performance ceiling (#1025) — one purchase, three problems, worth deciding once.** |

| 3 | **Payments need FOUR steps on production, not one** | LemonSqueezy dashboard + Render. | PM/DevOps reported this as "set the checkout link" and that was **wrong and dangerous**. The four, in order, are in `docs/HANDOVER.md` §11. **The webhook secret is the one that must not be missed:** without it `verifySignature` rejects every delivery, so a customer is charged and granted nothing. Setting only the checkout URL opens the door and silently fails every purchase — strictly worse than leaving it shut. |
| 6 | **Sign-off on the new "Couldn't verify plan" UI** | Visual — condition 5. | **Parked by the owner 2026-09-11.** They settled the *behaviour* on #1119 (treat unknown as its own state, neither fail-open nor fail-closed) but **have not seen it rendered.** Comparison page posted on #1119 against both themes, with the existing locked-feature card alongside. **#1119 cannot close without this.** The copy defect this row used to flag — a heading asserting *"Backtest is Pro-only"* above a body saying we could not confirm the plan — **is fixed on `dev` and `qa` (#1195):** the heading is now the page's own name and the body is the owner-approved Option C. **On production since v2026.09.12.** Checked 2026-09-12: #1195's merge is an ancestor of `main`, and production's `/api/version` reports `main`'s head (`9fb4599`). **The sign-off is still open.** Shipping it doesn't mean the owner has seen it. |
| 7 | **#1202's `field_updated_at` column on production** | Shared-database write. | **APPROVED by the owner 2026-09-12 (option A, in chat). Timing is the only open part, not the decision.** Applied to the dev database the same day and read back: 4 rows, all `{}`. **On production it goes in just before the deploy of the release that carries #1202's code, never after.** A settings payload that carries the field against a table without the column fails *every* save, not just the new check. **The owner asked to be told before it is applied, so tell them, then apply, then read it back.** It is additive (`add column if not exists … jsonb not null default '{}'`, metadata-only), so it fits the no-backups rule. **Update, 2026-09-12:** release #2 (#1252) is the release that carries #1202's code. The told-first notice was given in chat the same day, in the release #2 decision list. **Apply it only after the owner approves that deploy, in the same quiet window as row 10.** |
| 9 | **#1152: what the pricing lists say about the FREE plan** | User-visible pricing, and visual, so condition 5 applies. | **Dev's proposal is on #1152: one shared feature list feeding both the landing page and `/upgrade`**, with the numbers taken from the real limits, so the two surfaces can't drift apart again. **Three wording picks, each the owner's:** (1) the scanner line: "All 50 coins" or "every tracked coin"; (2) whether the landing page shows Free's timeframe limit (charts on 30 min and higher), which is honest but a limitation shown on the page meant to convert; (3) whether `/upgrade` lists what Free excludes (Telegram and price alerts). **Should be settled before payments open**, because two different descriptions of what's free is a support problem on day one. |
| 10 | **#1157's five foreign-key indexes on production** | Shared-database write. | **Asked 2026-09-12, alongside release #2 (#1252), which carries the file** (`20260912b_fk_covering_indexes.sql`). It's five `create index if not exists`, additive, so it fits the no-backups rule. The tables held 0–4 rows on production when last counted, so the write lock is effectively instant. **Re-count before applying**, because that figure has a date. **What leaving it costs:** nothing today. Foreign-key lookups and cascades scan whole tables, and that cost grows with usage. **Apply it in the same quiet window as row 7, then watch the logs for 5 minutes.** A manual DDL on production under traffic has never been measured (#1025). |
| 11 | **Visual sign-offs waiting (condition 5)** | Visual. | **Screenshots sent 2026-09-12** for **#1244** (the chart's data-source label), **#1220** (page titles on mobile) and **#1225** (the signup loading state). **#1222's set was sent 2026-09-12 ~18:25Z**, after QA verified it: the nav at 768–944px, signed out and signed in with the FREE, TRIAL and PRO badges. In that band theme and language move to `/settings`, and the trial badge drops its day count, which `TrialBanner` still shows. **None of these issues can close without the owner's sign-off.** **Sequencing hazard:** #1222 and #1244 are already merged to `dev` and will be in release #3, so **get their sign-off before release #3 ships**, or they reach production unapproved. #1220 and #1225 stay unmerged until they're signed off. |
| 12 | **Signed-in check of release #1 on production: A or B** | Needs a production account. | **Asked 2026-09-12.** Option A: QA creates a disposable production account, runs the signed-in checks, then deletes it fully. Option B: the owner runs the checks on their own account. **Until it's answered, release #1's signed-in paths are verified on `staging` only, not on production.** |

## Settled — do not re-raise

| What | Status |
|---|---|
| **Sentry / PostHog dashboard access** | **CLEARED 2026-09-07.** Blocked for weeks; the owner granted access and it was answered the same hour. **Both work.** PostHog holds real data - 10 users the week of 30 Aug, 0% returning, roughly none this week, which is an honest measurement of the live site rather than a broken tracker. Error tracking is **GlitchTip**, not sentry.io: `@sentry/nextjs` is the library, `app.glitchtip.com/liquidityhq/issues` is the service. 24 unresolved issues, 9 on production, and it produced a real user-facing defect (#1042) within the hour. |
| **`liquidity-hq-dev` deployer** | **CLEARED 2026-09-07** - assigned to PM/DevOps by the owner (#1041). It had been an orphan since 2026-09-03: the instruction that dev deploys no environment was aimed at production and this service was collateral. Assignment is not a licence to use it; the ~500 build-hour cap is real and local verification stays the default. |
| **`CRON_SECRET` on `liquidity-hq-qa`** | **CLEARED 2026-09-07 by the owner.** Verified independently rather than taken on trust: `/api/version` on liquidity-hq-qa.onrender.com reports `cronSecret: false`, so `checkCronAuth` now fails closed on all nine routes. Decided 2026-08-05, undone for a month, cleared the day it was surfaced — which is the argument for this file existing. |
| **Coinglass v4 / liquidation heatmap data** | Deferred until revenue, **marked do-not-re-raise** (`pendings/PENDING.md:394`). The consequence is that a slot on `/arena` is permanently empty and design works around it. |
| **Annual subscription (#372)** | **Deliberately paused by the owner, 2026-09-07.** Not blocked, not waiting — paused. PM/DevOps had presented a rationale for it as if established fact; that was invented and is withdrawn. |
| **Welcome email on signup** | Deferred — needs a real domain, since Brevo from a Gmail sender gets junked under 2024+ bulk-sender rules. |
| **CI off by default** | The owner's cost decision. August cost 4,223 Actions minutes against a 2,000/month allowance. PM/DevOps switches it on for a release and off after — both halves are steps in `.github/workflows/ci.yml`'s own release sequence, and both get forgotten. |
| **Supabase dashboard access** | **CLEARED 2026-09-11 — the blocker was never real, and nobody had checked.** This row claimed the team could not reach the projects, then claimed Query Performance and IO history needed the dashboard UI. **Both are false.** Live queries ran against both projects today, and **`pg_stat_statements` is enabled** — that is the same data the dashboard's Query Performance screen renders, available over SQL. **The row survived because it was inherited and re-stated rather than re-tested** — the exact failure this file exists to prevent. **Correction, 2026-09-12:** this row also said SQL access *"answered #1025's standing question in one query"* — Realtime WAL polling as the dominant database cost, quoted as cumulative totals. **That was wrong and is withdrawn.** Normalised against `stats_reset` it is 185 s/day on production and 58.6 s/day on dev, which is not a load problem. #1025's actual mechanism was found later, by a different path; see that issue. |
| **#1037's migration** | **APPLIED 2026-09-11 16:15Z on the owner's go, by PM/DevOps.** Two nullable `jsonb` columns on `lhq_user_settings`, `add column if not exists`, no drop, no backfill. **Verified by reading the columns back the same minute, not by the tool's `success`.** Applied before the code that needs it, per the migration rule; the Strategy Panel code ships in the next release. |
| **The three permanent gates** | Merging to `main`, production deploys, shared-database writes. Unchanged, not liftable by any session, and not up for renegotiation. |
| **Everything in the repo, gitignored** | 2026-09-06, because the owner switches devices. Blocks nothing. |
| **Account settings must sync across devices (#1020)** | A ruling, not a blocker. Browser-local storage was explicitly rejected. |
| **Playwright go-signal** | **CANCELLED 2026-09-07** — *"QA can run tests cancel that rule pls"*. The `staging` → `main` half of that same 2026-08-11 rule **still stands**; only the test-run half was lifted. |

---

## Structural — nobody's fault, and it limits what "verified" means

Neither of these is an owner decision. Both change how a QA pass should be read.

- **Telegram is untestable outside production.** The bot's webhook points at dev, so `/start`,
  account linking and bot commands cannot be exercised on `qa` or `staging`
  (`docs/INFRASTRUCTURE.md:507`, `pendings/PENDING.md:334`). Any Telegram change ships
  unverified, and the PR should say so in its Risk section rather than imply coverage.
- **News is untestable outside production.** `lhq_dev_news` is fed by a cron that only production
  runs (`docs/HANDOVER.md:840`).
- **`staging` and `dev` share one database.** Supabase Free caps the account at two active
  projects and dev + prod take both. A clean QA run does not prove the data path is clean.

---

## The rule this file is really enforcing

**An instruction to a team is a decision with a shelf life, and nothing here was checking the
date.** Five of the six live rows above were given for good reasons and then quietly became
permanent. The cost was never the instruction — it was that no one re-read it.

So: **when an owner instruction blocks something, it goes in this table on the day it blocks
it**, not the day someone finally asks.
