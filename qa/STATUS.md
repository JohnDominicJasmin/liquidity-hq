# Where the project is

**One page. If you only read one thing, read this.**

Kept current by QA. Last updated **2026-08-11**.

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
| **A spec that reads the database asks the TARGET which table set it is using.** `lib/tables.ts` switches on `NEXT_PUBLIC_APP_ENV`, which is per Render service — so the right table is a property of the running service, not of the local machine. `/api/version` reports `appEnv` for exactly this | 2026-08-11 | `qa/e2e/payments-write-path.spec.ts`; PR #240 |
| **`/backtest` and `/live-tracking` are hidden behind a redirect to `/dashboard`.** Owner's call — the routes are blocked, not merely dropped from the nav. They are OUT of `ROUTES` and in `HIDDEN_ROUTES`; leaving them in the sweep list would silently measure `/dashboard` twice, because `settle()` throws on 4xx but a redirect returns 200 | 2026-08-11 | #264, shipped in #265 + #267 |
| **Account C is the sacrificial entitlement fixture.** A and B stay pinned (`pro` / `free`) and `entitlements.spec.ts` fails if either drifts, so anything that flips a role uses C | 2026-08-11 | #239, closed |
| **`next@16.3.0` is SCHEDULED, not deferred.** Owner decision. Trigger: **#243 passes AND the current release reaches `main`.** Its own release, nothing else in it, **CI temporarily re-enabled** for the duration — a keyless build is the gate that catches upgrade breakage and is the one thing local gates cannot replace. Until then two **build-time** highs are knowingly accepted (`next`'s bundled `postcss`, `sharp`); neither is reachable by a visitor | 2026-08-11 | #257, open by design |

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

- **No REAL PURCHASE has ever granted Pro.** Still the highest launch risk, and
  narrowed on 2026-08-11 rather than cleared — be precise about which half is
  which, because "payments are tested" is now half true and that is the dangerous
  kind of true:

  ```
  is the caller allowed to reach the decision   payments-webhook.spec.ts      covered
  is the decision right                         lemonsqueezyEvents.test.mts   covered
  does the decision reach the database          payments-write-path.spec.ts   covered 2026-08-11
  does a real purchase produce the event        nothing, anywhere             NOT COVERED
  ```

  All three covered halves use **synthetic payloads signed with a local secret**.
  No LemonSqueezy account is involved in any of them. Closing the last row needs a
  test-mode store, a product, and a sandbox checkout — not just a key, and there is
  no workaround that makes a signed payload into evidence about a purchase.

  The write path runs against account C only (#239). It has **never run against
  `qa` or `staging`** — neither service has a `LEMONSQUEEZY_WEBHOOK_SECRET` to sign
  with, so it is currently verified on a local production build alone.
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
- **ALL CI IS DISABLED**, on the owner's instruction, for cost — 2026-08-10.
  `CI`, `Ready for QA` and `Release signals` are all `disabled_manually`. Nothing
  was changed in any workflow file; `gh workflow enable <file>` restores each.

  **What that removes:** lint, typecheck, unit tests and build on every push, the
  browser-suite gate, the "Ready for QA" issue on promotion, and the production
  drift check that compares what prod *serves* against `main`.

  **What still works, and it is most of what was actually used:** every spec runs
  against a deployed service via `E2E_BASE_URL` with no CI involved. The whole of
  2026-08-10's verification was done that way.

  **The one thing genuinely lost** is the keyless build environment. CI is the
  only place the app compiles without developer env, and that difference has
  produced three real defects — most recently the `/live-tracking` mobile footer
  (#221), which is not reproducible on any deployed service because the footer
  sits below the fold there.

  **Three of the four gates are now enforced locally** — `.githooks/pre-push`
  runs lint, tsc and the unit tests before every push (#246, shipped in #248).
  One line per clone, and it is NOT automatic because `.git/` is not versioned:

  ```bash
  git config core.hooksPath .githooks
  ```

  **It is a convenience, not a replacement.** `--no-verify` bypasses it, and it
  runs on the developer's own machine with the developer's own env — so it can
  never catch the keyless-build class of defect above. **`npm run build` is
  deliberately not in it** (~90s against ~25s for the other three; a gate people
  disable protects nothing), so build stays manual before every PR.

  When someone asks whether CI is still needed, the answer is yes, and the
  paragraph above is why.
- **`lib/apiCache.ts` holds an unbounded Map.** `store` has no eviction, no cap
  and no TTL sweep — expiry stops an entry being *served*, it does not free it.
  Any `cached()` caller whose key includes a user-controllable value can mint
  permanent entries. Found via `/api/proxy` and fixed **for that route only**
  (#242's per-request `CURSOR_PARAMS` check); the primitive is unchanged. #253.
- **The browser now makes ZERO calls to any exchange** — measured 10/10 routes on
  merged `dev`, 2026-08-11 (#238, from a 2,246 baseline). The consequence is that
  `/api/proxy` carries fifteen passthrough types behind **one** shared rate limit
  and **one** shared cache. If that route fails, far more of the app goes quiet
  than before. That is the accepted cost of the consolidation, not an oversight.
- **`perf.spec`'s LCP budget was calibrated on a laptop.** `< 2500ms` against a
  local 84–720ms measurement — 3× headroom over a dev machine and none over a
  GitHub runner, where the five heaviest routes land at 2740–4456ms. It fails in
  CI and passes locally on the same commit, so it currently gates nothing and
  would not be believed if it did. Do **not** raise the number to make it green;
  decide first whether it asserts a user-facing target or catches regressions.
- **A probe must prove it reached the thing it is measuring.** Added after my own
  measurement tool produced a false 48% improvement on 2026-08-10: `page.goto`
  timed out on a sleeping free-plan service, the `catch` swallowed it, and the
  counter stayed at zero. **Six routes reported 0 exchange calls because they
  never loaded.** A failed navigation was indistinguishable from a page that
  makes none.

  Any probe that counts things must assert the navigation returned OK **and**
  that the page rendered — and must *name* the routes it could not measure
  rather than counting them as zero. The corrected run matched the previous
  figure exactly, which is how the bug was confirmed rather than argued about.
- **A render guard proves the measurement HAPPENED. It says nothing about whether
  the measurement MEANS anything.** Added 2026-08-11 after I told the owner not to
  start a payment run on evidence that could not exist.

  I checked `/upgrade` for `a[href*="checkout"]`, found zero, and reported the
  checkout URL had not reached the build. My probe had a render guard and it
  passed — 118 controls, styled, not signed out — so I trusted the zero.

  **The CTA is a `<button onClick>` that builds the URL at click time**
  (`app/upgrade/page.tsx:159`). The URL is never in the DOM, so that selector
  returns **0 on a working build and a broken one alike.** Dev measured the same
  zero and read it correctly; the number was never the disagreement.

  This is a DIFFERENT defect from the one below and the distinction is the whole
  point: the instrument reached the page, and was then asked a question it had no
  way to answer. Before trusting any zero, ask **what a positive result would have
  looked like** — if you cannot describe it, the assertion is not measuring what
  you think.

  The check that worked was grepping the served JS chunks for the URL, because a
  string cannot appear in a bundle it was not inlined into. Method-independent
  beats DOM-shaped when the two disagree.
- **Specs that hardcode `localhost` test nothing on a deployed service**, and one
  of the two failure modes is silent. Found 2026-08-11 in the first full suite run
  against deployed `qa`:

  - `security.spec.ts` requested `http://localhost:3100` explicitly, so with
    `E2E_BASE_URL` set it died `ECONNREFUSED`. **The security headers on qa,
    staging and production had therefore been asserted by nothing.** They are
    correct — but "correct when curled by hand" and "checked by the suite" are
    different claims and only the first was ever true.
  - `perf.spec.ts` treated `!url.startsWith('http://localhost')` as "third party",
    so on a remote run **every same-origin request counted as foreign.** That one
    does not error, it inflates — and a baseline recorded remotely would be
    inflated to match.

  Both fixed in #266. The lesson generalises: after #203 made the suite
  addressable at a deployed service, anything holding a URL constant became a
  spec that silently only ever tested one environment.
- **A metric that counts rendered elements has more uncontrolled inputs than
  market data.** `a11y.spec.ts`'s tap-target sweep moved 122 → 148 with no code
  change. Dev measured why: browser **consent state** shifts it by ~32, because
  `a.consent-link` is 73x14 and renders on every route while the banner is up.
  Market fixtures alone were not enough (#268); consent had to be pinned too
  (#270).

  Pinned to `denied`, matching `layout.spec.ts`'s ordinary sweep — first-visit
  banner coverage lives there and belongs there. **The baseline was deliberately
  NOT re-set in the same change**: picking a number in the commit that first makes
  it measurable means the baseline comes from a run nobody has looked at twice.
  #263 holds that.
- **An empty result is not evidence unless something proves the instrument works.**
  This bit **seven** separate times on 2026-08-10 and is by a distance the most
  repeated defect in this suite: `cache-policy` asserted headers that cached
  nothing; `/api/cmc` and `/api/proxy` skipped permanently while reporting green;
  the contrast detector parses a human-readable axe message with a regex, so an
  upstream reword would silently return zero violations forever; the egress tally
  reported `0` while a worker in the same run had counted 8; and — the worst one —
  **the entire BOLA/IDOR suite ran zero tests for want of one missing variable**,
  reporting only `20 skipped`. Each now carries a control or a named cause.
  **Any spec asserting "no findings" needs one.**
- **`skipped` is the same trap as `passed`, and it hides better.** A skip is
  designed to be unremarkable, so twenty of them scroll past where twenty
  failures would not. On 2026-08-10 `E2E_B_PRICE_ALERT_ID` was absent from
  `.env.e2e.local` — CI supplies it as a GitHub *variable* rather than a secret,
  so it was never copied across — and that single absence skipped every
  authenticated test: cross-account access, RLS, forged tokens, signed-in
  accessibility. The browser suite was not running in CI at the same time, so the
  authenticated security surface was verified by **nothing, anywhere**, and
  neither half raised a hand.
  **Every skip must name the specific thing that is missing**, not a category.
  The old message listed `E2E_USER_A_* / E2E_USER_B_* / E2E_A_*_ID / ...`, which
  reads as "QA has no test accounts" rather than "one id is missing".
- **Production is currently emitting an uncaught error that monitoring drops.**
  Measured on prod 2026-08-10: `/briefing` throws React #418 and the report to
  GlitchTip comes back `429`. Both halves in one page load. The error is #193,
  already fixed by #195 and verified absent on `staging` — it is simply not
  shipped. **So GlitchTip reads zero errors and that zero is false**, which is
  worse than reading nothing because zero looks like health. See #51, #193.

---

## Keeping this honest

- **Do not add a number that git or `gh` can answer.** That is what made the first
  version stale in a day.
- Update the date on every change.
- When a blocker clears, move it out the same day. A list that only grows stops
  being read.
- Decisions move to the decisions table so they are not re-argued from memory.
