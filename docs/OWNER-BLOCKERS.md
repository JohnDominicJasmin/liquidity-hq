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
| 2 | **The RLS `auth.uid()` rewrite is merged and unapplied** | Shared-database write. | **The owner approved DEV-ONLY on 2026-09-07** against a recommendation that named the scope explicitly, and #1036 was re-scoped accordingly: 8 policies across 6 tables, all `lhq_dev_*`, prod statements commented and deferred with the zero-backups reasoning in the header, rollback documented per source migration. Merged, QA-signed-off, **awaiting application**. PM/DevOps holds it and Supabase MCP access is read-only, so it needs the owner or a permission change. **Prod's half waits for row 1** - an RLS rewrite with no backup behind it is the one combination on this board with no undo. |
| 4 | **Nobody on the team can open the LiquidityHQ Supabase dashboard** | Dashboard access. The Supabase tooling PM/DevOps holds is connected to a **different account entirely** — it lists one unrelated project and returns `You do not have permission to perform this action` for `wdtjhrilakoitfcezxpx`. Checked 2026-09-08, so this is measured, not assumed. | **#1025 cannot be fixed, only mitigated.** QA has now proven that: #1046's session caching is working as designed (repeated `TOTAL outbound: 1` per worker, the 5→1 reduction holding at suite scale), and the `HTTP 504` sign-in timeouts **still happen anyway** — 7 in a single partial run. Reduced frequency is not resolution. The remaining question is what is actually consuming the IO budget, and it is answerable only from Query Performance / IO history in the dashboard. Until then #949 and #1025 both stay open and the full suite cannot be trusted to run clean. One read-only look answers it; adding the team as members removes the owner from this loop permanently. |

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
