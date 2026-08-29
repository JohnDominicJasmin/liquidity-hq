# Where the project is

**One page. If you only read one thing, read this.**

Kept current by QA. Last updated **2026-08-12**.

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
| **The product has NO REAL USERS yet.** Production is live and nobody depends on it. Data-quality bugs on prod are worth fixing and are **not emergencies** — do not argue priority from user harm, argue it from pipeline debt or from work that cannot be verified until it ships | 2026-08-12 | owner, in session |
| **All three GitHub workflows are DISABLED ON PURPOSE, and `RELEASE_PR_PAUSED = 1`.** The repo is private, so every Actions minute is billed to the owner personally. This is cost control, not an outage — **do not enable a workflow or dispatch a run**, and do not file the disabled state as a defect. "No CI ran on this branch" is the normal state and does not belong in every PR as a caveat | 2026-08-12 | #285, closed as not-a-defect |
| **Local gates are the substitute, and they are free.** lint, `tsc`, unit tests via the pre-push hook, and Playwright against a **deployed** host all run on the QA machine at no cost. A deployed-service run is stronger evidence than CI's own ephemeral build. Prefer one targeted spec run over a full sweep — a 40-minute suite also wakes the free-plan Render services | 2026-08-12 | this file, §Standing risks |
| **`staging` is the destination, not a waiting room.** Verified work parks there and stays. The owner decides when anything reaches production, on their schedule — "when all changes are piled up then we release and open the gates". Do not chase the release, do not re-raise it each turn | 2026-08-12 | owner, in session |
| **An issue closes on `qa` + `staging` evidence — production is NOT required.** Reverses the stricter rule adopted after #264 was closed on qa-only evidence. Both environments, plus the work parked on `staging`, is sufficient; say in the close comment that it is on staging and not yet prod, so nobody reads it as shipped | 2026-08-12 | owner, in session |
| **Non-prod's CRON-FED tables are frozen, and that is ACCEPTED - not a bug to fix.** `econ_snapshot`, `news` and `live_signals` on the dev project are 8-23 days stale; prod's refresh every few minutes. The scheduler works and only ever targeted prod. **Fixing it requires setting `CRON_SECRET` on a non-prod host, which `lib/cronAuth.ts` unlocks ALL NINE cron routes with - including `telegram/setup-webhook`, and a bot has one webhook.** Blast radius of leaving it: a human browsing qa/staging sees an old calendar. Specs use fixtures, `econ-calendar.spec` asserts the route, and market data is user-driven and current. **A stale calendar on qa says NOTHING about the market data beside it** - do not discount both | 2026-08-12 | #261, with the side-by-side measurement |
| **Coinglass fixtures are NOT needed - nothing calls Coinglass.** `/api/proxy` supports four types: `coinglass-flow`, `coinglass-liq`, `etf`, `trends`. Both `coinglass-*` branches hit the retired `/public/v2/` API, return 500 even with a key, and **no caller in `app/`, `components/` or `lib/` references either** - measured, not assumed. `etf` is SosoValue and `trends` is Google; neither needs a key. There is no Coinglass-backed panel for a sweep to depend on, so fixturing one would invent coverage for a surface that never renders | 2026-08-12 | `app/api/proxy/route.ts` header; `pendings/PENDING.md` holds the v4 migration |
| **A FULL UI REDESIGN IS COMING, from Claude Design. All UI, alignment, padding and copy work is DROPPED.** Owner, 2026-08-14: *"anything about UI, alignment, remove or change text or any padding related work let's drop it"* — and separately *"if its a bugfix like chat quota #382 then let's work on it"*. **The line is logic vs presentation, not severity.** #383 #388 #391 #397 #398 #399 #401 #403 #353 were all closed the same day with their measurements intact. Do not re-file a UI defect against the current design | 2026-08-14 | owner, in session |
| **Redesign scope: 33 user-facing screens. `/admin` and the six `/ops` routes are UNCHANGED.** So **two design systems will coexist**, and a token-conformance check must be scoped to the user-facing routes — a global one reports the eight internal screens as non-compliant on every run, and a suite permanently red on known-good pages is one people stop reading | 2026-08-14 | owner, in session; full route list in the screen inventory |
| **Design alignment = TOKENS EXACT, LAYOUT JUDGED.** Colour, type scale, spacing steps and radii must match the export and are asserted mechanically. Composition is checked by eye and only reported when a person would notice. **Off-token is a defect; off-mock is a judgement.** The owner first said "pixel by pixel"; both readings were put to them with their consequences (~10 findings/screen vs ~60) and this is the one they chose | 2026-08-14 | owner, in session |
| **Redesign review loop: localhost on dev's branch during the build, `qa` for sign-off, one screen per PR.** 33 screens in one PR is untestable and gives the owner a wall instead of a decision. **Dev's branch must run locally** — if a screen needs data that only exists on prod, say so on the PR so QA fixtures it rather than discovering it mid-review | 2026-08-14 | owner, in session |
| **`PAID_GRACE_MS` = 48h is OWNER-APPROVED, not a developer default.** Zero grace makes the dangerous direction reachable through normal operation: a retried or delayed renewal event flips a **paying** customer to free. Wrongly demoting someone who paid is worse than 48 extra hours for someone who has not, and 48h still bounds the unbounded access #373 was about | 2026-08-14 | #373, #408 |
| **"Closes #N" does NOT auto-close in this repo.** PRs merge into `dev`, and GitHub only auto-closes from the default branch. #376 sat open for hours after its fix shipped. **Close issues by hand, on evidence** | 2026-08-14 | #376, #377 |
| **Ask once, then drop it.** A request repeated every message is pressure, and a yes obtained that way is not approval — it happened on 2026-08-12 and cost the owner money. Pending asks live on the relevant issue and are mentioned in chat once | 2026-08-12 | owner, in session |
| **`CI Gate` is NO LONGER a required status check on `main`.** Removed 2026-08-13 with the owner, in the browser, after it deadlocked the release. It required E2E to pass on a GitHub runner, and **`fapi.binance.com` bans the shared egress IPs Render's free plan uses** - so the market-dependent half of the suite could never go green there. NOT "Binance blocks cloud egress": `api.binance.com` (spot) answers 200 from the same hosts, and prod's `starter` plan gets futures fine. Measured on three hosts, 18 requests, #368. A required check that cannot report is not a protection, it is a locked door with no key, and it teaches everyone to override red gates. **Still enforced on `main`:** no deletion, no force-push, PR required | 2026-08-13 | #374, where `gh pr merge --admin` was confirmed NOT to bypass a never-reported required check; the ruleset backup is in the session scratchpad |

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

## Standing risks

- **`reuseExistingServer` will serve you a build from before your `git checkout`,
  silently.** Measured 2026-08-14 while validating `text-under-control.spec.ts`
  against `fd17cbc`. Playwright's local config is `reuseExistingServer: !CI`, so
  a dev server left running from an earlier run is reused — and **a git checkout
  does not restart it**. Three consecutive runs reported a clean PASS on a commit
  that provably had the defect.

  The tell was not the result, which looked ordinary. It was a direct read of the
  bytes:

  ```
  git show fd17cbc:app/globals.css     .gchat-mode-opt::after { ... height: 48px }
  served CSS on :3100                  no ::after rule at all
  ```

  **`/api/version` does NOT rescue you here** — it reports `commit: "unknown"` on
  a local dev server, so the endpoint that solves this for deployed services
  answers nothing locally. Grep the served asset for something the commit
  introduced, or kill the port first:

  ```
  netstat -ano | grep :3100 | grep LISTENING   # then taskkill //F //PID <pid> //T
  ```

  **This is the same failure as verifying against the wrong deployed build**, and
  it is worse locally because nothing in the output names a commit. Any run that
  crosses a checkout boundary is suspect until the server has been restarted.

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
- **A timeout in a sweeping spec is not a finding — count the failures before you
  read them.** Added 2026-08-11. A full suite run against deployed `qa` came back
  **214 passed, 10 failed**, and the ten looked like four separate problem areas:

  ```
  seo/canonical    -> /calc        TimeoutError: page.goto: Timeout 90000ms exceeded
  seo/title        -> /playbook    same
  seo/meta-desc    -> /news        same
  seo/h1           -> /ops/login   same
  a11y/unnamed     -> /research    same
  a11y/html-lang   -> /news        same
  a11y/duplicate-id-> /terms       same
  ```

  **Seven of the ten were one navigation timeout wearing seven names.** A spec
  that walks every route reports one slow response once per assertion, so a single
  environmental hiccup multiplies by however many things that spec checks. Free-plan
  Render, cold containers, forty minutes of continuous load.

  Two failure modes, and the second is the expensive one. **I guessed first** —
  said the four `seo` failures were "almost certainly baselines needing
  re-derivation" because `ROUTES` had lost two entries in #267. Plausible, and
  wrong. Reporting it would have sent someone to re-derive four baselines that
  were fine. **A plausible explanation for a red run is also how a real
  regression gets waved through.**

  Read the error class before the test name. Group by root cause, not by spec
  file, and say how many *distinct* causes there are — "10 failures" and "3
  problems, one of them environmental" are different reports and only the second
  is actionable.

  **The specific trigger, measured 2026-08-13.** Signed-in specs run in parallel
  against a free-plan host produce failures that look exactly like findings:

  ```
  parallel (4 workers)   3 desktop failures, and the PASSING tests took 54-72s each
  serial   (1 worker)    9/9 pass, 10-30s each
  ```

  Every signed-in spec mints a session, boots the app, and waits on a Pro-gated
  card, so four workers means four full app boots at once against a machine that
  sleeps when idle. **Run signed-in specs against `qa` or `staging` with
  `--workers=1`.** The tell that it was environmental: all three desktop failures
  passed on `mobile` in the same run, on identical fixtures. A real defect does
  not pick one project and spare the other when the fixture is the same — so when
  a run is red, check whether the other project agrees before reporting anything.
- **SIX SILENT INSTRUMENT FAILURES vs THIRTY SECONDS OF A HUMAN. When the
  instrument keeps failing quietly, stop building instruments and ask someone to
  look.** Added 2026-08-13, on #306 closing.

  *"App does not resume when the network comes back — arena chart stays frozen."*
  Both sessions tried to verify the fix automatically. Every attempt produced a
  believable result from an instrument that was not doing what it appeared to:

  ```
  dev  1-3  context.setOffline      sockets stayed OPEN - nothing disconnected
  dev  4    routeWebSocket(all)     counted every socket page-wide, null result
  dev  5    route.close(1006)       1006 is RESERVED - the page got no close event
  QA   6    CDP offline             fired 1 run in 4; the one success used a TOTAL
                                    count that could not say WHICH socket returned
  ```

  **None of them threw. None errored.** Playwright neither rejected the reserved
  close code nor delivered it. The instrument's own health was the variable
  nobody was measuring, and each failure looked exactly like data.

  The owner turned airplane mode on and off on a real phone and reported
  *"it auto updates after airplane mode was turned off"*. Done.

  **The rule is not "ask a human first"** — automation is repeatable and a manual
  check is not. It is: **count the attempts.** After two mechanisms have failed
  silently at the same property, the next thing to question is whether the
  property is reachable from a spec at all, not which mechanism to try third.
  Six attempts across two sessions cost most of a day; the answer cost thirty
  seconds and nobody asked for it until then.

  **And say what a manual result does NOT cover.** The owner observed the chart
  RESUMING. Whether the candles that elapsed during the outage are backfilled is
  a different claim - that is #313, still open. A hand check settles exactly what
  was watched and nothing adjacent to it.

- **AN INSTRUMENT WHOSE RESOLUTION EQUALS THE EFFECT CANNOT DISTINGUISH THE
  HYPOTHESES. A working instrument is not automatically a useful one.** Added
  2026-08-13.

  `binance-futures` 418-banned both non-prod services simultaneously, twice.
  Hypothesis: Render free-plan services share an egress IP, so the quota is
  consumed by traffic that is not ours. Confirming it needs the outbound IPs,
  which nothing available exposes.

  So a cheaper discriminator: **if both unban at the same instant, one quota is
  more likely; if they unban minutes apart, separate ones.** Polled both until
  each returned 200:

  ```
  staging UNBANNED at +306s
  qa      UNBANNED at +366s
  gap                  60s        <- and the POLL INTERVAL was 60s
  ```

  **One sample.** A shared IP unbanning both at once and two separate IPs
  unbanning a minute apart produce the *same reading* at that resolution. The
  instrument ran, returned a number, and the number could not tell the
  hypotheses apart.

  This is a different failure from the ones already listed. The instrument was
  not broken, did not silently no-op, and did not measure the wrong thing — it
  measured the right thing too coarsely. **"It returned a plausible number" is
  not evidence it could have returned a different one.**

  Two practical forms:

  **Before running a discriminator, ask what reading each hypothesis predicts.**
  If they predict the same output at your resolution, the run is decided before
  it starts. That check costs seconds and would have saved this one.

  **The measurement window opens at the INCIDENT, not when someone gets round to
  it.** The 60s interval was chosen to be gentle on an already-banned service;
  5s would have been trivial load and resolved it. Starting during the
  investigation rather than at first notice is what made the coarse interval
  feel necessary.

- **SELF-BLAME IS STILL AN UNMEASURED ATTRIBUTION. It feels like caution; it is
  a claim.** Added 2026-08-13, after it nearly buried a real bug.

  Binance started returning **418 - the ban code** - on the futures route, on
  both non-prod environments. I reported it immediately and said the cause was
  probably my own test traffic: two multi-hour suites and a lot of direct
  requests to that endpoint the same evening.

  **Plausible, self-critical, and wrong.** Dev measured instead of accepting it:

  ```
                      TTL after #352      ttlFor before #352
  4h  mid-candle          7203 s               900 s
  4h  1s before close         4 s               900 s    <- 225x more upstream calls
  ```

  `msUntilNextClose + CLOSE_SKEW_MS` collapses to the skew just before any
  close, on every interval - and #316 had synchronised every client onto exactly
  that instant. The ban was a real defect in a change deployed an hour earlier.

  **Had dev accepted my account, the bug would have run overnight against
  Binance and we would have "fixed" it by me testing less.**

  The reason it is worth its own entry: it does not feel like the confound
  error, and it is the same error. Taking the blame reads as rigour, so nobody
  challenges it - including me. **"It was probably me" is a causal claim and
  needs the same evidence as "it was probably your change."**

  Practical form: when something breaks near your own activity, say **what you
  did** and **what you have not ruled out**, and let the other session measure.
  Do not hand them a conclusion wearing an apology.

- **A REQUIRED CHECK FROM A DISABLED WORKFLOW IS A DEADLOCK, AND IT LOOKS LIKE A
  POLICY.** Added 2026-08-13.

  `main` required `CI Gate`. `CI Gate` comes from `ci.yml`. `ci.yml` was
  `disabled_manually` for cost control. **So no release could ever merge**, and
  the failure mode was silent - the merge button is simply greyed out with
  "Required" beside a check that never ran.

  ```
  gh pr merge --admin           "Required status check CI Gate is expected"
  GitHub UI                     merge button DISABLED, no override offered
  ```

  Neither an admin merge nor the UI offers a way past a required check that has
  never reported. **The only exits are to run the workflow or to drop the
  requirement.**

  Two lessons, and the second is the general one:

  **A cost decision can have a consequence nobody chose.** Disabling CI to stop
  Actions charges also sealed the door to production - and separately stopped
  the production drift check, which shared a file with the release PR workflow.
  **Ask what else lives in the thing you are switching off.**

  **When the gate cannot pass for environmental reasons, fix the gate, not the
  release.** Overriding once teaches everyone that red gates are advisory. The
  suite was fixed first (#375, #378, #380 - skip when the upstream refuses the
  deployment), and the requirement was removed second, deliberately, with the
  owner present.

- **CONTROLS THAT DO NOT ADDRESS THE CONFOUND ARE WORSE THAN NO CONTROLS. They
  buy confidence without buying correctness.** Added 2026-08-13, after the most
  expensive false finding of the week.

  Reported to dev: *"the Confluence Score already moves with the perps reading,
  on a build where you have not wired it yet."* Held their PR. It was wrong, and
  **three controls had passed before I said it**:

  ```
  the market is not moving        third load repeated the first exactly
  no other consumer of the feed   measured: 2 requests, both the perps card's
  not a fixture side-effect       re-ran with two VALID payloads, not valid-vs-404
  ```

  Every one of those was a real control, correctly run, and **none of them
  addressed the actual confound.** The Confluence card's factors arrive
  asynchronously and the score reflects however many have landed:

  ```
  futures-led   score -53   EMA Ribbon  -        Choppiness clear
  spot-led      score -58   EMA Ribbon  ▼ 30     Choppiness −15 confidence
  ```

  EMA ribbon, choppiness and RSI divergence differed between the loads. None of
  them is perps. The score difference was theirs.

  **The stability control was a single repeated load.** One repeat is not a
  stability check — it is one sample, and two samples matching is not unlikely.
  It was the weakest link and it was the one carrying the whole finding.

  Two things worth keeping:

  **Count what your controls actually rule out, not how many there are.** Three
  passing controls felt like strong evidence. The right question was never "how
  many did I run" but "which alternative explanation does each one eliminate" —
  and written out, all three eliminated the same *kind* of alternative and left
  the real one untouched.

  **Watch the whole artefact, not the number you care about.** The bug was
  invisible while reading only the score badge and obvious the moment the full
  card text was captured. A stable NUMBER is not a LOADED CARD, and reading one
  field of a partially-populated view is the same class of error as reading a
  placeholder — which happened twice more the same afternoon.

  The retraction took an hour and cost dev ninety minutes. Both were cheaper
  than the alternative, which was a weighting the owner approved being silently
  wrong because an accidental coupling got absorbed into it.
- **AUTOMATION THAT IS OFF LOOKS EXACTLY LIKE AUTOMATION THAT IS WORKING. Check
  the switch, not the absence of failures.** Added 2026-08-13.

  All four workflows are disabled, and two independent brakes stop the release
  PR specifically:

  ```
  ci.yml               disabled_manually
  ready-for-qa.yml     disabled_manually
  release-signals.yml  disabled_manually
  RELEASE_PR_PAUSED  = 1                    repo variable
  ```

  Both dev and QA spent 2026-08-13 referring to the "Ready for QA" issue and the
  self-opening release PR as though they existed. **Neither has opened since the
  workflows were switched off.** Every promotion announcement that day was made
  by hand, and it worked only because someone happened to do it.

  The general shape is the expensive part. A **failing** workflow produces a red
  tick, an email, a run record. A **disabled** one produces nothing at all —
  which is indistinguishable from a workflow that passed. So "no failures" is
  not evidence of health, and the docs describing what the automation does keep
  reading as true long after it stopped running.

  This is the same error as `#285`, where a disabled workflow was diagnosed as
  spent Actions quota and sent the owner to check their billing — the missing
  signal got an explanation instead of a measurement.

  **When something is supposed to happen automatically and you have not SEEN it
  happen, check whether the automation is enabled before believing anything
  built on top of it.** `gh workflow list --all` answers it in one call.

  Consequence worth stating plainly, because it is not a fault: **the
  `staging` → `main` release PR must be opened by hand.** It is not delayed, it
  is impossible in this configuration. `staging` sitting hundreds of commits
  ahead of `main` is the intended state — the owner decides when to ship, and
  nothing opens on their behalf.

  **The second consequence WAS NOT CHOSEN, and it is the one worth knowing.**
  `release-signals.yml` holds two unrelated jobs: the release PR, and the
  **production drift check** — daily cron, reads `/api/version` on
  liquidity-hq.com, opens a `release-drift` issue when production is not serving
  `main` or the deployed commit is untagged. It caught a real one on 2026-08-09
  (#159, *"Production is not running `main`"*).

  Disabling the workflow to stop the release PR **also turned off drift
  monitoring.** Two functions, one switch, and only one of them was the
  decision. Low impact today — nothing is being deployed to production and there
  are no users — but the file `CLAUDE.md` points at as the answer to *"what is
  in production?"* is not running, so that question now has no automated answer.

  How this was nearly reported wrong: `git show origin/dev:.github/workflows/release-signals.yml | grep -c drift`
  returned **0**, and the same command printed no content at all. The file is
  16KB with ten `drift` references. **The grep did not measure the file, it
  measured an empty stream** — and taken at face value it would have become
  "the drift check does not exist". A command that returns nothing has not told
  you the thing is absent; check that it read anything at all first.
- **A COMMENT DESCRIBING AN INVARIANT IS THE THING THAT GOES STALE. The durable
  version is a check, not a note.** Three separate times on 2026-08-12, and each
  one was CORRECT WHEN WRITTEN:

  ```
  entitlements.spec.ts header  "pro -> 503 VAPID not configured ... no real push
                               is sent. If the 503 ever becomes a 200, someone has
                               put credentials in CI. Worth noticing."
                               -> it became true on qa. Nothing noticed, because
                                  the assertion was not.toBe(403) and 200 passes
                                  it identically. The sweep was posting a real
                                  message into dev's Telegram on every run.

  INFRASTRUCTURE.md            recorded CRON_SECRET as unset on qa. It was wrongly
                               SET for three days in August. The doc's own row
                               records the correction - after the fact.

  lib/labelDefaults.en.json    every string in it describes what users read, and
                               none of them do - LabelsProvider overwrites them
                               from lhq_labels after mount. Structural rather than
                               a one-off: the whole file is a first-paint seed
                               permanently describing a state that lasts
                               milliseconds. It cost real time on #274 and #277.
  ```

  Nothing edited any of them. **The world moved and the prose did not.** A note
  describes the state at the moment someone typed it; a check describes the state
  at the moment it runs.

  The general fix is #283's shape: **ask the host, do not encode a belief about
  it.** `entitlements.spec.ts` now reads `configured.telegram` before calling a
  delivery route, and defaults to NOT calling when the answer is unknown - a build
  that cannot answer gets the safe branch rather than the historical assumption.

  Applies to this file too. Everything here is prose, so anything expensive enough
  to be wrong about belongs in an assertion instead - and the entries that survived
  are the ones nothing could check.

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
