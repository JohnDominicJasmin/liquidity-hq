# Where the project is

**One page. If you only read one thing, read this.**

Kept current by QA. Last updated **2026-08-08**.

If a date at the top of this file is more than a day old, treat every number
below as stale and check the branches yourself — a status doc nobody updates is
worse than none, because it reads as current.

---

## Right now

| | |
|---|---|
| **Live in production** | `v2026.08.07` |
| **Waiting to ship** | **35 commits / 14 PRs** on `qa`, not yet promoted |
| **Blocked by** | PR **#90** — needs Dev Team review |
| **Blocking** | everything in the row above |

**One-line version:** the product is fine, the queue is not. Work is being
finished faster than it is being released.

---

## The pipeline, and where things get stuck

```
dev  ──►  qa  ──►  staging  ──►  main ──► users
 │         │         │            │
 dev       dev       QA           QA
 merges    promotes  promotes     merges + deploys + tags
                     (the freeze)
```

| Branch | Deployed at | Who moves it into here |
|---|---|---|
| `dev` | `liquidity-hq-dev.onrender.com` | Dev Team |
| `qa` | `liquidity-hq-qa.onrender.com` | Dev Team |
| `staging` | `liquidity-hq-staging.onrender.com` | **QA** |
| `main` | `liquidity-hq.com` | **QA** |

**Nothing auto-deploys.** Moving a branch does not move an environment; a human
triggers every deploy. So "merged" is three manual steps away from "live", and
each of those steps is somewhere work can sit unnoticed.

`staging` exists so a release QA has signed off stops changing. Before it, every
`dev` → `qa` promotion silently grew an open release — three times on 2026-08-06,
once after a completed manual pass.

---

## The number that actually matters

Not commits. **Cycle time: merged → live.**

1,491 commits in 75 days is not the problem and never was. The current batch has
sat finished for **2 days**, and nothing surfaced that until someone asked.

| | |
|---|---|
| Releases before 2026-08-05 | **0 tagged** — code reached production with no record of what shipped |
| Releases since | 7, all in 3 days |

So the release process is **three days old**. It is being debugged in public, and
that is what the last two days of work mostly were.

**Target: keep the promotion queue under ~5 PRs.** A 14-PR batch is not one
release, it is fourteen changes whose interactions nobody has reasoned about.

---

## Open blockers

| Priority | What | Owner | Blocks |
|---|---|---|---|
| 🔴 1 | **PR #90** — contrast baselines track tokens, not counts | Dev Team review | the whole queue |
| 🔴 2 | **#89** — promote `qa` → `staging`, open release PR | QA | 35 commits reaching users |
| 🟡 3 | **#78** — staging environment variables | Owner decisions + QA writeup | testing Telegram/push/email/payments on staging |
| 🟡 4 | **PR #84** — QA doc corrections, now partly stale | QA to rebase | nothing |
| 🟢 5 | #72 · #73 · #82 · #52 | quota reset / Dev Team | nothing |

---

## Standing risks

Not blockers. Things that are true and worth not forgetting.

- **`staging` is the least-configured environment**, and it is the one QA now
  signs off releases on — 10 variables against `qa`'s 23. Telegram, push, email,
  payments and `/ops` all silently do nothing there, and "feature absent" looks
  identical to "feature broken". This is #78.
- **Error monitoring captures nothing.** GlitchTip returns 429 on every event;
  the SDK honours it and drops events client-side. Installed, configured,
  capturing zero. #73.
- **The PII scrubber has never run on a real event** — 15/15 unit tests, zero
  real events, because of the above. #72.
- **`qa` and `dev` share one Supabase project.** A clean QA run is not proof the
  data path is clean.
- Everything in [`TEST_GAPS.md`](TEST_GAPS.md) — what a green suite does *not*
  mean.

---

## Who does what

| | Dev Team | QA |
|---|---|---|
| Writes app code | ✅ | ❌ never |
| Writes tests + CI | reviews | ✅ owns `qa/` |
| `dev` → `qa` | ✅ | |
| `qa` → `staging` | | ✅ the freeze |
| `staging` → `main` | | ✅ |
| Deploys production | ❌ | ✅ |
| Render dashboard, secrets | ❌ | ❌ — **owner only** |

QA-authored code goes through a PR into `dev` that **Dev Team reviews and
merges**. That is the one place review runs QA → dev, and it is why QA cannot
unblock its own PRs.

**One tension worth naming:** QA is the gate and also tracks throughput. Those
pull opposite ways. The rule is that **QA judgement is never traded for
schedule** — when the two disagree, it gets said out loud and the owner decides.
It is not resolved quietly in favour of shipping.

---

## Keeping this honest

- Update the date at the top on every change. A stale status doc is a liability.
- Numbers here come from `git` and the GitHub API, not memory.
- When a blocker clears, move it out the same day. A list that only grows stops
  being read.
