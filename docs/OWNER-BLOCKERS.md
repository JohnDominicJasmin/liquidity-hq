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
| 1 | **Production database has ZERO backups** | Supabase Free includes no backups at all — not a short window, none. Upgrading needs a payment method. ~$25/mo. | **There is no recovery path** from a bad migration, a mistaken delete, or a Supabase-side incident. This is the reason shared-database writes are an owner gate and stay one. Deliberately deferred while there are no real users, which is defensible — but it must be done **before** the first payment, not after. |

| 3 | **Payments need FOUR steps on production, not one** | LemonSqueezy dashboard + Render. | PM/DevOps reported this as "set the checkout link" and that was **wrong and dangerous**. The four, in order, are in `docs/HANDOVER.md` §11. **The webhook secret is the one that must not be missed:** without it `verifySignature` rejects every delivery, so a customer is charged and granted nothing. Setting only the checkout URL opens the door and silently fails every purchase — strictly worse than leaving it shut. |
| 4 | **Supabase dashboard UI access — API access now works, the dashboard does not** | Dashboard membership. **This row used to say nobody could reach the projects at all. That is no longer true.** On 2026-09-11 PM/DevOps ran live queries against **both** `wdtjhrilakoitfcezxpx` and `qdpwhnvmhqgzijuwopso` — policy inspection, health probes, key retrieval. The API path is working. | **What still needs the dashboard is narrower than this row claimed:** Query Performance and IO history, which the API does not expose. That is what #1025 needs to move from *demonstrated* to *explained* — the dev project is now proven to hang outright (120-sample probe, two 30s timeouts on separate paths) but nobody can see what consumes its IO budget. **Everything else this row blocked is unblocked.** |
| 5 | **#1037's migration — two columns on `lhq_user_settings`** | Shared-database write. | **Parked by the owner 2026-09-11** (*"things for me, park it for now"*). **Verified by PM/DevOps rather than relayed:** `add column if not exists` × 2, both nullable `jsonb`, no drop, no backfill, no data change; null means *never saved*, so existing rows behave exactly as today. **About as safe as a migration gets.** **The ordering is the risk, not the change** — if #1037 merges before the columns exist, every signed-in user's Strategy Panel edit silently 400s on `/arena`, surfacing only on `/settings`. The PR self-flags this correctly and dev is holding. Blocks a standing owner requirement (#1020). |
| 6 | **Sign-off on the new "Couldn't verify plan" UI** | Visual — condition 5. | **Parked by the owner 2026-09-11.** They settled the *behaviour* on #1119 (treat unknown as its own state, neither fail-open nor fail-closed) but **have not seen it rendered.** Comparison page posted on #1119 against both themes, with the existing locked-feature card alongside. **#1119 cannot close without this**, and one copy defect is outstanding: `FullPageEntitlementUnknown`'s heading asserts *"Backtest is Pro-only"* above a body saying we could not confirm the plan — **which reintroduces through the heading exactly the conflation the decision removed.** Fix that before it goes in front of them. |

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
