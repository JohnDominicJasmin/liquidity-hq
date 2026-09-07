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
| 2 | **`CRON_SECRET` is still set on `liquidity-hq-qa`** | Render environment change. | The qa service holds **dev's** Telegram bot credentials. Anyone who knows qa's `CRON_SECRET` can register a webhook and silently redirect every alert. Decided 2026-08-05, documented in `pendings/PENDING.md`, **never done**. The fix is deleting one row; `checkCronAuth` fails closed with no value (`lib/cronAuth.ts:22`), so removal locks the door rather than opening it. |
| 3 | **Payments need FOUR steps on production, not one** | LemonSqueezy dashboard + Render. | PM/DevOps reported this as "set the checkout link" and that was **wrong and dangerous**. The four, in order, are in `docs/HANDOVER.md` §11. **The webhook secret is the one that must not be missed:** without it `verifySignature` rejects every delivery, so a customer is charged and granted nothing. Setting only the checkout URL opens the door and silently fails every purchase — strictly worse than leaving it shut. |
| 4 | **Nobody can open Sentry or PostHog** | Only the owner has dashboard access. | `TEST_GAPS.md` §10 has been blocked for weeks. Nobody can confirm error alerting or analytics actually deliver. If the app started throwing errors for real users tonight, **we do not know that anyone would be told.** One number from each dashboard unblocks it; read access for the team removes the owner from the loop permanently. |
| 5 | **`liquidity-hq-dev` has no assigned deployer** | Needs the owner to name one. | The 2026-09-03 instruction "dev deploys nothing" was aimed at production and left the *dev* service with nobody. Nothing is broken — local verification is the default — but the row has read "unassigned" in `CONTRIBUTING.md` since, and inventing a holder is exactly the mistake that section already made once. |
| 6 | **The RLS `auth.uid()` rewrite is prepared and unapplied** | Shared-database write. | PR #1036. Supabase's own advisor flags per-row re-evaluation across most of the schema, and it is a second, unmeasured contributor to #1025's IO budget alongside the test sign-in churn. Prepared deliberately, not applied. |

## Settled — do not re-raise

| What | Status |
|---|---|
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
