# LAUNCH PLAN — the one list until launch

**Owner, 2026-11-14:** *"put all the plan on single md file"*, *"make sure everything are tracked"*.
This file is that list. **PM/DevOps keeps it current** — every row points at the GitHub tracker or PR
where the work and its evidence live. A row with no link is not tracked; fix the row, not the habit.

Updated: 2026-11-14 09:50Z by PM/DevOps. Production serves `fab41aa` (v2026.11.10).

---

## The rules for this plan

- **Public repo: an unfixed weakness is named here only as an area, never described.** Details live with PM until the fix ships.
- **No new scope before launch.** A new finding becomes a checkbox on its tracker and a row in
  §6 *After launch* unless it is a security, payment or data-integrity defect.
- **Nothing merges without QA's word AND a PM audit comment on the PR** (OWNER-RULES §20).
- **A problem or an uncertainty goes to the owner; he decides.** Only four things need his word:
  merging to `main`, production deploys, his money, writes to the production database.
- **Launch = the release below is live on liquidity-hq.com, every row in §1–§4 is ✅, and §5 is empty.**

Legend: ✅ done · 🔄 in progress · ⏳ waiting (on what is named) · ⛔ blocked

---

## §1 Features in this release

| # | Item | Status | Where |
|---|---|---|---|
| F1 | Seven new Arena strategies (marketing) — framework + liquidity sweep, NY open, EMA stack, supply/demand, Bollinger squeeze, VWAP reclaim, RSI divergence | 🔄 QA cells running; PM audit after | #1263 · PRs #2307 → #2308 → #2311 → #2313 → #2314 → #2315 → #2316 |
| F2 | Arena sound alerts (ask first; buy / sell / big move; Settings toggle) | 🔄 QA cells running | #2304 |
| F3 | "Signals, not predictions" line + hit rate once data exists (owner option A) | ✅ on `qa` | #1651 |
| F4 | AI disclaimer read from one legal source (landing + footer) | ✅ merged to `dev` | #2302 |
| F5 | 24 px tap targets on the last small controls | 🔄 waiting QA word | #2309, #2312 |
| F6 | Release v2026.11.14 content already on `staging` (tokenized stocks, missing-data states, ko/zh/ru, phone layout) | ✅ on `staging` | #2292 |

## §2 Security, payments, data integrity (must ship)

| # | Item | Status | Where |
|---|---|---|---|
| S1 | Push subscribe accepts only real push services | 🔄 QA's #2324 merged into it; PM re-audits once the head is green | #2318 |
| S2 | Subscription extends atomically (two payments both count) | ✅ merged to `dev`; dev DB function applied + exercised by PM | #2320 |
| S3 | Input types / lengths / enums on flagged routes + request-body size cap (per route, PM decision) | 🔄 PR open, needs QA + PM | #2322 |
| S4 | Privacy page: "if you ask us to delete" (no delete button exists) | 🔄 PR open, needs QA + PM | #2323 |
| S5 | Telegram alert routes hardened (security review item; details off GitHub until fixed) | ⏳ Dev queue, after P1 | #1413 |
| S6 | One high-severity issue in how AI answers are displayed (independent review; confirmed by PM) — details off GitHub until fixed | 🔄 PR open; PM code audit PASS (50k-input check, 0 failures); waits CI + QA | #2326 |
| S7 | Admin console permission fix (security review item; details off GitHub until fixed) | ⏳ Dev queue | #1413 |
| S8 | Request-limit hardening (security review item; details off GitHub until fixed) | ⏳ Dev queue | #1413 |
| S9 | Admin log hardening (security review item; details off GitHub until fixed) | ⏳ Dev queue | #1413 |
| S10 | Admin audit writes checked; before-state recorded | ⏳ Dev queue (M batch) | #1413 |
| S11 | Dependency alerts (Dependabot 14 high, 8 moderate) | ✅ `dev` lockfile audits clean (PM checked); the alerts are on `main`'s older lockfile and clear with the release | #1413 |
| S12 | One production database clean-up (security review item; details off GitHub until done) — **owner approved** | ⏳ release day, PM | #1413, #2292 |

## §3 Pipeline, monitoring, backups

| # | Item | Status | Where |
|---|---|---|---|
| P1 | **GlitchTip is over its free limit** — 1,537 of 1,000 events this cycle (Oct 21 – Nov 21), ~50% of new errors dropped. Cause: repeated exchange rate-limit errors reported as errors. Fix: stop reporting expected upstream cooldowns. Cycle resets Nov 21. | ⏳ Dev queue | #1413 |
| P2 | PostHog receives production events (last seen 3 days ago; low traffic and consent-gated) | ✅ measured 2026-11-14 | #1413 |
| P3 | Production backups: `/api/backup` deployed but never scheduled — set destination + schedule + one restore drill | ⏳ release day, PM | #1413, #2292 |
| P4 | Uptime alert to the owner every 5 min | ✅ | `docs/INFRASTRUCTURE.md` |
| P5 | One promotion `dev` → `qa` → `staging`, full gate once on the release | ⏳ after §1–§3 PRs merge | #2292 |
| P6 | Dev site kept current after each batch | 🔄 PM | — |

## §4 Release day (PM runs, owner approves)

Order matters. Each step is checked before the next.

1. Owner's go for the release (#2292).
2. Production DB, owner-approved: 20261106a (AI refund), 20261106b (atomic extend), 20261114a (alert outcomes), 20261114d (sound setting), anon write revoke, label migrations listed on #2292, S12 drop. **20261114f (strategy setting) still needs his OK.**
3. Merge `staging` → `main`, deploy with build cache cleared, check a served CSS/JS marker (not just `/api/version`).
4. Five-minute post-deploy check; QA re-runs the release steps on production.
5. P3 backups on; strategy logger 15-min schedule on.
6. Tag, changelog entry, close what the release finished.

## §5 Owner items — together, at the end

**Owner, 2026-11-14:** none of these block the team. They are done **in one sitting once everything is finished and parked on `staging`**. PM brings this list then.

| # | Item | Why it matters |
|---|---|---|
| O1 | $1 Whop test purchase + cancel | Only proof a real buyer gets Pro — runs on the live site, right after launch |
| O2 | Link his Telegram on the test site + give the account email | One real alert delivered before launch |
| O3 | OK for 20261114f (strategy setting column) on production | Release day |
| O4 | Blind AI test picks | AI quality check, not a blocker |
| O5 | Release go | Launch |

## §6 After launch (parked on purpose)

Self-serve account delete/export · field-level encryption of chat ids / push endpoints · webhook payload + sign-up IP purge · nonce-based CSP · DMARC to quarantine · cron secret header-only · admin email-confirmed check · Lemon Squeezy webhook hardening (webhook is off on production).
