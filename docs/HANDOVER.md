# LiquidityHQ — Handover & Onboarding

**Written 2026-08-01.** Single entry point for picking this project up cold — written for
a fresh Claude Code terminal session with no prior conversation context.

Read this first, then `CLAUDE.md` → `AGENTS.md` → whichever doc in the map below covers
what you're touching. **New to the two-session dev/QA arrangement? §15 is the one to read** —
the rules are in `CONTRIBUTING.md`, but §15 is how the two sessions actually reach a correct
answer, and §14 is the failure mode they spend most of their time avoiding. If this file and the code disagree, **the code wins — then fix this
file.**

---

> ### ⚠️ This file records STATE, and state goes stale. Reviewed 2026-08-27.
>
> Sections **§7 (Current progress)**, **§8 (Testing status)** and **§9 (Current issues)**
> are dated **2026-08-01** and describe a project that has moved a long way since. They
> are kept for the reasoning and the war stories, which are still true and still worth
> reading. **Do not quote their status claims.**
>
> `qa/STATUS.md` learned this lesson the hard way — it went stale twice, the second time
> in four hours, and now records only *decisions* and *risks* because those are the parts
> that survive. This banner exists so the same trap does not catch someone here.
>
> **For anything current, use the sources that cannot be stale:**
>
> | Question | Where |
> |---|---|
> | What is decided, what is risky | `qa/STATUS.md` |
> | What a green suite does **not** mean | `qa/TEST_GAPS.md` |
> | What is open | `gh issue list --state open` |
> | Where each branch is | `git fetch --all && git rev-parse --short origin/{dev,qa,staging,main}` |
> | What production is **serving** | `curl -s https://liquidity-hq.com/api/version` |
>
> **One correction that matters more than the rest**, because §8 is titled "TESTING
> STATUS" and someone will read it as "CI covers this": since the release PR was paused,
> **the browser suite stopped running in CI entirely** — 60 consecutive runs with no
> completed E2E job. `perf`, `a11y`, `a11y-auth`, `bola`, `contrast`, `i18n`, `layout`,
> `clock`, `payments-webhook` and `checkout` were covered **nowhere**. Fixed by #210,
> which runs the suite on every push to `staging`; tracked on **#207** until a promotion
> has been observed to actually fire one. `TEST_GAPS.md` §11 has the detail.
>
> ### CI IS OFF ON PURPOSE. Updated 2026-08-12.
>
> All three workflows are `disabled_manually` and `RELEASE_PR_PAUSED = 1`. The repo is
> private, so **every Actions minute is billed to the owner personally**, and they said so
> directly. **Do not enable a workflow, do not dispatch a run, and do not file the
> disabled state as an outage** — that was filed once (#285) on a wrong guess about
> billing quota and closed as not-a-defect. #210 above is therefore describing a
> capability that exists but is currently switched off.
>
> This is not a coverage hole. Everything runs locally, for free, on the QA machine:
> lint, `tsc`, unit tests via the pre-push hook, and the full Playwright suite pointed at
> a **deployed** host with `E2E_BASE_URL`. A run against a real deployed service is
> stronger evidence than CI's own ephemeral build. Prefer one targeted spec over a sweep —
> a long run also wakes the free-plan Render services.
>
> ### THERE ARE NO REAL USERS YET, and `staging` is the destination
>
> Production is live and nobody depends on it. Bugs on prod are worth fixing and are **not
> emergencies**; do not argue priority from user harm. Verified work **parks on `staging`
> and stays there** — the owner opens the gates when changes have piled up, on their
> schedule, not on anyone's sense of urgency.
>
> Consequently an issue **closes on `qa` + `staging` evidence**; production is not
> required. Say in the close comment that it is parked on staging and not yet live, so
> nobody reads it as shipped.

---

## 1. What the product is

**LiquidityHQ** (https://liquidity-hq.com) — a crypto trading intelligence PWA.
Next.js 16 App Router on Render, Supabase (Postgres + Auth), xAI Grok for AI analysis,
Lemon Squeezy for billing (not live yet), Capacitor Android shell.

**Hard product boundary:** it is a data and analytics tool only. It never executes trades
and never holds exchange credentials. Do not add anything that does.

Core surfaces: AI Arena (EMA ribbon signal engine + confluence scoring), backtest engine,
scanners, 11 Grok-powered research tools, Telegram + Web Push alerts, news/sentiment,
calculators, trade journal, and an internal-only `/ops` admin console.

> **`/backtest` and `/live-tracking` are HIDDEN as of 2026-08-11** (#264, shipped in
> #265). `proxy.ts` redirects both to `/dashboard`, and their nav entries are gone.
> The pages are hidden, **not deleted** — everything under `app/backtest/` and
> `app/live-tracking/` still exists and still builds, so the backtest engine above is
> live code, not dead code, and `lib/backtestEngine.ts` is still what the Arena chart
> and the signal tracker share their fill rules with. Reversing this is deleting two
> strings from `BLOCKED` in `proxy.ts` — but the route list in `qa/e2e/_shared.ts` and
> `HIDDEN_ROUTES` have to move with it in both directions, or the sweeping specs
> silently measure `/dashboard` twice instead of failing.

**Business state:** pre-revenue. Two test accounts, no real users, payments not switched
on in production — a **test-mode** checkout is live on staging as of 2026-08-11 (see
"Turning on payments" below).

---

## 2. Where everything lives

| Thing | Value |
|---|---|
| Repo | `github.com/JohnDominicJasmin/liquidity-hq` |
| Local checkout | `C:\Users\Dominic\Documents\VS code\liquidity-hunter-hq\liquidity-hq` |
| Prod site | https://liquidity-hq.com (also `liquidity-hq.onrender.com`) |
| Dev site | https://liquidity-hq-dev.onrender.com |
| **QA / staging site** | **https://liquidity-hq-qa.onrender.com** — branch `qa`, deploy manually |
| Render prod service | `srv-d8aluf6l51nc73e1ijp0` — branch `main` |
| Render dev service | `srv-d8prs6po3t8c739aepdg` — branch `dev` |
| Render **qa** service | `srv-d9p42ke1egvs73f8car0` — branch `qa`, free plan, auto-deploy OFF |
| Supabase **prod** | project `liquidity-hq-prod`, ref `qdpwhnvmhqgzijuwopso` — tables `lhq_*` |
| Supabase **dev** | project `liquidity-hq-dev`, ref `wdtjhrilakoitfcezxpx` — tables `lhq_dev_*` |
| Supabase **qa** | none of its own — the qa service shares the **dev** project. Free plan caps the account at 2 active projects |
| Error tracking | GlitchTip — `app.glitchtip.com/liquidityhq/issues`, project id `25983` |
| Analytics / replay | PostHog |
| Email | Brevo (SMTP relay + transactional API) |
| External cron | cron-job.org + n8n (**outside this repo** — invisible to code search) |

**Two separate Supabase projects, not one.** This has been gotten backwards twice in past
audits. `.env.local` points at the **dev** project (`liquidity-hq-dev`). A "table not found
in schema cache" error locally is almost always this mistake, not cache lag.

Note the name collision: the Supabase projects and the Render services share the names
`liquidity-hq-prod` / `liquidity-hq-dev`. Always say which system you mean. Identify
Supabase by **ref** (`qdpwhnvmhqgzijuwopso` = prod, `wdtjhrilakoitfcezxpx` = dev) — refs are
unambiguous, names are not. Older docs call these projects `LiquidityHq` and `Automations`;
those names are dead, the refs behind them were always correct.

---

## 3. Stack & tooling

**Runtime:** Next.js `16.2.6`, React `19.2.4`, TypeScript, Node 24.

⚠️ **Next.js 16 is not the Next.js in your training data.** `AGENTS.md` is explicit about
this: read the relevant guide in `node_modules/next/dist/docs/` before writing code. That
directory genuinely exists and is populated — it is not a dead reference.

**npm scripts** (that's all of them):

```bash
npm run dev              # next dev
npm run build            # next build
npm start                # next start
npm run lint             # eslint . - 0 errors, ~93 warnings (documented backlog)
npm test                 # node --test __tests__/*.test.mts - 44 assertions
npm run test:e2e         # playwright test - builds + boots the app on port 3100 itself
npm run test:e2e:ui      # same, in Playwright's UI mode
npm run test:e2e:report  # open the HTML report from the last e2e run
npm run labels:regen     # refresh lib/labelDefaults.en.json from a running dev server
```

**MCP servers wired up and used regularly:**
- **Supabase MCP** — `execute_sql`, `apply_migration`, `list_tables`, `get_advisors`,
  `get_logs`. This is how migrations get applied to both projects.
- **Render MCP** — `list_services`, `list_deploys`, `trigger_deploy`, `get_metrics`,
  `list_logs`, `update_environment_variables`. This is how deploys are triggered and
  verified.

**Browser tooling:** use the **Claude Code internal browser** (`mcp__Claude_Browser__*`)
for all live verification. Do **not** drive the owner's real Chrome/Brave — it holds their
live logged-in session, and it has been crashing.

**Plugins/skills present** in `.claude/skills` (design, frontend, security, testing
helpers) and a `caveman` output-style plugin. Skills are directory-scoped to the project.

**Testing & CI** — corrected 2026-08-05. This section previously read *"No CI. No test
runner. No `.github/workflows`, no Jest/Vitest/Playwright."* All three of those now exist;
the claim was already stale when written up as audit §7.2.

| Layer | What | Where |
|---|---|---|
| CI | GitHub Actions. Job `build` (lint → typecheck → test → build, ~2 min) on every push and PR. Job `e2e` (Playwright, ~34 min) **only on a PR into `main`** — see `CONTRIBUTING.md` §4b. Job `CI Gate` is the one required status check | `.github/workflows/ci.yml` |
| Unit | `node --test`, 6 files, 75 assertions | `__tests__/*.test.mts` |
| E2E | Playwright, 187 passing + 47 skipped × desktop 1440×900 + iPhone 13, against a **production** build on port 3100 | `qa/e2e/*.spec.ts`, `playwright.config.ts` |
| Lint | ESLint via CLI — `next lint` no longer exists in Next 16, and `next build` stopped linting | `eslint.config.mjs` |

Two things about the E2E suite that will bite otherwise:

- **It needs `.env.local`.** `NEXT_PUBLIC_*` is inlined at build time and the config builds
  the app itself, so without `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` the login specs fail
  and `/api/ops/*` returns 500 instead of 401 — which reads as a security regression and
  is not.
- **Baselines only ratchet down.** `qa/e2e/_shared.ts` holds known-failing counts so CI is
  green on today's code while still blocking regressions. Never raise one to make a build
  pass.

Manual verification is still rigor-tiered per `qa/QA_TEST_PLAN.md` (**moved from `docs/`
on 2026-08-04** — §4's table below still points at the old path).

Current state: `pendings/QA_AUDIT_2026-08-04.md` (the sweep) and
`pendings/QA_E2E_FINDINGS_2026-08-05.md` (first execution of the suite, and **two
corrections to that audit** — its CLS and tap-target numbers are both wrong).

---

## 4. Repo layout & which doc is authoritative

```
app/          Next.js App Router — routes, API routes, globals.css
components/   React components (AppShell, AuthProvider, MarketProvider, TrialBanner, ...)
lib/          Business logic — strategyCore, limits, tables, labels, email, apiHealth, ...
supabase/     migrations/ (135 files) + schema.sql (LEGACY, dead)
scripts/      gen-brand-icons.mjs, regen-label-defaults.mjs
docs/         Reference documentation (this file lives here)
pendings/     Active work tracking — the living TODO
android/      Capacitor Android shell
```

**Doc authority order** — later corrections beat earlier files:

| File | Covers | Trust level |
|---|---|---|
| `pendings/PENDING.md` | **Living TODO + shipped log.** Start here for "what now". | Current |
| `pendings/LEMONSQUEEZY.md` | Payment feature, owner's 4 remaining steps | Current |
| `pendings/OPS_ROADMAP.md` | `/ops` admin console status + backlog | Current |
| `pendings/I18N_MIGRATION.md` | i18n process log + lessons | Current |
| `docs/INFRASTRUCTURE.md` | Services, crons, keys, the 2-project split | **Most current on infra** |
| `docs/PRICING_AND_LIMITS.md` | Tier mechanics, caps, invariants | **Most current on pricing** |
| `docs/ARCHITECTURE.md` | System overview, signal engine, entitlements | Dated Jul 16 — **partly stale** |
| `docs/DESIGN_SYSTEM.md` | "Indigo Depth" tokens, typography, components | Current |
| `docs/feature-inventory.md` | Exhaustive feature list + cost classification | Current |
| `docs/QA_TEST_PLAN.md` | Manual test approach | Current, unexecuted |

---

## 5. Conventions that bite if ignored

- **Never hardcode a table name — always import `T`** from `lib/tables.ts`. This is the
  only thing keeping dev and prod data apart.
- **Role string is `'pro'`.** Not `'premium'`, not `'paid'`. "Premium" is marketing copy.
- **Limits use `getUsageTier()`, never `getUserRole()`.** Passing a role bills a trial user
  against the free row.
- **Every Pro feature is enforced server-side.** A client-side hide is not a paywall.
  Server: gate with `getUserRole` (fail closed). UI: gate with `isPro` after `authLoading`
  resolves, show `LockedFeatureCard` / `UpgradeGateModal` — don't silently hide.
- **Signal math lives in `strategyCore.ts` only.** Fork it into a component and live vs.
  backtest results silently diverge.
- **New third-party fetch in an API route?** Wrap in `cached()` unless genuinely per-user.
- **Design system:** Figtree for UI text, IBM Plex Mono for *all* numerics. Never Inter,
  never emoji as icons. Chips use `withAlpha(color, '14')`, never `color + '44'` string
  concatenation (breaks silently when `color` is a `var()`).
- **i18n:** never glue sentence fragments with `", "` — that's an English assumption that
  breaks ko/zh/ar/ru. Separate label keys, interpolate numbers with `{n}`.
- **Fail-open vs fail-closed is a deliberate per-system choice.** `grok`/`telegram`/
  `signups` fail open; `structure_alerts` and `cronAuth` fail closed; `/api/config` fails
  open to a safe default. Each has an inline comment explaining why. Don't "normalize" them.
- **Cron-only-looking routes are not dead.** Before assuming a `CRON_SECRET`-gated route
  with no in-app caller is unscheduled, read `docs/INFRASTRUCTURE.md` — the scheduler lives
  outside this repo.

---

## 6. Git & deploy workflow

- **All commits land on `dev`.** `main` is release-only.
- Ship by merging `dev` → `main`, pushing, then **manually triggering** the prod Render
  deploy (`trigger_deploy` via Render MCP, or the dashboard button).
- **Both Render services are `autoDeploy: "no"`.** Verified directly against the Render
  API, not just docs. Pushing does *not* deploy. This trips people up constantly.
- `NEXT_PUBLIC_*` env vars are inlined at build time — setting one without rebuilding
  does nothing.
- Commits/pushes to `dev` are always fine without asking. **Triggering a `liquidity-hq-dev`
  Render deploy needs explicit go-ahead** — that service has a ~500 hr/mo build cap prod
  doesn't. Default to local testing instead (`npx tsc --noEmit` + `npm run build` +
  `localhost:3000`, which has the service-role key so `/ops` routes work locally).
- Commit style: imperative sentence-case subject describing the *behaviour change*, then a
  body explaining the real cause and why the fix is shaped that way. Look at recent commits
  before writing one. Trailer: `Co-Authored-By: Claude <model> <noreply@anthropic.com>`.

### Branch & deploy state as of 2026-09-05

| Branch | Commit | Note |
|---|---|---|
| `origin/dev` | `24aa188a` | PR #847 merged — the app nav no longer covers marketing pages (#845) |
| `origin/qa` | `24aa188a` | promoted by dev; **deploy is QA's** — dev is under a standing owner hold on every environment since 2026-09-03 |
| `origin/staging` | `9cefa0bb` | behind `qa` by the #845 fix |
| `origin/main` | `1ee554ee` | production. Release **held by the owner** on #836, #843 and #846 |

**The release is held and the fix-forward ruling was reversed.** On 2026-09-05 the owner was told #843, #846 and #836 would ship as known defects and answered *"THEN VERIFY IT"*. Nothing ships until all three are fixed and QA has verified them on qa. Do not re-park them.

**CI has been off since 2026-08-13.** Zero workflow runs of any kind between `2026-08-13` and `2026-09-05` — 23 days covering the whole terminal redesign. It is switched on by hand for one run against a release candidate and off again, which is the documented practice, and the consequence is that `release-signals.yml` does not fire on a push to `staging`, so **the release PR has to be opened manually.**

**The one E2E run in that window is void.** Run `33932048082` reported 88 failed / 483 passed and it means nothing: the dev Supabase project was unreachable for the entire 66 minutes — **3,308 Cloudflare `522`s**, first at `00:13:25Z` and last at `01:15:34Z`. `/api/labels` returned a Cloudflare error page throughout, which is the exact condition `ci.yml` names as a known defect generator, so every control label on every page came from fallbacks. Read no failure from that run as a product defect without re-running. Detail on #841.

#### Superseded: branch state as of 2026-09-03

| Branch | Commit | Note |
|---|---|---|
| `origin/dev` | `06c647e` | PR #720 merged — the canvas-mirror revert (#718) |
| `origin/qa` | `06c647e` | promoted and **deployed** — `/api/version` confirmed `06c647e` |
| `origin/staging` | `06c647e` | promoted and **deployed** — `/api/version` confirmed `06c647e` |
| `origin/main` | `1ee554e` | production — **91 commits behind `staging`** (54 excluding merges), no release PR open. Shipping is the owner's call and they have not given it. |

**`main` is not an ancestor of `staging`, and that is topology rather than risk — check this before a release rather than re-deriving it.** Seven commits sit on `main` and not on `staging`, so `staging` → `main` cannot fast-forward and needs a merge commit. All seven are release merge commits from previous ships: `git diff origin/staging...origin/main` is **empty**, meaning `main`'s tree is identical to the merge-base (`bb24e374`). So `main` carries no unique content, and shipping `staging` reverts nothing that is live.

Stated explicitly because "not an ancestor" is normally the shape of an unmerged hotfix — the case CLAUDE.md warns about, where a fix went straight to prod and the next release quietly undoes it. Here it is not that, and confirming it takes one command:

```
git diff --stat origin/staging...origin/main     # empty  -> main adds nothing
git rev-list --count origin/main..origin/staging # 91     -> the release size
```

**READ THIS BEFORE ANY DESIGN WORK — the redesign direction reversed on 2026-09-03.**

The owner stopped the canvas-mirror initiative. Their words: *"we are repackaging the platform without users feedback... we are wasting time, money, and resources, and also tokens."* Two decisions came out of it, and both are now the standing rule:

1. **Terminal styling goes over the existing production layout.** Same button positions, same text positions, same structure. Do **not** restructure a screen to match a `design-handoff-dir/design_files/*.dc.html` canvas. The `#413` batch — closed by `895f116` — is the reference state for what "right" looks like; `/scanner`, `/hours`, `/funding` and `/journal` are still in it.
2. **Terminal ships on the landing page only** (#719, not yet built). `/` renders terminal by default; every app screen stays on the current design. Until this ships, `lib/designMode.ts` defaults everyone to `current` and **no user has ever seen any of the terminal work.**

The sorting rule that follows from #2, and it governs triage: **after #719, a terminal-mode defect on any route except `/` is invisible to users and does not earn dev time.** A defect on the current design, or on landing, is real. #707, #698 and #663 were parked under exactly this rule with their measurements intact; #656 and #652 were closed as superseded; #620, #622 and #712 are parked.

> ## ⚠️ THAT SORTING RULE IS DEAD. It reversed on 2026-09-04 and it is now exactly backwards.
>
> `7435d87c feat(dashboard): terminal is the default design on every route` (#748/#768) removed the "only `/`" half. **Terminal is what every visitor gets on every route**, and `?design=current` is the rollback rather than the default.
>
> So the sentence above now reads as "the defect every user sees does not earn dev time". Anything parked under it needs re-triage, not inheritance — and the paragraph is left in place rather than deleted because several closed issues cite it as their reason.
>
> This is not theoretical. #836, #843 and #846 are all terminal-mode defects on routes other than `/`; the old rule would park all three; the owner has **held the release** for exactly those three. If you are about to park a terminal defect because of the paragraph above, stop.
>
> One rule from #2 that did NOT change: terminal styling still goes **over the existing production layout**. Do not restructure a screen to match a canvas. #843 is what happens when that line is crossed and then reverted — see §14.

**The one exception is landing.** The owner likes the canvas-mirrored landing (`ad6b08c`, #592) and it was deliberately excluded from the revert. Never revert it, and treat "landing renders identically" as a hard gate on any work touching `app/globals.css`, `lib/labelKeys.ts`, `lib/labelDefaults.en.json` or `components/AppShell.tsx` — all four are shared between landing and the reverted screens, and `AppShell.tsx` is the one that bit us (it rendered `PriceTickerStrip` on `/` gated on design mode rather than pathname).

**Known and deliberately not filed**, so nobody re-derives them: `/dashboard` shows 10 terminal radius violations, all `MarketRead` (`.mr`, `.mr-factor`, `.mr-track`, unscoped in `app/globals.css` around lines 776-812, outside `.dashboard-term-wrap` so the blanket radius rule misses them). That is `#413`-era, restored correctly by the revert, and invisible after #719. Landing also fails 3 of 21 `specs/landing.md` criteria (C10 hero-glow, C11 nav 44 vs 56, C18 mobile nav 38 vs 52) — pre-existing, and the owner has stopped aligning to the handoff specs.

**Superseded history below.** The 2026-09-02 entry that follows described the redesign as "back and active" and drove the canvas-mirror work. It is kept because the token-governance work in it is still live and correct — only the direction changed.

#### Superseded: branch state as of 2026-09-02

| Branch | Commit | Note |
|---|---|---|
| `origin/dev` | `7f0178d` | PR #563 merged — #561 terminal light theme + platform-wide `.consent-accept` contrast fix |
| `origin/qa` | `7f0178d` | same as dev — promoted and deployed (`liquidity-hq-qa` service, commit confirmed live via `/api/version`) |
| `origin/staging` | `507c080` | not yet re-promoted with the terminal work below — check `/api/version` on `liquidity-hq-staging` before assuming |
| `origin/main` | `b9795ee` | production — not yet touched by the terminal redesign batch |

**(SUPERSEDED 2026-09-03 — see the reversal above. Token-governance content still accurate.)** Monochrome Terminal redesign (#413) is back and active, unlike the 2026-08-27 revert noted below. Session 2026-09-01/02 shipped, in order: #558 (Dashboard C8 radius), #560 (platform conformance batch — terminal token governance for `--accent-solid`/`--accent-dim`/`--blue` family/`--bg3`/`--bg4`/`--on-accent`, `/funding`+`/correlation` light-theme contrast, a platform-wide radius carve-out for circular markers, footer link touch targets), #562 (QA's `qa/contrast-diff.mjs` + `qa/platform-audit.mjs` tooling), #563 (the terminal design now has an actual `[data-design="terminal"][data-theme="light"]` token block — it didn't before, terminal+light silently fell back to the current design and QA's #559 audit's light-theme rows were measuring two unrelated systems against each other; see issue #561). A new conformance test direction was added in `__tests__/terminalTokens.test.mts` (2026-09-01): asserts every `var()` a terminal-scoped selector references is actually declared in the terminal token block, not just that the block declares nothing undocumented — the asymmetry that let five different tokens (`--amber`, `--accent-2`, `--accent-bg`/`--accent-bdr`, `--fr-slight-long`, `--on-accent`) fall through ungoverned over the course of the session before being caught by manual sweep or QA's audit.

**What changed since 2026-08-01 (older entries, still accurate):**
- #481: Monochrome Terminal redesign reverted from qa/staging. Preserved on `feature/monochrome-terminal`. `CONVERTED_ROUTES = []` — palette specs paused.
- #484: `qa/e2e/contrast.spec.ts` light-theme `byColour` map restored to carry `where`/`what` context (PR #424 was caught in the #481 revert by mistake). Also restored `design-handoff-dir/**` to eslint `globalIgnores` — it had been removed from `dev` by the revert.
- #368: Closed as known limitation. Non-prod Render services (dev/qa/staging) are on the free plan and share egress IPs — Binance returns 418 from those IPs. Prod is on `starter` plan, unaffected. No real users on qa/staging.
- `lib/paidPeriod.ts` + `lib/entitlements.ts`: Time-based backstop for lapsed paid subscriptions (#373) implemented — `paidPeriodLapsed()` demotes role on every entitlement check if `current_period_end` + 48h grace has passed. 48h threshold is a placeholder; owner confirmation outstanding (#373).
- `/disclaimer` page title: `fontSize: '2.625rem'` (42px at 16px base) — hardcoded inline style, not a design token (#445).

**Services vs branches (autoDeploy: "no" on all).** A merged branch says nothing about what the service serves. Verify with `/api/version` on each host before assuming a fix is live. Dev deploys non-prod services; check before triggering — 500 build-hr/mo cap on the dev service.

---

## 7. Current progress — what shipped 2026-08-01

> **STALE as of 2026-08-12.** This section, §9 and §10 describe 2026-08-01 and have not been
> rewritten. Do not read them as current; `qa/STATUS.md` and the open GitHub issues are
> authoritative for what is happening now. Left in place rather than deleted because the
> *reasoning* recorded here is still useful — but a stale section presented as current is
> worse than no section, which is the lesson §14 ends on.

Seven commits. Six are one continuous audit arc that started from the owner testing a real
signup on prod and saying "UI sucks", then ran through to a mobile pass. **All six are
merged to `main` and live on prod** (verified against Render, not assumed).

| Commit | What |
|---|---|
| `0174e56` | Trial-ending email no longer links to a checkout that doesn't exist |
| `5a49b14` | Sign-up password check fixed (client said 8 chars, Supabase enforces 12 + case + digit) + reveal toggle |
| `d154ac7` | Auth screens get their own shell — `/login` was rendering the entire logged-in app around it (35 interactive elements → 6). Plus 3 measured dark-mode contrast bugs |
| `c4e6044` | Tour step-dot easing retimed to land with the rest of the step; trial banner made readable |
| `0e1ea60` | Real `<label for>` on all six password inputs + both email fields |
| `0bf7305` | **Mobile pass** — Turnstile's fixed 300px iframe overflowed the card at 375px; password checklist grid wrapped; "Keep Pro" pill was a 29px touch target |
| `064ec5a` | Docs: logged the above in `PENDING.md`, added CI/CD backlog entry, fixed stale doc references (`dev` only, not merged) |

Full write-ups with root causes are in `pendings/PENDING.md` under
"Auth screen + mobile audit".

### Also done today, outside git

- **Supabase prod Auth SMTP sender changed** from `liquidityhq.noreply@gmail.com` →
  `noreply@liquidity-hq.com`. Save confirmed by the dashboard's own success toast.
  ⚠️ **Not yet verified by a real signup — see §9.**
- Removed a stale git worktree (`.claude/worktrees/recursing-ritchie-833a7a`) and its
  branch. Nothing lost; its tip commit is in `main`'s history.

### Provenance / prior conversation

Most of the above was done in a GUI session that **died mid-mobile-audit**:
https://claude.ai/code/session_01D9Dts1MMbMWykc1TJwmUEt

That session's worker process is gone (no crash dump; the desktop app was restarted). It
is frozen showing "1 running task" and cannot be resumed — but **the work it was doing
completed and shipped**, so nothing is outstanding from it. Don't try to revive it. This
handover exists partly to replace it.

---

## 8. TESTING STATUS — where we actually are

**This is the active phase.** Code is shipped; verification is partial. Be strict about the
difference between "the deploy succeeded" and "the change works" — a live deploy only
proves the build compiled.

### ✅ Verified on live prod

| Claim | How it was verified | Result |
|---|---|---|
| Trial banner "Keep Pro" pill meets 44px touch floor | `getBoundingClientRect()` + computed styles on the live page | `height: 44.0px`, `min-height: 44px`, `border-radius: 999px` — **holds** |
| Trial banner is readable body text, not a 7px strip | Same | `font-size: 14px`, `padding: 13px 18px`, `2px` bottom accent rule — **holds** |
| All 6 auth commits are on prod | `git log origin/main` + Render deploy status | `ab9dd58`, deploy `live` — **holds** |
| Whole signup chain works end to end | Prior session, against Supabase directly | auth row → confirm (73s) → trial granted (14d) → welcome email (2s). **Held at the time.** |

### ❌ NOT verified — this is the work queue

| # | What needs testing | Why it matters | How to test |
|---|---|---|---|
| **T1** | **Auth emails still deliver after the SMTP sender change** | **Highest risk item on this list.** If `noreply@liquidity-hq.com` isn't a verified sender on the Brevo account, signup confirmation emails start failing *silently* — new users would never get confirmation links. The domain is believed verified (transactional + health-alert emails already send from it and reached Gmail's inbox first try), but the Auth SMTP path was **never** tested with it. | Run a real signup with a fresh inbox on prod. Confirm the email arrives, lands in inbox not spam, and the `From:` shows `noreply@liquidity-hq.com` — **not** `@brevosend.com`. If it fails: revert the sender in Supabase → Auth → SMTP and verify the domain in Brevo first. |
| **T2** | `/login` signed-out rendering, desktop | Core claim of `d154ac7` — that the page is now its own shell (6 controls, not 35) with a visible card surface in dark mode | Open prod `/login` in the **internal browser** while signed out. Confirm: no nav drawer, no news ticker, no coin rail, no Ask-AI button; card is visibly distinct from the page background; segmented control shows a clear selected state |
| **T3** | `/login` at 375px mobile width | Core claim of `0bf7305`; app is an installable PWA so mobile is the likely real-world width | Resize internal browser to 375×812 on prod `/login`. Confirm: Turnstile widget does not overflow the card, password checklist is single-column (not a cramped wrapping 2×2), no horizontal page scroll |
| **T4** | Visible field labels render + are wired | Claim of `0e1ea60` | On `/login`, confirm each input has a visible mono/uppercase label above it, and that clicking the label focuses its input (proves real `<label for>`, not decoration) |
| **T5** | Light mode on `/login` | `d154ac7` notes `:root` is the *dark* theme here, and its token swap leaked into light mode once already | Toggle to light on `/login`. Confirm the segmented control isn't inverted (should be recessed grey track, raised white pill) |
| **T6** | Tour step-dot animation timing | Claim of `c4e6044`; only visible during onboarding | Needs a **fresh** signup — the tour only fires for a new account. Watch the bottom-left step indicator on "Next": dots should glide with the content fade, not snap ahead of it |
| **T7** | Password policy checklist behaviour | Claim of `5a49b14` | On create-account, type a weak password and watch the four rules flip live 2/4 → 4/4. Confirm the length rule reads **12**, and that a rejected password never surfaces GoTrue's raw `abcdefghijklmnopqrstuvwxyz...` string |
| **T8** | Password reveal toggles | Same commit | Confirm each eye toggle flips **only its own** field and does **not** submit the form |

**Note on T6/T7:** T1 and T6 both need a fresh signup, and T7 sits on the same screen —
running one signup with a new inbox covers all three plus most of T2–T5. Do that first.

### Known-flaky verification methods — don't get fooled

These wasted real time in earlier sessions. All are documented as recurring:

- **Chrome returns stale computed styles right after a React re-render.** Force a reflow,
  or measure in a separate tool call. Three readings were wrong-then-right because of this.
- **`requestAnimationFrame` never fires while the browser pane is hidden.** Don't build
  measurement code that awaits it.
- **Turbopack serves stale `globals.css`.** A dev-server restart does *not* always clear
  it; deleting `.next` does. If a CSS change "isn't applying", verify the served bundle
  before concluding the code is wrong — or just test against the prod build, which compiles
  fresh.
- **Element refs go stale after a viewport resize.** Re-read the page for live positions.
- **`updated_at` on `lhq_app_config` is not maintained** by its writes and has no trigger —
  it is useless as a "did this run" signal. Compare the value, not the timestamp.

---

## 9. Current issues

### 🔴 Holding the 2026-09-05 release

Three issues, all terminal-mode on routes other than `/`, all of which the dead sorting rule in §6 would have parked. The owner reversed the fix-forward ruling and held the release for them.

| Issue | What it actually is | State |
|---|---|---|
| **#836** contrast | Seven instances of `opacity` over `--txt3`, plus one genuine tint-ground failure. Worst was `#a1a2a2` **1.95:1** on `/liq` `.gex-title > span` — the worst text ratio measured anywhere on the platform. `/liq` carried 5 of 9 light and 4 of 6 dark. | dev fixing |
| **#846** duplicate accessible names | **Three of the five are a spec defect, not app code.** `no-duplicate-controls.spec.ts:79` reads `innerText \|\| aria-label` — precedence backwards. `Tip.tsx` sets a distinct `aria-label` per instance but its `innerText` is always `ⓘ`, so every Tip collides with every other Tip. Real ones: `/calc` "Position Sizer" (nav-tile vs ps-preset, one navigates and one does not) and `/arena` "Sign In →". | QA's file to fix |
| **#843** Arena geometry | **Not a width.** The terminal Arena component was reverted and never restored — see §14. Cannot be fixed by a CSS number. | awaiting owner |

**#845 shipped** — the terminal app nav covered `/learn`'s logo and both hero buttons including the primary CTA. Root cause: #714 fixed the same bug on `/` and wrote the gate as `pathname === '/'` — one route, not a family. Now `rendersOwnNav()` in `lib/navRoutes.ts`, covering `/`, `/learn`, `/ko`, `/zh`.

> **The landing locales are `['ko','zh']` from `lib/i18n/dictionaries.ts`, NOT the ten in `lib/locales.ts`.** Two different lists. `app/[locale]/page.tsx` generates from the small one and `dynamicParams = false` 404s the rest — on a running build `/ko` is **200** and `/es` is **404**. Gating on the wide list claims eight routes that do not exist. A test binds the copy to `dictionaries.ts`.

### 🔴 Live risk

**SMTP sender change is unverified (T1).** Described above. It is a change to production
auth email delivery that has not been exercised once. Treat as the top priority.

### 🟡 Known open defects

| Issue | Status |
|---|---|
| **PEPE/BONK chart y-axis too wide on 15m** — axis spans ~0.0023–0.0030 while candles occupy a much narrower band, so they render squashed. 1h+ looks right. | Cosmetic, 2 coins, fastest timeframes only. **Deliberately stopped** — two wrong hypotheses were already produced on this exact chart. Likely a long EMA or a 200-bar S/R level dragging the range, but that is a starting point, **not** a diagnosis. |
| **Page scrolls ~36px at exactly 720px viewport height** on `/login` | From the "Continue without signing in" footer link, not the card. Accepted — nothing scrolls above ~760px. |
| **`btcExchangeNetFlow` + BTC liquidation heatmap are off** | Coinglass v2 API retired, v4 needs a paid plan. **Owner decided: do not pay until there's revenue. Do not re-raise.** Both call sites fail soft — no wrong numbers are shown, the heatmap card just doesn't render. |
| **Android push notifications likely inert** | No `google-services.json` found in the repo. The build skips the Google Services plugin when absent, silently. Unconfirmed whether this is intentional (not launched) or an accident. |
| **`.lbl` CSS naming is two incompatible conventions** | One family (`.lbl`, `.ps-card-lbl`, `.tj-card-lbl`, …) is mono/uppercase/tracked — the real idiom. Another (`.ps-lbl`, `.tj-lbl`, `.ct-stat-lbl`, …) is plain caption text. A contributor searching for precedent can easily copy the wrong one. Undecided: rename, or document the split. |
| **`AuthGate` is only wired into 2 places** | `app/alerts/page.tsx` and `components/TradeJournal.tsx`, despite being framed as *the* shared "sign in required" component. Other pages likely roll inline gates. Unclear if drift or deliberate. |

### 🟢 Cosmetic / hygiene

- **`scripts/gen-brand-icons.mjs` is not portable** — hardcodes an absolute path into the
  owner's `Downloads` folder for source art, and requires `sharp`, which is **not declared
  in `package.json`** (only present transitively via Next). A clean install elsewhere
  breaks it silently.
- **`supabase/schema.sql` is dead.** Pre-auth, single-user, RLS disabled. Superseded by the
  135 migrations. Grepped `app/` and `lib/` — zero references to its `clusters`/`signals`
  tables. Marked legacy in a header comment; kept for history. **Do not run it.**
- **Migration filenames run to `20260807`** while "today" is `2026-08-01`, and several docs
  describe `2026-08-07` events as already verified. Appears to be a sequencing convention
  rather than literal dates, but it is **unconfirmed** — see §12.

---

## 10. What to do next — prioritized

1. **Run one real signup on prod with a fresh inbox.** Covers T1 (the live risk), T6, T7,
   and most of T2–T5 in a single pass. Nothing else should jump this.
2. **Finish the UI audit — T2 through T5, T8.** Internal browser, prod, signed out, desktop
   then 375px. These are verification of already-shipped claims, not new work.
3. **Fix anything the audit turns up.** Commit to `dev`, merge, manual prod deploy.
4. Then pick from the backlog below, or whatever the owner prioritizes.

### Backlog (not urgent, nothing blocking)

- ~~**CI/CD pipeline**~~ — **DONE.** Shipped 2026-08-01, restructured 2026-08-06. The text
  here used to say *"No CI exists; deploys are manual"*, which stopped being true within a
  day and sat stale for five. See the Testing & CI table above. Deploys are **still
  manual and deliberately so** — `autoDeploy: "no"` on all three Render services, because
  merging to `main` should not be able to ship on its own.
- **Confluence Score validation** — `agree_count`/`agree_net` are recording correctly in
  prod, but **do not read the data yet.** Every row so far is `agree_count: 1` (a solo fire
  has no agreement to measure). Needs weeks of accumulation plus 24h resolution. A small
  sample will happily show a fake edge.
- **Per-coin exchange flow** — blocked on a data source, gated behind the Coinglass
  decision. Research non-Coinglass providers before assuming Coinglass is the only option.
- **`/ops` backlog** — custom ban message, instant session kill on ban, feature-flag
  kill-switches. All minor, owner-deferred.
- **i18n** — en/ko/zh/ar/ru done (2370/2370, both DBs). vi/pt-BR/tr/es/id pending.
  **Explicitly paused — do not resume proactively.**
- **Doc hygiene** — `docs/ARCHITECTURE.md` is dated Jul 16 and has not been swept against
  two weeks of pricing/i18n changes. Its one confirmed error (one-vs-two Supabase projects)
  is corrected inline, but the rest is unaudited. `INFRASTRUCTURE.md`'s "Known Automation
  Gaps" section is headed "as of 2026-07-19" and cites a since-deleted file.

### Signal-quality context worth knowing

From 6,201 resolved alert fires (Jul 19–31), after cleaning out PEPE/BONK unit corruption:

| rule | n | win rate | avg 24h |
|---|---|---|---|
| ema_signal_1d | 51 | 80.4% | +13.36% |
| ema_signal_4h | 299 | 59.2% | +2.45% |
| ema_signal_1h | 677 | 61.3% | +1.27% |
| ema_signal_30m | 1218 | 60.5% | +1.11% |
| rsi | 592 | 52.7% | +0.31% |
| ema_signal_5m | 782 | 51.5% | +0.11% |
| ema_signal_1m | 1983 | 49.6% | −0.01% |
| whales | 216 | 48.1% | **−0.39%** |

**Three caveats that must travel with these numbers:** the 24h horizon biases toward slow
signals (a 1m alert isn't meant to be held a day); it's **12 days and one market regime**
with no out-of-sample check; and `ema_signal_1d` at n=51 is as likely a trending fortnight
as a real edge. This is what justified removing the RSI double-count from the Confluence
Score. `ema_signal_1m` (largest sample, no edge) and `whales` (negative) have **not** been
acted on.

---

## 11. Owner-only actions — cannot be done from code

These are the only things standing between the current state and revenue. All are dashboard
work outside this repo.

### Before taking any real money

**Upgrade Supabase off the Free plan.** Free includes **zero** backups — not "7 days",
zero. There is currently no recovery path at all from a bad migration, a mistaken delete,
or a Supabase-side incident. Pro starts at $25/mo (100k MAU / 8GB disk / 250GB egress
included, so effectively flat at current usage). **No payment method is on file yet.**

Deliberately deferred while there are zero real users — nothing of value would be lost
today. But do it **before** flipping payments on, not after the first paying signup.

### Turning on payments — 4 steps, in this order

**Status 2026-08-11: steps 1, 3 and 4 are done on STAGING in test mode; step 2 is not.
All four are still outstanding for PRODUCTION** — test and live webhooks are separate
objects, secrets never cross environments, and `NEXT_PUBLIC_*` is inlined per build, so
nothing configured on staging carries over. Detail and the staging verification method
in `pendings/LEMONSQUEEZY.md`.

The code is finished and verified (webhook signature check, `custom_data.user_id` bound to
the payer's real email, replay protection via `lhq_ls_webhook_events`, test-mode rejection
in prod). Only configuration remains:

1. **Create the product/variant in LemonSqueezy at $25/month.** The app already displays
   $25 everywhere — `/upgrade`, landing page in 4 locales, DB-backed CTA label in 5 locales,
   both Supabase projects. Only the LemonSqueezy-side price still needs to match.
2. **Set `LEMONSQUEEZY_WEBHOOK_SECRET`** in Render on prod. Without it `verifySignature`
   returns false for every delivery and **every payment is rejected with a 401** —
   fail-closed by design. This must exist *before* the first real purchase or that purchase
   grants nothing.
3. **Set `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL`** in Render on prod. This is the switch
   that turns "Pro payments launching soon" into a real button.
4. **Point the LemonSqueezy webhook** at `https://liquidity-hq.com/api/lemonsqueezy/webhook`
   and subscribe to `subscription_created`, `subscription_updated`,
   `subscription_payment_success`, `subscription_cancelled`, `subscription_expired`. Those
   five are what the handler switches on; anything else is accepted and ignored.

Both env changes trigger a Render redeploy — `NEXT_PUBLIC_*` is inlined at build time.

---

## 12. Open questions — genuinely unanswered

Raised during onboarding; the owner didn't have answers. Left alone rather than guessed at.

1. **The `2026-08-07` date.** Six places across five docs treat it as already-past and
   already-verified, but "today" is `2026-08-01` and those files' own save dates predate it.
   Migration filenames also run through `20260807`. Sequencing convention, or a typo baked
   in during one editing pass? Until answered, treat "verified 2026-08-07" claims with mild
   suspicion.
2. **`.lbl` naming split** (see §9) — rename one family, or document the split?
3. **`AuthGate` coverage** (see §9) — drift, or deliberate per-page choice?
4. **`google-services.json`** — expected absent (Android push not launched), or missing by
   accident?
5. **`scripts/gen-brand-icons.mjs`** — worth making portable, or fine as personal-machine-only?

---

## 13. Migrating to the Claude Code terminal

Context for the move off the desktop GUI.

- **`cd` into the repo first.** `C:\Users\Dominic\Documents\VS code\liquidity-hunter-hq\liquidity-hq`
  (note the space in "VS code" — quote the path). Project skills, `CLAUDE.md`, and
  `.claude/settings.json` are all scoped to that directory and won't load from the parent.
- **`CLAUDE.md` auto-loads** and `@AGENTS.md` imports into it. That's your baseline context
  every session; this file is the layer above it.
- **MCP servers** (Supabase, Render) may need re-authorising in a terminal session — they
  are configured per-client. If tools 401, run `claude mcp` or `/mcp` interactively.
  Interactively-authenticated servers can be absent in headless/cron runs.
- **Claude Code CLI version:** `2.1.220`, installed via npm global. `DISABLE_AUTOUPDATER=1`
  is injected by the desktop app for its spawned sessions — that's why auto-update shows
  disabled there. A plain terminal session shouldn't have it, but updates are manual either
  way: `npm install -g @anthropic-ai/claude-code`.
- **Browser verification:** the internal browser is available in the terminal too. Keep
  using it rather than the owner's real browser.
- **The GUI session that died is not recoverable** — see §7. Nothing is pending in it.

### Local dev setup

- `.env.local` exists and points at the **dev** Supabase project (`wdtjhrilakoitfcezxpx`), including
  `SUPABASE_SERVICE_ROLE_KEY` — so `/api/ops/*` routes and `/ops/config` are fully testable
  on `localhost:3000` without burning dev-service build hours.
- Env var **names** are listed in `.env.example`. External services wired: Supabase,
  Turnstile, CoinMarketCap, PostHog, xAI/Grok, Coinglass, Finnhub, Telegram, Brevo,
  GlitchTip/Sentry, Web Push (VAPID).
- If a service-role key needs refreshing, get it from the **dev** project
  (`wdtjhrilakoitfcezxpx`) → Settings → API → Legacy API keys → `service_role`.
  **Never** prod's (`qdpwhnvmhqgzijuwopso`).

---

## 14. Hard-won lessons worth not relearning

- **An absence reports as a result, and it looks exactly like a measurement.** The single most
  expensive pattern in this project's history. It recurred fourteen times on 2026-08-12 alone,
  across both sessions. Every instance produced a *believable* answer from an instrument that
  was not working, and none of them threw an error: a grep proving absence with no positive
  control; `context.setOffline` leaving sockets open so nothing disconnected; a socket count
  that could not say *which* socket returned; a `+0` placeholder read as a settled score; a CSS
  scanner matching the explanatory comment above a rule instead of the rule; a Playwright
  fixture too small for the guard it exercised, whose bail-out read as a pass.
  **The instrument fails quietly and the finding looks reasonable.**
- **A control that cannot go red is not a control.** Before trusting a test that asserts
  something is absent, break the thing on purpose and confirm it fails. Three separate guards
  written on 2026-08-12 passed against deliberately-broken code until this was done.
- **One sample is uninterpretable without the variable that explains it.** A perps-vs-spot
  reading taken two minutes into an hour said "balanced"; the last closed hour said
  "futures-led". Same coin, same instant. Two readings of the same thing disagreeing is what
  exposed it — one reading looked fine and would have shipped.
- **Elimination is not identification.** Proving a mechanism *cannot* be the cause narrows the
  field and answers nothing. A data-path trace correctly showed the perps reading could not
  reach the Confluence Score; the actual cause — card factors arriving asynchronously — was
  found by capturing more state, not by reasoning harder about less.
- **Controls answer the questions you already thought of.** Three passing controls made a false
  finding feel measured; none addressed the confound, which was a question neither session had
  asked. The *number* of controls is not what makes a measurement sound.
- **Automation that is off looks exactly like automation that is working.** All three GitHub
  workflows are `disabled_manually` and `RELEASE_PR_PAUSED=1`. No red tick, no failed run — the
  automation simply is not there. Check the switch, not the absence of failures.
- **A decision inherits the soundness of the premise it was given.** The owner chose a prompt
  change on the basis that the AI was ignoring a signal. It was not: the sample had landed in a
  `normal` stretch. The change would have shipped, worked exactly as specified, and been
  permanently wrong about why it existed. No test would have caught that.
- **Search for the behaviour, not the location.** Three duplicates were nearly shipped in one
  day because the author looked in the file where the thing *should* live, did not find it, and
  built it. `dirForLocale` was in the landing-page module; the mobile 16px input floor was
  already in `globals.css` under a pointer-capability media query.
- **A command's success message describes the command, not the state.** `git push` printed
  "Everything up-to-date" while the remote was two commits behind. Only `git ls-remote` — or
  `/api/version` for a deploy — can say what the remote or the service actually holds.
- **Exit code 0 is a claim about the command, not about the state you're about to act on —
  and the two came apart four separate ways in one session (2026-09-02).** `git fetch ... :branch`
  into an already-checked-out branch moved the ref and silently left the working tree on the old
  commit — a `grep` for the new content matched the file on disk, which was stale. `gh pr merge`
  without a preceding `git pull` moved the remote while the local `dev` stayed behind, so a diff
  taken locally described a branch that no longer existed upstream. Four gates run green, then
  the file edited *after* them — the green was real when it ran and stale the moment the file
  changed; nothing re-ran to notice. A Turbopack dev server kept serving a `.next` cache built
  from an earlier branch checkout after a fresh `next dev` restart on the correct branch — the
  process was new, the cache on disk was not, and `display: block` where the shipped CSS said
  `flex` read exactly like a real layout bug until the cache was cleared by hand. None of the
  four commands reported failure. **Before trusting a measurement taken right after a command
  that changes state (checkout, fetch, merge, edit, restart), verify the state directly** — reread
  the file, `git log -1`, `git ls-remote`, a fresh `grep` against the actual served output — rather
  than trusting that a `0` exit code means the thing you just did is reflected in what you're about
  to look at.
- **A magnitude bug doesn't end at the fix.** Bybit quoting PEPE/BONK per 1000 tokens was
  normalised in two places and missed in four. Fixing it surfaced three more bugs
  immediately, because correct-but-tiny numbers finally reached code that had never seen
  them: 22 alert rows at ±100,000%, alerts quoting entry/SL/TP at 1000×, and three price
  formatters flooring to `$0`. Every downstream consumer had been silently calibrated to the
  wrong magnitude. Grep the symbol prefix, then check every formatter and every stored price
  on the path.
- **Health is semantic, not an HTTP status code.** `truthsocial.com`'s RSS returned 200 OK
  indefinitely while serving an HTML app shell with zero items. A naive uptime check calls
  that healthy. `ok` must mean "the response carried data we can use".
- **Measure from where the code actually runs.** `rss:CryptoSlate` returns 403 from Render's
  IP while returning 200 with ~10 items from a home connection. That failure is invisible to
  local testing by construction.
- **A broken button just looks like a failed check.** The `/alerts` "Check now" button
  returned 401 on every press for days after cron routes were made fail-closed, and nobody
  noticed. Silent-looking failures need explicit surfacing.
- **Any "preview"/"test" surface must not consume dedup slots.** The alert dedup maps are
  what stop an already-announced signal firing twice — a preview that consumed a slot would
  *suppress* the real alert that followed, and the user would silently never get it.
- **`aria-label` overrides visible text.** Keeping both a visible `<label>` and an
  `aria-label` breaks voice control ("click Password" stops matching what's on screen).
- **Don't test within ~60s of a Render deploy** — mid-cutover 502s and rate-limit buckets
  resetting to zero will produce results that look like real bugs.
- **OAuth uses the implicit flow deliberately.** PKCE was tried and reverted — it broke real
  mobile Google logins. Any re-attempt needs real multi-browser mobile testing before prod.
- **Docs go stale in specific, repeated ways.** Several past audits were sent down detours by
  confidently-worded but outdated notes. `docs/INFRASTRUCTURE.md`'s own header says it best:
  a stale version of a file is worse than no file, because it actively misleads.
- **A BROKEN INSTRUMENT RETURNS A CLEAN RESULT, NOT AN ERROR. This is the most expensive
  pattern in the project and it recurred five times on 2026-08-13 alone.** Every instance
  produced a confident answer from a tool that was not looking at the right thing:

  | instrument | reported | actually |
  |---|---|---|
  | `grep /_next/static/css/` | "feature absent from the deploy" | wrong path - CSS is under `/chunks/` |
  | rule matcher on `style.color` | "no rules match this element" | `style.color` is `''` for any `var()` value |
  | `elementFromPoint` probe | geometry that contradicted itself | measured off-screen and clipped rects |
  | a 7s wait on a free-plan host | "the rail is not in the DOM" | it renders later than that |
  | Playwright `reuseExistingServer` | 3 consecutive PASSes | served a build from before the checkout — **a `git checkout` does NOT restart it** |
  | a route stubbed on a promise the test resolves later | a 10-minute timeout | the page deadlocked, so nothing was measured at all |

  **The defence is a positive control: break the thing on purpose and confirm the instrument
  goes red.** A detector that has never failed has never been tested. Assert the precondition
  before trusting a zero - "found nothing" and "looked in the wrong place" are the same output.

  **And `/api/version` does not save you locally** - it reports `commit: "unknown"` on a dev
  server, so the habit that catches a stale DEPLOY fails silently on a stale LOCAL one. What
  exposed the `reuseExistingServer` case was not the result, which looked ordinary three times
  running, but grepping the served asset for a rule the commit introduced:

  ```
  git show fd17cbc:app/globals.css     .gchat-mode-opt::after { ... height: 48px }
  served CSS on :3100                  no ::after rule at all
  ```

  **Compare the bytes against the source, not the branch against your intent.**
- **Fixing the reported instance and leaving the class is the default failure, even when you
  know the rule.** #404 took three passes - grid card, then the hero sixty lines above it,
  then two more renderers sharing the same grid. The tell is closing a ticket rather than
  looking for a class: search for the BEHAVIOUR (`grep` the destructive call), not the
  component you were sent to.
- **Logic that decides something important must live where it can be unit-tested.** Three
  times in one week the deciding branch sat somewhere untestable: `needsLiveSearch` inside a
  `.tsx`, `perpNoticeTone` inline in a component, `paidPeriodLapsed` behind the `@/lib` alias
  the test runner cannot resolve. Each moved to `lib/` and each move immediately found a bug
  the code review had not. **If it cannot be tested where it is, that is the finding.**
- **NEWS CANNOT BE TESTED OUTSIDE PRODUCTION.** `lhq_dev_news` is fed by a cron that only
  ever targeted prod, so it is permanently stale (67 rows, newest 2026-08-03 as of
  2026-08-13). **localhost, `liquidity-hq-dev`, `qa` and `staging` all render zero news
  cards** - qa and staging share the dev database. Missing local API keys are *not* the
  cause and deploying to dev does not help. Any change to `/news` reaches production
  unverified; say so in the PR rather than letting the reader assume it was checked.

### Three that cost the most time on 2026-09-05

**1. `opacity` multiplied onto `--txt3` is now SEVEN instances of the same defect.**

`--txt3` is tuned to sit just above 4.5:1 — measured at full strength it is **4.70 to 5.88 across every panel ground in both terminal themes**. It has no headroom left, so any multiplier at all drops it under AA. The instances, in the order they were found:

```
1  .pf-footer-bottom-note      2  .mr-scale-good        3  .st-locked-list  (dark half only)
4  .lp-footer-ack              5  .gex-title > span     0.5 -> #a1a2a2  1.95:1
6  .liq-section-sub            0.75 -> #458c57 3.03, #af4a50 3.90
7  .st-locked-list             0.6 light -> #9b9da0  2.71:1   (the half #3 missed)
   + FundingTerminal hint 0.6, econ-calendar source 0.5
```

**The rule: de-emphasise with size, weight or a separator — never by dimming ink that is already at its floor.** `globals.css` names the trap at `.lp-footer-ack`; read that comment before adding an `opacity` to any text.

The corollary, and the thing that made #3 half-fixed for weeks: **a fix scoped to one theme is not a fix.** `.st-locked-list` was "fixed" in dark and its light multiplier survived because the justification — *"over a white card, where the base colour has the headroom"* — was true of the current design and never re-checked against terminal.

**2. A background is not the first non-transparent ancestor.** `.liq-current-oi` was the only entry on #836 that is *not* an opacity bug: `--txt3` at full strength still measures **4.09:1** there, because `.liq-current-bar` is `--accent-2` at 9% composited over the panel, which lifts the ground toward the ink. Measure over the composited ground or the number is wrong in the safe-looking direction.

**3. CSS can outlive the component it styles, and the CSS is not evidence the screen exists.**

`components/ArenaTerminal.tsx` **does not exist.** `dd39c9bb` reverted the terminal-Arena branch — 1,212 lines including the component (355), `lib/arenaColour.ts`, `lib/arenaTimeframes.ts` and their tests — and `ccefc0de` (#413) then restored **939 lines of `globals.css` and not the component.** So `[data-design="terminal"] .at-rail { flex: 0 0 352px }` is correct, present, and styles markup that nothing renders.

A sweep of every `[data-design="terminal"]` selector against every `className` in `app/` and `components/` found **194 of 349 terminal classes have no markup**. That number is an upper bound on dead CSS, **not a defect count** — and the difference matters:

| Cluster | n | Component | Verdict |
|---|---|---|---|
| `at-*` | 66 | `ArenaTerminal.tsx` — **gone** | `/arena` is not converted. Real. |
| `lt-*` | 88 | `LandingTerminal.tsx` — exists, renders `lpt-*` | dead CSS, no user impact |
| `dterm-*` | 19 | `DashboardTerminal.tsx` — exists, renders `dash-*` | dead CSS |
| `sshell*` | 5 | none | dead CSS |

`lt-*` looked identical to `at-*` from the grep and was nearly reported as breakage; only opening `LandingTerminal.tsx` separated them. **Run the control in both directions before trusting a sweep** — and `/arena` sits in `CONVERTED_ROUTES` today, so the ledger says converted where the screen is current-design markup plus `border-radius: 0`.

### The failure that looks like success — 2026-09-03

Six defects in one session shared a shape: **the symptom is indistinguishable from
the healthy state**, so the thing you check to find them returns the same answer
either way. Each is cheap to avoid once named.

**A TypeScript parameter property makes a `lib/` module permanently untestable.**

```ts
constructor(public readonly status: number, message: string) {}
```

SWC compiles this, so it works in production. Node's type-stripping **refuses the
whole file** — the shorthand emits code rather than only annotating — so any
`__tests__/*.test.mts` importing that module dies with
`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX` before a single test runs. **Lint, `tsc` and
`npm run build` all pass.** The only symptom is a test file that will not load.
Declare the field separately and assign in the body.

**A CSS rule an inline style outranks is dead, not overridden.** It can never
apply, and no source read shows that — `globals.css` said the rail badge was
9.5px mono for as long as the rule existed while it rendered 12px sans. Three
defects shipped this way (#629, #633, #660). This is what `qa/mobile-audit.mjs`'s
`deadRules` check is for (#666) — written after the third, because no source
read finds them.

**An empty result from a broken detector looks like a clean page.** The first
version of that check returned `[]` against the real site *and* against a page
built to contain one known dead rule — modern Chrome gives every `CSSStyleRule` a
truthy empty `cssRules`, so a `if (r.cssRules) recurse` walk collects nothing.
**Validate any new check against a known positive before trusting a clean run.**

**A number computed from a subset of its inputs renders as a complete number.**
`AccumulationTracker` could drop 47 points against a display threshold of 45;
`lib/distribution.ts` can drop 55 against labels at 70 and 45, which turns a
genuine `Distribution` into `Quiet` — the opposite claim, not a weaker one.
`?? 0` on a missing price change was worse still: the coin survived a filter meant
to exclude it, took the maximum of its section, and asserted `'Price flat'` in
rendered text. **A neutral-looking default is often the strongest possible claim.**

**A loading state and a missing source render identically.** A 15-second wait on
`/liq` caught `LIQ_NO_OI_DATA` and produced a report that the page was broken in
production. Polling to 60s showed 154 rows. **Poll until the page settles; never
conclude absence from one sample.** The same confusion made "not applicable" and
"not tested" identical in the dialog audit, and made a null `.liq-heat-wrap` look
like a defect when it was the empty-state path.

**Three identical measurements can be one measurement.** Three scanner runs
returned the same five blank symbols, which looked like proof it was not a race —
but `s-maxage=120, stale-while-revalidate=600` meant all three read one cached
answer. **Variation confirms; stability inside a cache window proves nothing.**

**The correct pattern already existing in-repo does not mean it travelled.**
Four times in one session the right handling was present and documented at the
place that got it right, and absent everywhere else: `--border-input`, a governed
neutral nobody reached for; `marketStore`'s `>= 2` signal floor, which two other
scorers lacked; `pool()`; and terminal typography, where `globals.css:6976`
documents one inline-vs-stylesheet collision at the rule itself and reaches
nobody writing the next component. `pool()` existed **twice**, hand-copied,
each copy explaining why it was needed. Copying is what stopped it spreading: a
comment only reaches someone already reading that function. Prefer a check over a
convention, because a convention has to be recalled at the moment of writing.

**A backslash dies inside a quoted string, and the detector goes silent.** Three
instances in one session, all in checks whose failure mode is *finding nothing*:

```js
if (!/[.#]/.test(sel)) …            // fine - a regex literal
new RegExp('(^|;|\s)' + prop)       // '\s' is just the letter s
new RegExp(`…\b${cls}\b`)              // \b in a template literal is BACKSPACE
```

The first was `qa/mobile-audit.mjs`'s dead-rule detector under-reporting; the
other two were `__tests__/terminalTypographyOwnership`'s sweep **matching
nothing at all** and therefore declaring the codebase clean.

**The distinction between those two matters more than the bug.** Under-reporting
means some cases were missed; the third instance meant the rule map came back
near-empty, so the sweep **reported on an empty set** — it did not miss some
collisions, it compared the codebase against nothing and called it clean. A run
that examines zero things and a codebase with zero defects produce byte-identical
output. That is why every sweep in this repo now carries an arming assertion (`the
rule map has > 20 entries`, `the file walk found > 50 files`) alongside its
positive control: the control proves the check *can* fail, the arming assertion
proves it had something to look at.

A regex literal is safe; the moment a pattern is built from a string — because it interpolates a
variable — every backslash needs doubling, and nothing warns you. **Build
patterns from plain strings with explicit `\\`, never from template
literals**, and assume any new string-built matcher is broken until a positive
control says otherwise.

**A measurement over the wrong field gives a confident wrong answer, not an
obviously broken one.** Investigating `/econ-calendar`'s 72 blank cells, a probe
read `e.date || e.time || e.datetime`. The field is `isoDate`. Every event fell
back to epoch and read as *past*, so the run reported "19 past, 19 missing
actual" — a fabricated defect that pointed at the **opposite** conclusion from
the truth, which is that all 19 events are in the future and their blank
`actual` is correct. It was caught only because a printed sample row showed a
September 4 date under a "past" heading. **Print a sample of what you measured,
not just the aggregate** — the aggregate cannot show you that you read the wrong
key. The same shape produced `rsi symbols=2` from counting the two top-level
keys `{rsi, ts}` instead of the 46 inside `rsi`.

**A hex grep reads prose.** Sweeping `qa/` for stale palettes, a grep for
`#6a6e73` and `#1a7f37` matched `qa/token-surfaces.mjs` — in a *comment*
documenting the previous stale-palette incident. The real drift there was four
different values, found only by parsing the object literal by brace depth.
Files in this repo deliberately record their own history in place, which makes
grep-for-a-value structurally unreliable on them. `app/globals.css` has the same
property and it has caused this before (#641).

**Two tools measuring the same thing must be reconciled, or the weaker one keeps
publishing.** `qa/mobile-audit.mjs` proves horizontal overflow by scrolling and
checking the offset sticks; `qa/platform-audit.mjs` computed
`scrollWidth - clientWidth`. `html { overflow-x: hidden }` clips the closed nav
drawer while `scrollWidth` still reports its extents, so the second tool flagged
four mobile loads that cannot scroll — reproducing a phantom overflow QA had
already reported and retracted on #641, on every run for weeks afterward.
**When a check is corrected, grep for every other copy of the same comparison.**

---

## 15. How we work — the two-session model

**Two Claude Code sessions share one GitHub account.** Separate working copies, different
jobs, and the PR is the handoff between them.

```
dev folder   writes application code       app/  components/  lib/
QA folder    writes test tooling           qa/  playwright.config.ts  test CI
```

`CONTRIBUTING.md` and `CLAUDE.md` hold the enforceable rules — branch names, commit format,
who merges, who deploys. **This section is the part that is not a rule: how the two sessions
actually get to a correct answer.** Written 2026-08-12, after a day in which both sessions
produced false findings and both retracted them.

### QA is the project manager

QA files issues, sequences them, and says what is next. Dev executes without asking the owner
to choose. **"What is next?" goes to QA on GitHub, not to the owner in chat.**

The consequence people miss: **GitHub is the channel, not chat.** The owner mostly watches
QA's session. A measurement that exists only in a dev chat reply is invisible to the person
sequencing the work. Negative results, corrected premises, abandoned approaches and cost
numbers all belong on the issue — they are worth as much as the successes, because otherwise
the other session re-derives them.

### Neither session is the authority on the other's work

The pattern that repeatedly worked:

- **QA writes the invariant BEFORE the feature — and proves it discriminates before reporting
  anything from it.** `score-perps-coupling.spec.ts` pinned "the score must not move with the
  perps reading" *before* the weighting existed. Dev would not have written it: the change was
  "hand a sentence to a model", which nobody expects to move a number, so nobody checks.
  **The second half of that sentence is not optional.** That same file then produced a false
  finding — it reported coupling that did not exist, held a PR for ninety minutes, and needed
  three instrument fixes before it was sound. Writing an invariant early means it has never run
  against a build where the property holds, so *nothing has confirmed it can tell the two states
  apart*. Get it red on a known-bad build and green on a known-good one before you believe it.
- **Dev traces the data path; QA captures the state.** These find different things.
- **Whoever is wrong says so on the issue, in the same thread.** Both sessions retracted
  findings on 2026-08-12. The retractions were more useful than the findings.
- **Verify a relayed instruction when it is expensive to get wrong.** An owner "go" that
  arrives through the other session, for work touching every page, is worth one confirming
  question. It costs a minute and it lands on the record.

### The evidence standard

**An issue closes on `qa` + `staging` evidence, not production.** Say in the close comment that
it is on staging and not yet prod, so nobody reads it as shipped.

**Quote what the service is serving, never the branch.** `/api/version` reports `commit` and
`branch` from the running service. A branch that has moved while its service has not is the
most common way this project confuses itself. This bites one step further than it looks: a
session once quoted the correct served commit and then read file contents with
`git show origin/qa:...` — branch and service agreed on the commit, but the contents came from
git while the service served something else.

**Say what was not verified.** Every PR's Risk level names what could not be checked and why.
"Not verified" is normal to write and a red flag to omit.

### When to stop automating and ask a human

Six automated attempts across two sessions failed to verify one WebSocket reconnect. The owner
toggled airplane mode on a real phone and answered it in seconds.

**The rule is not "ask a human first"** — automation is repeatable and a manual check is not,
which is why specs exist at all. It is: **count the attempts.** After two mechanisms have
failed *silently* at the same property, question whether the property is reachable from a spec
at all, rather than reaching for a third mechanism.

Record what a manual result does not establish. It verified the fix on one device, one network,
one moment. **It does not protect it** — a regression would ship silently. Write "closed on
manual evidence, no regression guard exists" rather than letting "verified" imply a test.

### Cost is a real constraint

The repo is private, so **every GitHub Actions minute is billed to the owner personally.** All
three workflows are disabled on purpose. Local gates are the substitute and they are free: lint,
`tsc`, unit tests via the pre-push hook, and Playwright against a **deployed** host — stronger
evidence than CI's ephemeral build anyway.

Same logic for Render build minutes: **do not deploy a change that alters nothing a request can
observe.** A spec-only or docs-only commit rides to `qa` with the next behavioural change. Say
so when you skip a deploy, or the drift monitor's warning gets read as an action item.

Grok/xAI calls cost money per run. Test prompt *construction* — free and deterministic — rather
than model *output*. Reserve paid calls for what free tests genuinely cannot answer, and say
what the call bought.

### Ask once, then drop it

A request repeated every message is pressure, and a yes obtained that way is not approval. It
happened on 2026-08-12 and cost the owner money. Pending asks live on the relevant issue and are
mentioned in chat **once**.

Two corollaries learned the same day:

- **One ask, one asker.** Both sessions independently asked the owner the same question within
  minutes; each had followed the rule individually. Check the issue for an existing ask first.
- **`staging` is a destination, not a waiting room.** Verified work parks there and stays; the
  owner decides when anything reaches production, on their schedule. A large `main..staging`
  gap is the *intended* state, not a backlog. Do not chase the release.
