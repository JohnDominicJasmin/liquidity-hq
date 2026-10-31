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

**Audited 2026-10-31 by PM/DevOps, and two of the eight rows had cleared themselves.** Row 3
(payments need four steps) named a payment provider this project rejected, and row 14 (the six
settings columns) had been applied for seven weeks while the row still said every signup lost its
answers. Both are in the settled table with what was measured. **That is this file's own failure
mode happening to this file** — a row written correctly, with nothing watching the date — which is
the argument for auditing the board itself on a release sweep rather than only adding to it.

**Row 1 is deliberately here although it is NOT waiting on the owner.** Backups stopped being
owner-blocked on 2026-10-30 and the paid plan is postponed by his decision, so **do not re-raise
it with him.** It stays visible because the operational rule it carries is live and absolute: while
no restore has been proven, **no destructive migration touches production.** Moving it to "settled"
would read as "backups are settled", which is the one misreading this row must not invite.

| # | What | Why only the owner | What it costs to leave |
|---|---|---|---|
| 1 | **Production database has ZERO backups** | **NO LONGER OWNER-BLOCKED as of 2026-10-30 — this row was wrong.** Supabase Free includes no *managed* backups, and that was read as "no backups are possible", which is false. The database is 32 MB; a nightly export is free and needs no plan. Only *managed* backups need the ~$25/mo plan. **THE MECHANISM EXISTS AND IS UNPROVEN, and those are not the same thing (Dev Team, 2026-10-31).** #1851 is merged, and **the route has never written a file.** It has only ever run in `mode=count`, which proves each paging key *exists* and not that it is *unique* — a non-unique paging key silently truncates an export. The dev-Supabase export was approved on 2026-10-30 and **could not run**, because that database was degraded for 17 hours. No export has ever been produced and **no restore has ever been demonstrated.** So the *blocker* status changed on 2026-10-30 and the *cost* in column 4 did not: read column 4 as literally true today. | **DEFERRED BY THE OWNER 2026-09-11, pending funding.** Their words: *"later we can get the $25/mo once funding is okay"* — they are actively raising. **This is a deliberate decision with a named trigger, not an oversight: revisit when funding lands, and BEFORE the first payment is taken either way.** **What it costs meanwhile:** there is no recovery path from a bad migration, a mistaken delete, or a Supabase-side incident. Defensible at approximately zero users; indefensible the day someone pays. **The operational consequence, which is not optional:** while this stands, **no destructive migration touches production** — no `drop`, no `alter ... type`, no data-rewriting backfill. Additive only (`add column if not exists`, new tables, new policies), which is reversible by dropping what was added. A destructive change with no backup behind it is the one combination on this board with no undo. **The same upgrade also clears the leaked-password protection (#1159) and the dev project's performance ceiling (#1025) — one purchase, three problems, worth deciding once.** |

| 6 | **Sign-off on the new "Couldn't verify plan" UI** | Visual — condition 5. | **Parked by the owner 2026-09-11.** They settled the *behaviour* on #1119 (treat unknown as its own state, neither fail-open nor fail-closed) but **have not seen it rendered.** Comparison page posted on #1119 against both themes, with the existing locked-feature card alongside. **#1119 cannot close without this.** The copy defect this row used to flag — a heading asserting *"Backtest is Pro-only"* above a body saying we could not confirm the plan — **is fixed on `dev` and `qa` (#1195):** the heading is now the page's own name and the body is the owner-approved Option C. **On production since v2026.09.12.** Checked 2026-09-12: #1195's merge is an ancestor of `main`, and production's `/api/version` reports `main`'s head (`9fb4599`). **The sign-off is still open.** Shipping it doesn't mean the owner has seen it. |
| 9 | **#1152: what the pricing lists say about the FREE plan** | User-visible pricing, and visual, so condition 5 applies. | **The three wording picks are DECIDED (relayed via PM/DevOps 2026-09-28), and the fix is BUILT** — branch `feature/plan-features-single-source`, commit `ed1ba646`, held for the next window, not yet on `dev`. Decisions taken: (1) scanner line **"every tracked coin"** (drops the hardcoded "50"); (2) landing **does** show Free's 30 min+ timeframe line; (3) `/upgrade` **does** list Free's exclusions (no Telegram, no price alerts); plus #1117 — a line stating **AI is included, no API key or separate subscription**. Both surfaces now render one shared list (`lib/planFeatures.ts`) with numbers from `lib/limits`. **What still needs the owner:** the condition-5 **visual sign-off** on the rendered result (screenshots) before the issue can close — decided wording is not the same as approved-on-screen. **Also owner-gated, deferred this pass (PM ok):** a label migration to seed the 3 new keys in ko/zh/ru, so the signed-in `/upgrade` shows them translated instead of falling back to English. |
| 11 | **Visual sign-offs waiting (condition 5)** | Visual. | **Screenshots sent 2026-09-12** for **#1244** (the chart's data-source label), **#1220** (page titles on mobile) and **#1225** (the signup loading state). **#1222's set was sent 2026-09-12 ~18:25Z**, after QA verified it: the nav at 768–944px, signed out and signed in with the FREE, TRIAL and PRO badges. In that band theme and language move to `/settings`, and the trial badge drops its day count, which `TrialBanner` still shows. **Also waiting: #1292 (fixes #1285).** When another device has already changed a setting, a stale tab now shows the notice **"Updated from another device"** as an amber toast, in the same corner as Saved/Failed. The words and the look are both the owner's call. Dev is taking screenshots locally, and they'll be batched, not posted on GitHub. Its label seed migration also needs the owner, but English doesn't need it. **None of these issues can close without the owner's sign-off.** **Sequencing hazard:** #1222 and #1244 are already merged to `dev` and will be in release #3, so **get their sign-off before release #3 ships**, or they reach production unapproved. #1220, #1225 and #1292 stay unmerged until they're signed off. **ADDED 2026-10-31 — and this one is ALREADY LIVE ON PRODUCTION, which none of the others are: the 404 page's appearance (#1185).** An unmatched address used to serve Next's own bare error page — no theme, no app shell, no `<html lang>`; it now serves our document with the same three attributes as the rest of the app. **Both states measured on production, not reasoned about.** It shipped without a condition-5 sign-off and **existed only in a source comment and a changelog comment** until Dev Team checked #1185, #1740 and #1810 and found nothing tracking it. **Not reverted unasked, deliberately:** the state it replaced was worse, so undoing it trades an unapproved visual for a known-bad one. It is a yes/no on something already live, not an emergency. **The "undo is ready" line was wrong and Dev Team withdrew it** — there is no prepared revert branch, only a described one, and only a prepared revert is ready. |
| 12 | **No production account can check a signed-in Pro surface** | Needs a production account. | **Asked 2026-09-12 as "release #1's signed-in check, option A or B", and the framing has expired while the question has not.** Release #1 is more than ten releases old; the question underneath it is live and got worse when payments went on. **Option A:** QA creates a disposable production account, runs the signed-in checks, deletes it fully. **Option B:** the owner runs them on their own account. **Why it matters more now than in September:** the owner has **no Pro account on production** (#1667), so alerts, Telegram and every Pro panel are **unverifiable on production by anyone** — on a product that has been taking money since 2026-10-28. Reframed 2026-10-31. |
| 13 | **The alert checks that Bybit can't fully take over (#1266)** | It changes when users get alerts. | **The owner decided on 2026-09-12: "if bybit can do the job then remove binance".** Five checks have moved to Bybit and are merged to `dev` (#1287): RSI, rapid-move, whales, OI-spike and price alerts. One coin is an exception: FET stays on Binance for whales and OI-spike, because Bybit doesn't list FET derivatives at all. **Still being checked:** the funding-rate data that four checks read still comes from Binance first. Dev is working out whether Bybit's can replace it like for like (#1266). Dev's coverage table (on #1266) leaves **two decisions** for the owner. **(1) Two long/short checks** (sentiment extremes' BTC leg, and squeeze): Bybit's ratio describes Bybit's own traders, not Binance's, so the current thresholds don't carry over. Dev proposes shadow-logging Bybit's values for 2–4 weeks, keeping Binance live for the real alerts meanwhile, and then setting thresholds from real data. **(2) Two checks Bybit can't serve at all** (CVD, and distribution): Bybit publishes no taker buy/sell volume and no top-trader position ratio. Either keep Binance for just these two, or redesign them without the missing input, which would give weaker signals. **Until the owner decides, all four stay on Binance.** Nothing's broken meanwhile. |

## Settled — do not re-raise

| What | Status |
|---|---|
| **Payments need four steps on production (was row 3)** | **CLEARED 2026-10-28, confirmed 2026-10-31.** The row named the **LemonSqueezy** dashboard, and LemonSqueezy was rejected for this category; Whop is the route (owner, 2026-10-17). Production now reports **eleven of eleven payment flags true** on `/api/version`, webhook secret included. **The lesson the row existed for is still true and has moved, not died:** setting only the checkout URL opens the door and silently fails every purchase. **What is genuinely open is a different question and is NOT an owner blocker — it is one look:** eleven flags true means *our environment agrees with itself*, because `configuredFlags` reads `process.env` and nothing else. The only external evidence is one row in `lhq_whop_webhook_events`, and there have never been any. Tracked on #1630, with #1869 writing the limit into `lib/configured.ts`. |
| **#1301: the six missing settings columns (was row 14)** | **CLEARED — applied, and verified on production 2026-10-31, seven weeks after the row said it was blocking every signup.** All six columns exist on `lhq_user_settings`: `display_name` `country` `trading_challenge` `beginner_mode` `watchlist` `squeeze_threshold`. **Column existence is not a working save, so that was measured separately:** of 3 settings rows, one carries a `display_name`, a `country` AND a `trading_challenge`, and **all three have a watchlist that differs from the seeded default** — real answers, not defaults. Controls: `user_id` present, a planted `zzqqxx_nope` absent, so the instrument can report both states. Newest write 2026-10-13 05:34Z; nothing since, which is traffic, not a defect. **This row is the file's own failure mode happening to the file: a blocker that cleared itself and sat on the owner's board for weeks because nothing was watching the date.** |
| **Release #2's production DB changes: #1202's `field_updated_at` column and #1157's five FK indexes** | **APPLIED 2026-09-12 ~19:07Z, owner-approved, before the deploy that needed them.** The owner was told first, and the first attempt was blocked by this session's permission layer. The owner then granted it, and it succeeded. Verified by reading back, not by the tool's `success`. The column was read at 19:08:06Z: `jsonb`, `NOT NULL`, default `'{}'`, and 1 of 1 rows read `{}`. All 5 btree indexes were present at 19:08:32Z. The 5-minute watch was clean: 3 PostgREST schema reloads, each under 1.5 s, and 39 of 39 API requests returned 2xx. Release #2 (`55a122c`) went live at 19:42Z, and 7 of 7 `lhq_user_settings` requests afterwards returned 200. Full record on #1252. |
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
