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
| **Waiting to ship** | **42 commits / 17 PRs** on `qa`, not yet promoted |
| **Blocked by** | nothing on Dev Team's side — #90 and #95 are merged |
| **Next action** | **QA promotes `qa` → `staging`**, then deploys and tests it |

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

**Target: keep the promotion queue under ~5 PRs.** A 15-PR batch is not one
release, it is fifteen changes whose interactions nobody has reasoned about.
This is now a written rule — `CONTRIBUTING.md` §7b, with the commands to
measure it.

---

## Open blockers

| Priority | What | Owner | Blocks |
|---|---|---|---|
| 🔴 1 | **#89** — promote `qa` → `staging`, deploy, open the release PR | **QA** | 42 commits reaching users |
| 🟡 2 | **#78** — LemonSqueezy test-mode keys for staging | **Owner** | checkout + webhook testing only |
| 🟡 3 | **PR #84** — QA doc corrections, partly superseded by #87 | QA to rebase | nothing |
| 🟢 4 | #72 · #73 · #82 · #52 | quota reset / Dev Team | nothing |

Nothing is waiting on Dev Team. The environment audit that #78 opened is
finished — all four services measured against the Render dashboard, `CRON_SECRET`
off `qa`, staging on its own Telegram bot, Brevo on all four.

---

## Standing risks

Not blockers. Things that are true and worth not forgetting.

- **PostHog carried dev traffic into production's project**, roughly
  2026-06-02 → 2026-08-08. Fixed in code (#93), but the fix does not undo the
  data. Any retention, funnel or conversion figure quoted from that window
  includes an unknown amount of dev traffic — heavier before 2026-08-03, when a
  consent gate was added, thinner after.
- **Brevo has no send cap of any kind**, and it is now shared by all four
  environments. A careless QA run can spend production's quota and its sender
  reputation, and neither is visible from the sending side. `trial-reminder` is
  the one route that iterates users; keep it out of automated runs.
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
pull opposite ways, and the rule for when they disagree — **QA judgement is
never traded for schedule** — now lives in `CONTRIBUTING.md` **§3b** rather than
here. It binds both sides, so a QA-owned file is the wrong home for it.

---

## Keeping this honest

- Update the date at the top on every change. A stale status doc is a liability.
- Numbers here come from `git` and the GitHub API, not memory.
- When a blocker clears, move it out the same day. A list that only grows stops
  being read.
