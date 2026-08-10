# Where the project is

**One page. If you only read one thing, read this.**

Kept current by QA. Last updated **2026-08-10**.

## Read this before you trust anything below

This file has now gone stale **twice**, and the second time is the useful one.

Version one restated commit counts and branch positions; they were wrong within a
day. So version two removed the counts — and went stale in **four hours**,
because it still recorded *state*: which commit production served, which release
was in flight, which owner actions were outstanding. All four were wrong by the
same evening.

**Counts were never the problem. Anything that changes is.**

So this file no longer records state at all. What survived a full release day
unchanged were the two sections below: **decisions**, and **risks**. Those are
what a status file is actually for — the things that are expensive to re-derive
and cheap to forget.

**For anything current, run these. They cannot be stale:**

```bash
gh pr list --state open
gh issue list --state open
git fetch --all && for b in dev qa staging main; do echo "$b $(git rev-parse --short origin/$b)"; done
curl -s https://liquidity-hq.com/api/version          # what prod SERVES, not what merged
git describe --tags --abbrev=0 origin/main            # what it was tagged
```

The last two matter together. `main` moving is not a deploy — both Render
services are `autoDeploy: "no"`, so merging ships nothing until someone triggers
one. The drift check exists because those two answers diverge on every release.

**Owner actions** are not listed here either; they were outstanding for one
morning and done by lunchtime. They live on the issue that needs them.

---

## Decisions already made — do not re-litigate these

| Decision | Date | Where the reasoning lives |
|---|---|---|
| **Arabic is pulled from the picker**, `lang`/`dir` set from the route. Option B, not an RTL implementation | 2026-08-08 | #138, shipped in #147 |
| **The service-role key IS allowed in CI**, dev project only, E2E job only. Reverses `ci.yml`'s former "must never be" | 2026-08-09 | beside the variable in `ci.yml`; #153 |
| **`staging` exists so a signed-off release stops growing.** Only QA promotes into it, and never while a release PR is open | 2026-08-07 | `CONTRIBUTING.md` §6 |
| **Never require PR approvals.** Dev and QA share one GitHub account, so `Can not approve your own pull request` would deadlock every release permanently | 2026-08-08 | `CONTRIBUTING.md` §3a |
| **The signup trial trigger is fine.** Measured, not assumed — the three rowless accounts predate it and every signup since 2026-08-01 has a row | 2026-08-09 | #127, closed |
| **`s-maxage` caches nothing here.** No shared cache fronts either service: `age` absent on every response, `x-render-origin-server` present on every repeat, and an `immutable` static chunk is `cf-cache-status: DYNAMIC` too. What collapses upstream calls is server-side — `cached()` in `lib/apiCache.ts` and `next: { revalidate }` | 2026-08-10 | #198, #197 closed with the measurement |
| **The suite can address a deployed service.** `E2E_BASE_URL=https://…` sets `baseURL` and drops the `webServer`. Before this, every "verified on qa" claim was measured against a *local build of the same commit* | 2026-08-10 | #203; comment in `playwright.config.ts` |
| **A cache assertion must measure the DATA, not a header and not a clock.** Both market routes stamp `ts: Date.now()`, so whole-body diffs vary however well the data is cached | 2026-08-10 | `qa/e2e/cache-effective.spec.ts` header |

---

## Open issues — how to read them, not what they are

Listing issues here was the third thing that went stale. Six were listed this
morning; five closed the same day.

```bash
gh issue list --state open
```

**What is worth writing down is the shape**, because it repeats:

- **"QA verify"** items close on *evidence from a release gate log or production*,
  never on a merge. #120 existed purely because a merged spec had never executed.
- **"Dev, then QA"** items need two PRs in order — app change first, spec
  re-anchor second. Reversing that leaves the suite broken in between.
- **Owner items** are usually a dashboard click and a sentence. They are only
  slow when nobody names which dashboard.

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
- **The E2E gate is not currently running** — #207. E2E fires only on release PRs,
  and `RELEASE_PR_PAUSED` stops those being opened, so across 60 CI runs the only
  completed browser suites were two manual dispatches. `smoke`, `cache-policy` and
  `cache-effective` are covered by QA running them against the deployed services;
  **`perf`, `a11y`, `a11y-auth`, `bola`, `contrast`, `i18n`, `layout`, `clock`,
  `payments-webhook` and `checkout` are covered nowhere** until this is fixed.
- **`perf.spec`'s LCP budget was calibrated on a laptop.** `< 2500ms` against a
  local 84–720ms measurement — 3× headroom over a dev machine and none over a
  GitHub runner, where the five heaviest routes land at 2740–4456ms. It fails in
  CI and passes locally on the same commit, so it currently gates nothing and
  would not be believed if it did. Do **not** raise the number to make it green;
  decide first whether it asserts a user-facing target or catches regressions.
- **An empty result is not evidence unless something proves the instrument works.**
  This bit three separate times on 2026-08-10 and is the single most repeated
  defect in this suite: `cache-policy` asserted headers that cached nothing;
  `/api/cmc` and `/api/proxy` skipped permanently while reporting green; the
  contrast detector parses a human-readable axe message with a regex, so an
  upstream reword would silently return zero violations forever. Each now carries
  a control or a named cause. **Any spec asserting "no findings" needs one.**

---

## Keeping this honest

- **Do not add a number that git or `gh` can answer.** That is what made the first
  version stale in a day.
- Update the date on every change.
- When a blocker clears, move it out the same day. A list that only grows stops
  being read.
- Decisions move to the decisions table so they are not re-argued from memory.
