# Where the project is

**One page. If you only read one thing, read this.**

Kept current by QA. Last updated **2026-08-09**.

## Read this before you trust anything below

The first version of this file was reviewed with one caveat, and the caveat was
right: **it went stale while the PR was open.** Five lines were wrong within a
day, and its own opening sentence was the standard it failed.

So it has been rebuilt around what actually changes slowly. **Counts and branch
positions are not written down here** — they are wrong within the hour, and a
wrong number that looks authoritative is worse than no number. What is written
down is the part that does not move: decisions, who is blocked on whom, and the
risks nobody has retired.

**Measure the volatile things yourself. Two commands:**

```bash
git fetch --all && for b in dev qa staging main; do echo "$b $(git rev-parse --short origin/$b)"; done
gh pr list --state open --json number,title,baseRefName -q '.[] | "#\(.number) -> \(.baseRefName)  \(.title)"'
```

Production's *actual* served commit is `/api/version` on liquidity-hq.com — not
`main`, not the last merge. The drift check reads that endpoint for exactly this
reason.

---

## Right now

| | |
|---|---|
| **Live in production** | `ec171db`, tagged `v2026.08.08`, verified on the live build |
| **Production deploys** | Running normally. The owner's halt was lifted 2026-08-08 |
| **In flight** | Release PR **#150**, `staging` → `main`. Gate running |
| **Flow** | `dev` → `qa` → `staging` → `main`, four services, one per branch |

**One-line version:** production is healthy, a release is in its gate, and the
board is down to six open issues from twelve.

---

## Waiting on the OWNER — nothing moves on these without them

| What | Blocks | State |
|---|---|---|
| **Add repo secret `E2E_SUPABASE_SERVICE_ROLE_KEY`** (the **dev** project's key, never prod's) | three Pro-gated surfaces stay verified by nothing | decided 2026-08-09, secret not yet added |
| **Remove `CRON_SECRET`** from the `liquidity-hq-qa` Render service | closing #78 | agreed 2026-08-09 |
| **Deploy `staging`, then production** after #150 merges | the release | Render is `autoDeploy: "no"` — merging ships nothing |
| **LemonSqueezy test-mode keys** | proving we are wired to the right store | not needed for the harness, which now runs |

---

## Decisions already made — do not re-litigate these

| Decision | Date | Where the reasoning lives |
|---|---|---|
| **Arabic is pulled from the picker**, `lang`/`dir` set from the route. Option B, not an RTL implementation | 2026-08-08 | #138, shipped in #147 |
| **The service-role key IS allowed in CI**, dev project only, E2E job only. Reverses `ci.yml`'s former "must never be" | 2026-08-09 | beside the variable in `ci.yml`; #153 |
| **`staging` exists so a signed-off release stops growing.** Only QA promotes into it, and never while a release PR is open | 2026-08-07 | `CONTRIBUTING.md` §6 |
| **Never require PR approvals.** Dev and QA share one GitHub account, so `Can not approve your own pull request` would deadlock every release permanently | 2026-08-08 | `CONTRIBUTING.md` §3a |
| **The signup trial trigger is fine.** Measured, not assumed — the three rowless accounts predate it and every signup since 2026-08-01 has a row | 2026-08-09 | #127, closed |

---

## Open issues and what closes each

| # | Closes when | Whose |
|---|---|---|
| #138 | #147 reaches production and `/ar` 404s there | QA verify |
| #120 | `entitlements.spec.ts` is observed **executing**, not skipping, in a release gate log | QA verify |
| #114 | every spec touching market data installs fixtures, then `workers` unpins with zero 429s | QA |
| #82 | the log line distinguishes filtering from a delivery outage, with a test pinning it | Dev |
| #78 | `CRON_SECRET` comes off the qa service | Owner |
| #52 | the testids land and the specs are re-anchored to them | Dev, then QA |

---

## Standing risks

- **Payments have never been exercised end to end.** No real purchase has granted
  Pro and no lapsed subscription has been shown to re-lock. The webhook handler
  is now covered against forged, replayed and cross-account payloads — **but only
  synthetic ones.** Highest launch risk.
- **Nothing has ever looked at a rendered page** — `TEST_GAPS.md` §2. Contrast,
  labels and structure are measured; appearance is not.
- **The contrast sweep is data-dependent.** Fixtures exist for 17 third-party
  endpoints, but our own `/api/*` routes still feed several surfaces, so a route
  that renders nothing measures clean.
- **`staging` and `dev` share one Supabase project.** A clean run on the staging
  site is not proof the data path is clean, and a migration applied "to qa"
  applies it to dev for everyone.
- **No PR in this repo can ever be approved** — one shared account. See the
  decisions table.
- **A skip is not a pass, and this suite has several.** Every one names its reason
  in the skip message. Read them; some are accepted limits and some are findings.

---

## Keeping this honest

- **Do not add a number that git or `gh` can answer.** That is what made the first
  version stale in a day.
- Update the date on every change.
- When a blocker clears, move it out the same day. A list that only grows stops
  being read.
- Decisions move to the decisions table so they are not re-argued from memory.
