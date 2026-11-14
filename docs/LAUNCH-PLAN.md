# LAUNCH PLAN — the one list until launch

**Owner, 2026-11-14:** *"put all the plan on single md file"*, *"make sure everything are tracked"*.
This file is that list. **PM/DevOps keeps it current** — every row points at the GitHub tracker or PR
where the work and its evidence live. A row with no link is not tracked; fix the row, not the habit.

Updated: 2026-11-14 10:50Z by PM/DevOps. Production serves `fab41aa` (v2026.11.10).

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
| F1 | Seven new Arena strategies (marketing) | ✅ on `qa` (e2d0428), PM + QA passed; live BUY/SELL + strategy logger proven on production after release | #1263, #2307 |
| F2 | Arena sound alerts (ask first; buy / sell / big move; Settings switch) | ✅ on `qa` (e2d0428), PM + QA passed | #2304 |
| F3 | "Signals, not predictions" line + hit rate once data exists (owner option A) | ✅ on `qa` | #1651 |
| F4 | AI disclaimer read from one legal source (landing + footer) | ✅ on `qa` (e2d0428), PM + QA passed | #2302 |
| F5 | 24 px tap targets on the last small controls | ✅ on `qa` (e2d0428), PM + QA passed (0 under 24 px) | #2309, #2312 |
| F6 | Release v2026.11.14 content already on `staging` (tokenized stocks, missing-data states, ko/zh/ru, phone layout) | ✅ on `staging` | #2292 |

## §2 Security, payments, data integrity (must ship)

| # | Item | Status | Where |
|---|---|---|---|
| S1 | Push subscription hardening (security review item; details off GitHub until shipped) | ✅ on `qa` (e2d0428), PM + QA passed; prod permission change on release day | #2318 |
| S2 | Subscription extends atomically (two payments both count) | ✅ on `qa` (e2d0428), PM + QA passed; prod function on release day | #2320 |
| S3 | Input types / lengths / enums + per-route request-size caps | ✅ on `qa` (e2d0428), PM + QA passed | #2322, #2344 |
| S4 | Privacy page: "if you ask us to delete" | ✅ on `qa` (e2d0428), PM + QA passed; prod label rows on release day | #2323 |
| S5 | Telegram alert routes hardened | ✅ on `qa` (e2d0428), PM + QA passed | #2332 |
| S6 | How AI answers are displayed (high severity) | ✅ on `qa` (e2d0428), PM + QA passed | #2326 |
| S7 | Admin console permission fix | ✅ on `qa` (e2d0428), PM + QA passed | #2335 |
| S8 | Request-limit hardening | ✅ on `qa` (e2d0428), PM + QA passed; one hosting setting turned on with the owner at release | #2336 |
| S9 | Admin log hardening | ✅ on `qa` (e2d0428), PM + QA passed | #2339 |
| S10 | Admin audit writes checked; before-state recorded | ✅ on `qa` (e2d0428), PM + QA passed | #2335 |
| S11 | Dependency alerts (Dependabot 14 high, 8 moderate) | ✅ `dev` lockfile audits clean (PM checked); the alerts are on `main`'s older lockfile and clear with the release | #1413 |
| S12 | One production database clean-up (security review item; details off GitHub until done) — **owner approved** | ⏳ release day, PM | #1413, #2292 |

## §3 Pipeline, monitoring, backups

| # | Item | Status | Where |
|---|---|---|---|
| P1 | GlitchTip over its free limit (1,537 of 1,000; ~50% dropped) — expected exchange refusals no longer reported | ✅ on `qa` (e2d0428), PM + QA passed; quota resets 2026-11-21 | #2331 |
| P2 | PostHog receives production events (last seen 3 days ago; low traffic and consent-gated) | ✅ measured 2026-11-14 | #1413 |
| P3 | Production backups: `/api/backup` deployed but never scheduled — set destination + schedule + one restore drill | ⏳ release day, PM | #1413, #2292 |
| P4 | Uptime alert to the owner every 5 min | ✅ | `docs/INFRASTRUCTURE.md` |
| P5 | One promotion `dev` → `qa` → `staging` | 🔄 on `qa` (e2d0428); QA live checks + PM visual sign-off, then QA promotes to `staging` | #2292 |
| P6 | Dev site kept current after each batch | ✅ e2d0428 deploying 10:46Z | — |

## §4 Release day (PM runs, owner approves)

Order matters. Each step is checked before the next.

1. Owner's go for the release (#2292).
2. Production DB, owner-approved: 20261106a (AI refund), 20261106b (atomic extend), 20261114a (alert outcomes), 20261114d (sound setting), anon write revoke, label migrations listed on #2292 (incl. 20261114n privacy), 20261114o, 20261114p, S12 drop. **20261114f (strategy setting) still needs his OK.**
3. Merge `staging` → `main`, deploy with build cache cleared, check a served CSS/JS marker (not just `/api/version`).
4. Five-minute post-deploy check; QA re-runs the release steps on production.
5. P3 backups on; strategy logger 15-min schedule on; S8 hosting setting with the owner (steps held by PM).
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
| O6 | One hosting-account sign-in (2 minutes, with PM) | Turns the S8 fix on |

## §6 After launch (parked on purpose)

Self-serve account delete/export · opt-in dashboard Telegram alerts (CVD / cascade / raid) · sound: no re-ping after a data error · further hardening items from the security review (list held by PM) · field-level encryption of chat ids / push endpoints · webhook payload + sign-up IP purge · nonce-based CSP · DMARC to quarantine · cron secret header-only · admin email-confirmed check · Lemon Squeezy webhook hardening (webhook is off on production).
