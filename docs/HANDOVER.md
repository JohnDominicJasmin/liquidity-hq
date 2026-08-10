# LiquidityHQ — Handover & Onboarding

**Written 2026-08-01.** Single entry point for picking this project up cold — written for
a fresh Claude Code terminal session with no prior conversation context.

Read this first, then `CLAUDE.md` → `AGENTS.md` → whichever doc in the map below covers
what you're touching. If this file and the code disagree, **the code wins — then fix this
file.**

---

> ### ⚠️ This file records STATE, and state goes stale. Reviewed 2026-08-10.
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

**Business state:** pre-revenue. Two test accounts, no real users, payments not switched on.

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

### Branch & deploy state as of 2026-08-01

| Where | Commit | Note |
|---|---|---|
| local `dev` | `064ec5a` | clean, synced with `origin/dev` |
| `origin/dev` | `064ec5a` | 1 ahead of `main` (docs-only) |
| `main` / `origin/main` | `ab9dd58` | merge of `0bf7305` |
| **Render prod** | `ab9dd58` | deploy `dep-d9mecn3m8hqs73c6aaig` — **live** |
| **Render dev** | `f6f1eb15` (Jul 30) | **stale** — several days behind `dev` |

The one commit `main` lacks (`064ec5a`) is documentation only, so prod is not missing any
code. The dev *service* being stale is expected — it's only deployed on demand.

---

## 7. Current progress — what shipped 2026-08-01

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
