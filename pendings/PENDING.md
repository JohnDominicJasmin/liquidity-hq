# Pending Work

Single source of truth. The original security audit (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs)
is **fully resolved** - every finding fixed and live on prod, including the
last optional item (signup IP-velocity Auth Hook, 2026-07-25). The pricing
analysis that decided the $25/mo price point is also fully implemented and
live. Both of those write-ups (`SECURITY_AUDIT.md`, `PRICING_ANALYSIS.md`)
were removed 2026-07-25 since neither had anything pending left in it - see
git history if the original detail is ever needed. Same for `ALERTS.md` (the
alert-cron cost/signal-quality plan) - fully superseded, xAI removed
entirely from every alert type, also removed. LemonSqueezy payment-feature
items (deferred, payments not live yet) are in `pendings/LEMONSQUEEZY.md`.

**Full QA sweep 2026-08-04 → `pendings/QA_AUDIT_2026-08-04.md`.** Build gates,
65-route API security, responsiveness at 1440px + 375px, accessibility, SEO,
Core Web Vitals, tech debt. Re-verified against a clean rebuild with a
stylesheet guard — headline numbers reproduced exactly (§9.1).

No security defect found (33/33 OWASP probes rejected, incl. a forged
`alg:none` owner token). Findings: every route fires ~450 browser-side Binance
calls including static legal pages (§1.1 — this machine is already IP-banned by
Binance, `HTTP 418`); the brand blue `#1A7AFF` with white text is 3.98:1, so the
primary "Get Started Free" CTA and every nav pill fail AA (§4.3); `/scanner`
column headers are 1.55:1 (§4.3); 159 sub-24px tap targets, ~85% from one footer
component (§4.1); `/briefing` hydration mismatch (§5.1); zero canonical tags and
one shared meta description sitewide (§6).

Nothing in it is fixed — it is a handoff list. BOLA/IDOR is still **unverified**
(needs two test tokens). Passed clean: zero horizontal overflow at both widths,
CLS 0.000 everywhere, no RLS-disabled tables.

## ❓ YOUR decision — upgrade Supabase to Pro before real payments launch

Checked live in the dashboard 2026-08-07: **the org is on the Free plan, and
Free does not include project backups at all** - not "7 days," zero. The
Database → Backups page states this directly: "Free Plan does not include
project backups. Upgrade to the Pro Plan for up to 7 days of scheduled
backups." Confirmed via `get_organization`: `"plan":"free"`.

Real cost, read off the actual pricing panel (not estimated): **Pro starts at
$25/month**, usage-based above included quotas (100,000 MAU / 8GB disk / 250GB
egress included). Gets you daily backups retained 7 days, plus 7-day log
retention. Current usage (2 test accounts) is nowhere near the included
quotas, so in practice this would be a flat $25/mo for a long while.

Decision, deliberately deferred: **not urgent with zero real users - nothing
of value would be lost today.** But there is currently no recovery path at all
if a bad migration, a mistaken delete, or a Supabase-side incident hits prod.
Upgrade **before flipping on real payments** (see `pendings/LEMONSQUEEZY.md`),
not after the first paying signup - that is the point where "no backup"
stops being theoretical.

No payment method is on file for the org yet (`Billing` page confirmed
"No payment methods"), so this needs the user directly - can't be actioned
from code.

## ✅ RESOLVED — xAI credit outage (found + fixed 2026-07-24)

xAI account had hit $0.00 credit balance ("no credits remaining"), which would
have broken every live Grok/xAI feature for real users. Topped up **$10**
(new balance ~$9.96, confirmed on console.x.ai billing) and **auto top-up
enabled** ($10 charge when balance falls to $5 or below) so this doesn't
recur silently. Closed.

## ✅ ALL CODE WORK LIVE ON PROD (2026-07-24)

Four merges today, all deployed: 15 commits (homepage 200, `webhook_ok:
true`), then 5 more (`dep-d9hlm2cm0tmc73b4qum0`), then non-xAI attribution +
pricing/cap repricing (`beb2a8d`), then the `/ops` cost view + disposable-email
blocklist (`da737f7`, deploy `dep-d9hofvd7vvec73er9o4g`, **manually deployed
by you and confirmed live** — re-smoke-tested: homepage 200,
`/api/telegram/status` → `{"configured":true}`, `/upgrade` verified in a real
browser showing `$25/mo` and the trimmed 5/3/10/40/18/75/18 caps). Everything
below is live on prod right now, not just `main`.

- **Raw i18n label keys flashing on every full page load** (user-reported via
  screen recording, `/dashboard` + confirmed on `/markets`, `/arena`,
  `/settings` typed directly into the URL bar) — root-caused by `curl`ing the
  SSR HTML directly: raw `KEY_NAME` strings were literally in the
  server-rendered payload on every full page load (client-side `Link` nav was
  already flash-free - a different code path than what was fixed earlier).
  `LabelsProvider` had no SSR-safe default. Fixed by seeding a static English
  label snapshot (`lib/labelDefaults.en.json`) as the initial state - worst
  case is now a brief English flash before the real locale loads, never a raw
  key. Verified 0 raw-key matches on all 4 routes **on prod itself** post-deploy.
  Writeup + regeneration process in `pendings/I18N_MIGRATION.md`.
- AI cost caps on all 9+2 xAI/Grok routes + TOCTOU race closed (atomic `increment_ai_usage`).
- **Global daily xAI circuit breaker — LIVE.** One app-wide counter on top of per-user caps; stops a *fleet* of accounts each staying under their own cap. Built, live-tested (capped at limit, rolled back correctly), on both Supabase projects. `AI_GLOBAL_DAILY_MAX=2000` now set on both Render services (prod + dev) — the breaker is ON.
- token-unlock / smc-snapshot cache-bypass closed.
- macro / telegram detect / bot-info / webhook per-IP rate-limited; telegram/test auth-required.
- **IP-spoof fix** — `getClientIp` read the client-controllable leftmost `X-Forwarded-For` hop; now reads the rightmost (Render-appended, trusted) hop. Every per-IP limit in the app now actually holds.
- **Non-xAI traceability, now full account-level — LIVE on prod.** Every unauthenticated route that calls a metered/keyed external API now logs IP **and** user id (or `anon`) on every call: `cmc` (`CMC_API_KEY`), `news/finnhub` (`FINNHUB_KEY`), `econ-calendar` (shares `FINNHUB_KEY`), `proxy` (`COINGLASS_API_KEY` for the coinglass-flow/liq types). Checked every other API route for the same shape first — `macro`, `coinbase-price`, `cycle`, `ath`, `forex/jpy`, `funding`, `news-rss` all call keyless public APIs (Yahoo Finance, Coinbase, Bybit, CoinGecko, open.er-api.com, Binance futures, plain RSS) with no vendor cost/quota to attribute, so they're correctly out of scope. `MarketProvider`/`NewsProvider`/`EconCalendarWidget`/`ConfluenceScore` attach a bearer token when the caller happens to be signed in (`lib/supabase.ts` `getAuthToken()`); each route verifies it server-side (`auth.getUser()`) and logs the real user id, falling back to `anon` — auth stays optional, all four routes are still intentionally unauthenticated (public data for signed-out visitors too). Verified locally: fresh requests on `/markets` log `user=anon` for all four routes for a signed-out session, no regression. `npx tsc --noEmit` clean.
- Cron auth fail-closed, `CRON_SECRET` set, verified 200 on a live cron run.
- Telegram webhook: secret set + re-registered, `webhook_ok: true` confirmed. `/start` restored.
- Trial abuse: email dedup, revoked stray write grants, FK CASCADE→SET NULL, null-email = no trial.
- Error-message leakage: ~25 routes via `lib/apiError.ts`.
- LemonSqueezy webhook rejects `test_mode` in prod.
- Secrets/keys/logs audited clean. Admin traceability exists at `/ops`.
- Adversarial re-verification (live prod DB, 3 passes): 5/6 sampled fixes SOUND; 1 defect found + fixed same session.
- **Turnstile CAPTCHA on magic-link login — LIVE on prod.** Widget "LiquidityHQ Login" created in Cloudflare (hostnames `liquidity-hq.onrender.com` + `liquidity-hq-dev.onrender.com`, Managed mode). `NEXT_PUBLIC_TURNSTILE_SITE_KEY` set on both Render services (prod deploy `dep-d9hnd57lk1mc73eagneg` confirmed `live`). Secret key saved in Supabase (`liquidity-hq-prod` project) → Authentication → Attack Protection → Captcha provider `Turnstile by Cloudflare`, toggle on. Verified end-to-end on the real prod URL: the Turnstile checkbox ("Verify you are human") renders live on `/login`, not just the earlier loading placeholder. This is what actually stops unlimited-distinct-inbox trial farming — closed.
- **Dev aligned to prod on `TELEGRAM_WEBHOOK_SECRET` + `NEXT_PUBLIC_APP_URL`** — both set on `liquidity-hq-dev` (`https://liquidity-hq-dev.onrender.com`), matching prod's setup. Deploy triggered automatically by the env var update (also picks up the non-xAI attribution commit above). Note: dev's Telegram webhook itself is still unregistered — this only makes the route ready to verify a secret if one is ever pointed at dev; no live Telegram traffic depends on it.
- **Admin $-cost view, LIVE on prod** — new `lib/aiCost.ts` (real per-token rates:
  $1.25/$0.20/$2.50 input/cached/output per 1M, plain-call ≈$0.0041,
  search-call ≈$0.0091, matching the pricing analysis - see git history,
  `pendings/PRICING_ANALYSIS.md` was removed 2026-07-25). `/api/ops/ai-cost`
  now returns real $ figures (24h/7d/30d, global + per-user), sorted top-10
  spenders by $ with role + margin (Pro revenue minus cost), and the global
  circuit breaker's today-vs-cap usage with an 80%-threshold spike flag.
  `/api/ops/users/[id]` gets the same per-day $ + 14-day margin. New table
  registry entry `T.global_ai_usage`. 11 new English-only labels (admin-only
  surface, labels API already falls back to English for any other locale —
  see `pendings/PENDING.md`'s i18n-paused note). Verified: `tsc` clean, `/ops`
  loads with no console errors (correctly gated to `/ops/login` signed-out),
  cost formula cross-checked by hand against a real `lhq_dev_grok_usage` row.
  **Not verified end-to-end as a signed-in admin** — that needs your actual
  login, I don't have ops credentials. Prod currently has zero `lhq_grok_usage`
  rows in the last 30 days (real usage hasn't accumulated yet / credits were
  out), so the card will show its empty state until there's real traffic.
- **Disposable-email domain blocklist — LIVE on both DB projects.** New
  `lhq_disposable_email_domains` table (46-domain starter list — mailinator,
  guerrillamail, 10minutemail, yopmail, temp-mail.org, and similar
  well-known throwaway providers; not exhaustive, extend by hand over time).
  `lhq_grant_signup_trial()` now checks the signup email's domain against it
  — a match still gets a free-tier account (same non-destructive pattern as
  the existing dedup logic), just `trial_ends_at = null` instead of a fresh
  14-day trial. Pairs with Turnstile: CAPTCHA stops scripted mass signups,
  this catches a human manually farming trials with real throwaway addresses.
  Verified live via direct SQL (not a real signup): `test@mailinator.com` →
  blocked, `real.person@gmail.com` → not blocked, `YOPMAIL.COM` uppercase →
  still correctly matched. Applied to both `qdpwhnvmhqgzijuwopso` (prod) and
  `wdtjhrilakoitfcezxpx` (dev).

## ✅ Auth screen + mobile audit — ALL LIVE ON PROD (2026-08-01)

Six commits, one continuous audit arc that started from a real signup on prod
and ended with a mobile pass. All merged to `main` (`ab9dd58`) and deployed -
confirmed live directly via Render (`dep-d9mecn3m8hqs73c6aaig`, status `live`),
not just pushed to `main`.

- **Trial-ending email stopped promising a checkout that doesn't exist**
  (`0174e56`). The email said "Keep Pro" and linked `/upgrade`, which just
  renders "Pro payments launching soon" until
  `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` is set - sending the most interested
  user we have to a page that cannot take their money. Gated on the same env
  check `/upgrade` and `UpgradeGateModal` already use, so all three agree by
  construction. No-ops the moment checkout is configured.
- **Sign-up password check fixed + reveal toggle added** (`5a49b14`). Client
  checked `password.length < 8`; Supabase Auth actually enforces 12 characters
  plus upper, lower and a digit - so the form accepted the password and GoTrue
  bounced back its own raw character-set string as the error, on the first
  screen of the product. `lib/passwordPolicy.ts` is now the single mirror of
  the dashboard policy; login/reset-password/settings each had their own stale
  copy of the 8-character rule before this. Checklist renders as four separate
  label keys, not one joined sentence - does not survive ko/zh/ar/ru.
- **Auth screens pulled into their own surface** (`d154ac7`). `/login` was
  rendering inside the full consumer app shell - nav drawer, scrolling news
  ticker, floating Ask-AI button, coin rail, 35 interactive elements for a
  screen with one job, most of which just bounce back to `/login` anyway.
  Reuses the `/ops` chromeless branch, but checks the auth route *after* the
  maintenance check - opposite order from `/ops`, intentionally: `/ops` must
  stay reachable to turn maintenance off, while a signed-out user hitting
  `/login` during maintenance should see the maintenance screen, not a working
  form for a down app. Fixed 3 measured (not eyeballed) dark-mode contrast
  bugs found in the process: `.login-card` was the same colour as the page
  background (no surface at all), `.login-pw-tab.on` was the same colour as
  its own track, and `.login-back-btn` was a 26px tap target under the 44px
  floor.
- **Tour dots + trial banner readability** (`c4e6044`). The tour's step-dot
  transition finished at 0.3s, before the content fade (0.38s) and progress
  bar (0.4s) - so the one element the eye tracks during a step change was the
  only one that snapped ahead of the rest. Now 0.42s, landing together with
  the rest of the step. Trial banner was a 7px strip that read as a
  dismissible system notice and got ignored; now real body text with a 2px
  accent rule and a bordered "Keep Pro" pill instead of a bare text link.
- **Real field labels added** (`0e1ea60`) - the deferred item from the auth
  audit. Every field was placeholder-only, so a half-filled form had no
  accessible name at all for a screen reader or voice control. Follows the
  app's existing `.lbl` idiom (mono, uppercase, tracked) rather than inventing
  a second label style. Fixed the resulting card-height overflow (labels
  pushed the create-account card to 710px against a 720px viewport) by making
  the password checklist a 2x2 grid instead of four stacked rows.
- **Mobile pass on all of the above** (`0bf7305`). The audit above had only
  ever run at 1280x720 desktop, until asked directly whether mobile was
  covered - it hadn't been, a real gap for an installable PWA. Three defects
  found at 375px: Cloudflare Turnstile's fixed 300px iframe overflowed the
  auth card by 21px, the new password-checklist 2x2 grid was too narrow for
  "At least 12 characters" without wrapping (which would have made it taller
  than the rows it replaced - now single-column below 420px), and the trial
  banner's "Keep Pro" pill was a 29px touch target, under the 44px floor.

Nothing open left over from this arc.

## ✅ Auth defect audit + tour modal fix — ALL LIVE ON PROD (2026-08-01)

Five commits continuing the same day's audit, in a fresh terminal session
picking the project up from `docs/HANDOVER.md`. All merged to `main`
(`d0b1e4d`) — the first four confirmed live via Render deploy
`dep-d9muvvbncjis7394ua50`; the fifth is docs-only, no deploy needed since no
code changed.

- **Four defects the auth-screen pass left behind** (`0a77a6b`). The
  password reveal toggle carried `tabIndex={-1}` - unreachable by keyboard,
  the one thing that control exists to be operated by. The policy checklist
  only ever rendered on `/login`'s sign-up tab; `/reset-password` and
  `/settings` both still dumped one lumped error after a rejected submit -
  the exact failure the checklist was built to fix, live on two of three
  screens that create a password. `isAuthRoute` matched with `endsWith()`,
  and `/ops/login` is a real route that matched it - only branch order
  (`isChromeless` checked first) was saving it from losing its shell.
  `/forgot-password`'s email field had no label at all, missed by the pass
  that fixed `/login`'s eight fields. `.login-back-btn` centred text on
  `<button>` via `min-height: 44px` alone, but not on the two `<a>` tags
  `/forgot-password` uses it on - measured 6px from the top of the box, 24px
  from the bottom.
- **Tour modal fixed height + dead fade-in** (`140be9e`). The visual panel
  had no height of its own, so the whole modal card resized on every Next
  click - 337px for Step1's three metric cards up to 525px for Step5's full
  chart mockup, a 188px jump per step. `minHeight: 290` (measured, not
  guessed) flex-centred brings the swing down to 23px, driven by title/body
  copy length rather than the mockup changing size under the user. Also
  found both the visual panel and text block carried
  `animation: 'ob-fade-up ...'` - not a real keyframe (the actual one is
  camelCase `obFadeUp`); `getAnimations()` confirmed zero animations had
  ever run. Renamed and confirmed live.
- **Comment arithmetic + Supabase project naming** (`74b2c1a`, `711a9f9`,
  `179252d`). The mobile-fix comment's 375px content-box math forgot the
  same media query also trims `.login-wrap`'s padding - real figure is
  311px, not 303px. Separately: both Supabase projects have been called
  `LiquidityHq`/`Automations` throughout the docs - confirmed directly
  against the Supabase API that their real names are `liquidity-hq-prod`/
  `liquidity-hq-dev`, same refs throughout. That collides with the Render
  service names, which use the identical two strings - flagged inline in
  `docs/INFRASTRUCTURE.md` to identify Supabase by ref and say which system
  is meant. Fixed across `HANDOVER.md` plus five more docs.

**Also independently verified this session, no code changes needed:**
T1 (SMTP sender) - a real signup on prod confirmed `noreply@liquidity-hq.com`
delivered clean to inbox, and the full chain (confirm → 14d trial grant →
welcome email) fired correctly. T3 (375px mobile) - genuine `innerWidth: 375`
confirmed `hasHorizScroll: false` and the checklist single-columns for real,
not just under a forced media query. `/reset-password` checklist - exercised
under an actual recovery-link token pulled from a real email, not a
shortcut: 1/4 on a weak password, 4/4 on a strong one.

Nothing open left over from this arc either.

## ✅ Telegram webhook hijack — FIXED + LIVE ON PROD 2026-08-03 (`8dec569`, prod `54150c9`)

**Real prod defect, found by running layer 4 of the QA plan.** Users trying to
connect Telegram intermittently got *"That link has expired or was already
used"* on a perfectly fresh code. Nothing looked broken from the outside —
outbound alerts kept flowing the whole time, only *new connections* died.

Cause: `GET /api/telegram/bot-info` called `setWebhook` whenever the registered
URL did not match its own. That route is unauthenticated and fires on **every
`/alerts` page load**. Telegram allows exactly one webhook per bot, and dev and
prod share `LiquidityHQ_bot`, so any visit to dev's `/alerts` silently
repointed prod's webhook at dev. Real users' `/start` then landed on dev, where
their prod link code does not exist. It flipped back only when somebody
happened to load prod's `/alerts`.

Confirmed live by calling the route against prod then dev and watching the
webhook follow the second call. Restored immediately.

Fix: `bot-info` is now **read-only**. It reports the mismatch via `webhook_ok`
and nothing more. Registration stays in `/api/telegram/setup-webhook`, which is
gated behind `CRON_SECRET` with a comment saying it must not be triggerable by
an arbitrary caller — `bot-info` had been doing exactly that without the gate.

Verified after deploy: prod `webhook_ok: true`, dev `webhook_ok: false`. **The
dev `false` is correct, not a bug** — the bot belongs to prod and dev can no
longer take it. Dev's `/alerts` will show its bot-unhealthy warning banner
permanently until dev gets its own bot.

### ⛔ Root cause still open — dev and prod share one bot (YOUR action)

Dev can no longer *steal* the webhook by accident, but whichever environment
registered last still owns it, and two consequences remain:

1. **Telegram connect cannot be tested on dev at all.** The bot delivers to
   prod, so a `/start` sent while testing dev is answered by prod.
2. This also blocks the last open QA item (`docs/QA_TEST_PLAN.md` layer 4,
   full connect flow), which otherwise needs a second Telegram account.

Fix is one BotFather bot for dev plus its `TELEGRAM_BOT_TOKEN` on
`liquidity-hq-dev`, then a single `setup-webhook` call against dev. Cost: zero.
Until then, treat prod as the only environment where Telegram is real.

## ✅ /alerts had two near-identical lists — one removed 2026-08-03 (`8c8558f`, on `dev`)

User question: *"why do we have two types of list in alerts page? one is recent
fires and recent fired wtf is this?"* — fair, they were genuinely confusable.

**Kept: "Recent Fires" (Alert Track Record).** Backed by `lhq_alert_fires`,
shows win/loss outcomes, and its heading says plainly it is the app's own
record rather than the viewer's.

**Removed: "Recently Fired".** It sat *inside* the Price Alerts card, right
under the user's own alert rows, so the layout implied it listed *their* alerts
firing. It never did. Source was `lib/alertHistory.ts`, a process-local array
shared by every **signed-in** user and wiped on restart — so what you saw
depended on which Render instance answered and how long it had been up. Two
users on the same page could legitimately see different lists, and a restart
emptied it for everybody.

Precision note, because commit `8c8558f`'s message overstates this: the route
was **not** open to the whole internet. It required a valid Supabase token and
answered 401 without one (confirmed live on prod — the route returned 401 right
up until the new build cut over). Sign-in gating is not user scoping, though,
and the route's own comment said so outright: *"the feed still has no per-user
scoping"*. Every signed-in user saw the same shared list.

Not a data leak: private price alerts were already filtered out upstream, so the
buffer only ever held market-wide signals. The problem was purely that a
shared, unreliable, already-duplicated list wore a heading that claimed to be
personal.

Deleted `app/api/telegram/history/route.ts` (its only consumer) and
`lib/alertHistory.ts`; dropped the `recordFires()` call from the alert cron.
`const fired` in that cron was **kept** — `recordFires()` was not its only
reader; it also feeds the run log line and the cron's JSON response.

Nine labels became orphaned (`ALERTS_RECENTLY_FIRED_LABEL`,
`ALERTS_REFRESH_BUTTON`, `ALERTS_NO_HISTORY_TITLE/_SUB`, `ALERTS_AGO_*`,
`ALERTS_AUTO_REFRESH_NOTE`) and are gone from `LABEL_KEYS`. Their `lhq_labels`
rows are left in both projects — never looked up, so harmless. Consequence for
the i18n bookkeeping below: the seeded row count now **exceeds** the registry
count by 9 per locale. Do not treat that gap as missing work.

## ⛔ OPEN — code (mine)

### Coinglass v4 migration — DEFERRED until there is revenue (decided 2026-07-30)

**Owner's decision: do not pay for Coinglass until the product has monthly
revenue or paying users.** Revisit then — not before. Nothing here is waiting on
a technical answer, so do not re-raise it as an open question.

`btcExchangeNetFlow` and the Arena BTC liquidation heatmap are both off. The
`/public/v2/` API they used is retired (HTTP 500 for every symbol, even with the
key), and v4 answers `{"code":"401","msg":"Upgrade plan"}` on the current tier.
There is no free Coinglass API tier — $29/mo to $699/mo, and the tier→endpoint
mapping is **not published**, so when this is revisited, confirm with Coinglass
support that a given tier includes `/api/exchange/balance/chart` *before* paying.
See `docs/INFRASTRUCTURE.md` §5 for the full evidence.

The leaked-key note in that section still applies: the current key was exposed
and deliberately not rotated, since nothing uses it. **Rotate it before ever
upgrading**, or the exposed key inherits whatever plan is bought.

Nothing is broken for users: both call sites failed soft, so the value stayed
null and the heatmap card (rendered conditionally on `btcLiqLevels.length`)
simply stopped appearing. No wrong numbers were ever shown.

To restore once a plan covers it — this is a URL + parsing change, not a
rebuild, because every consumer is still wired:
1. Point the two `coinglass-*` branches in `app/api/proxy/route.ts` at
   `https://open-api-v4.coinglass.com`, and send the key as the `CG-API-KEY`
   header (v2 used `coinglassSecret`).
2. Re-add a `fetchCoinglassData` fetcher in `components/MarketProvider.tsx`
   filling `btcExchangeNetFlow` and `btcLiqLevels` (removed there, with the
   reasoning, in the same commit as this note).
3. Adjust response parsing to the v4 shape.

### API health tracking on `/ops` — PHASE 1 SHIPPED 2026-07-31

**Live in prod.** `lhq_api_health` + `lhq_record_api_health()`, written by the
ingest crons via `lib/apiHealth.ts`, surfaced by the External API Health card
(`app/ops/_cards.tsx`, `app/api/ops/api-health`).

It paid for itself within two minutes of going live: `rss:CryptoSlate` was
returning **HTTP 403 from Render's IP** while returning 200 with ~10 items from
a home connection. Nobody knew - and it had previously been guessed, wrongly, to
be healthy. That failure is invisible to local testing by construction, which is
the whole argument for measuring from where the code actually runs. Left in
place deliberately (see the comment in `lib/newsFeeds.ts`); it is now visibly
Down rather than silently empty.

**Telegram delivery instrumented 2026-07-31** (`telegram:sendMessage`). This
one turned out to be a bug, not just a gap: `tg()` was a bare `Promise.all`
inside `catch {}` that never inspected the response, so every failure Telegram
reports as a *resolved* non-2xx - bot blocked, chat not found, unparseable HTML
in the body - was indistinguishable from a delivered message. Now checks
`res.ok`, keeps Telegram's own `description` as the reason, and emits one
`[alert] fired=... sent=... failed=...` log line per run (the route previously
had no logging at all). Partial delivery counts as a failure; nothing is
recorded on a run that attempted no sends, so a quiet tick cannot mark the
source healthy. Verified against real traffic: log `sent=1 failed=0` and the
health row `"1 sent"` agree to the second.

**PHASE 2 SHIPPED 2026-07-31.** Live in prod: 32 sources tracked, reading
29 healthy / 2 degraded / 1 down on the card.

Added: `binance:klines`, `bybit:klines` (via `lib/ribbonCandles` - the single
funnel the alert cron and `/api/alerts/preview` share), `binance:funding`,
`bybit:funding`, `yahoo:{oil,dxy,spx,gold,jpy}` per symbol, `cmc:global-metrics`,
`cmc:listings`, `coinbase:BTC-USD`, `er-api:USD`, `google-trends:bitcoin`,
`sosovalue:etf-flows`, `brevo:smtp`, `webpush:vapid`, `xai:grok`.

Two new helpers in `lib/apiHealth.ts`. The crons keep calling `recordApiHealth`
directly (once a minute, one write per source costs nothing); the routes use
`trackHealth`/`reportHealth`, which coalesce per source - a state change writes
immediately, a repeat waits 30s - because those run per page load. The write is
not awaited: Render is a long-lived Node process, so the floating promise
completes without putting a Supabase round trip in front of every response.

**It found two more silently-dead dependencies on the first run, and both
reproduce from Render** (unlike CryptoSlate, which only fails from Render, these
fail everywhere - so it is the dependency, not the IP):
- `google-trends:bitcoin` - "trends explore blocked"
- `sosovalue:etf-flows` - no response from either host
Both fed the Grok prompt context as `googleTrends` / `etfFlows`, so every AI
analysis had been running with those fields blank. **RESOLVED 2026-08-01: both
fields dropped from the prompt entirely** rather than replaced. They were never
worth a new dependency - a fallback string (`'AI will search'`) meant the model
was being told to go look it up anyway, so removing them costs nothing and stops
the prompt claiming context it does not have. Both sources stay in the
suppression list so they do not park red rows on the card. If a real ETF-flow or
search-interest source ever turns up, that is a new feature, not a repair.

Also surfaced: `finnhub:crypto` reporting "no articles (key missing or upstream
down)" while `finnhub:general` returns 100. **Recovered on its own** - reading
healthy at 94 items on 2026-08-01. It was upstream flakiness, not a missing key,
which is also why the alert threshold is 3 consecutive failures rather than 1.

**Coinglass deliberately NOT tracked** - known dead by decision with no callers,
so it would park two permanently red rows and train the eye to ignore red. Add
it as part of the v4 migration.

Correction to an earlier note here: Web Push was described as needing special
handling because `dispatchPush` is `void`-ed and "may not finish before the
process is frozen". That was serverless reasoning applied to a persistent Node
process - on Render the floating promise does complete. It still reports from
inside `dispatchPush` rather than from a tally in the handler, but only because
the handler has already returned by then. A 410 counts as an expired
subscription, not a delivery failure.

**ALERTING SHIPPED 2026-07-31** (`lib/healthAlert.ts`). Emails the owner when a
source hits `consecutive_failures >= 3`, and again when it recovers. Rides the
hourly econ-snapshot cron - it needed an hourly schedule and that was the only
hourly cron; its own route plus a new cron-job.org entry is exactly what
`api/ops/spike-alert` did, which was built 2026-07-25, never wired, and is still
dead. **If that cron is ever deleted or repointed, health alerting stops
silently** - the stale calendar would be the visible symptom, the missing alerts
would not be.

Threshold is 3 in a row, matching the card, deliberately not one failure -
Finnhub flaps (~3 in 50 samples as isolated ticks) and would otherwise page
every few hours. Does NOT alert on staleness: most sources are only written when
a user-facing route is hit, so with no overnight traffic they stop reporting,
which is unmonitored rather than broken and must not send email at 4am.

Verified in prod, every branch: down detected and emailed (landed in the inbox,
not spam, from `noreply@liquidity-hq.com`); a repeat run while still down stayed
silent; a suppressed source was dropped from state. Recovery was verified on dev.

Two things learned doing it, both worth keeping:
- The Brevo deliverability worry recorded elsewhere in these docs is **stale**.
  It now sends from a real domain, not a freemail address, and reached Gmail's
  inbox first try. Applies to the welcome and trial-reminder emails too.
- `updated_at` on `lhq_app_config` is NOT maintained by these writes and there
  is no trigger, so it is useless as a "did this run" signal - it sat unchanged
  across two later writes. Compare the value, not the timestamp. The same trap
  already bit `structure_signal_dedup` earlier the same day.

Suppression list lives in `app_config.api_health_alert_suppress` and is seeded
with the three known-dead sources. Edit the array to add or remove - no deploy.

Original rationale, kept because it is the design constraint:

Owner's #1 follow-up after the news push-delivery work. There was no single
place that answered "which of our external APIs is actually working". The gap
was real and this project had already been bitten by it more than once:

- Three `feeds.reuters.com` and two `feeds.apnews.com` RSS feeds sat in the feed
  list silently returning nothing (dead at DNS) — nobody could have known
  without hand-testing each URL.
- `truthsocial.com/@realDonaldTrump.rss` returned **200 OK** while serving an
  HTML app shell with zero `<item>` elements. A naive uptime check would call
  that healthy. Status code alone is not health.
- Global Macro Context failed persistently in the past and only surfaced after
  a user noticed, which is what prompted wiring `apiError()` into GlitchTip.
- `FINNHUB_KEY` being empty produces an empty result, not an error.

What it should cover (every external dependency, not just the noisy ones):
Finnhub, the RSS feed list, Coinglass, CoinMarketCap, xAI/Grok, DeFi Llama,
Yahoo Finance, FRED, ForexFactory, Binance/Bybit, Telegram, Brevo, Supabase.

Design decisions, all now implemented in phase 1 — keep them when extending:
- **Health is semantic, not HTTP status** — "did we get usable rows back", not
  "did it return 200". TruthSocial is the proof, and CryptoSlate's 403 is the
  reason the check has to run from Render rather than a laptop.
- Per-source last-success and last-failure timestamps plus a rolling window.
  `last_ok_at` is deliberately preserved across failures: the widening "last ok
  3d ago" gap is what makes a dead source obvious.
- The ingest crons are the write points — they already touch every feed once a
  minute, so per-source outcomes cost nothing, and a separate prober would
  re-hammer the same endpoints for worse data.
- Read/modify/write of the window and the failure counter lives in SQL, not app
  code: two crons can report the same source in the same minute and would race.
- Staleness outranks the last outcome. A source that last succeeded but stopped
  being reported is unmonitored, not healthy.
- `recordApiHealth` never throws. Health tracking that can break the job it
  measures is worse than none.
- `docs/feature-inventory.md` has the full dependency list for phase 2.

### "Check now" button on `/alerts` — FIXED and live in prod (2026-07-31)

Was returning **401 on every press** since the cron routes were made fail-closed
(`7cfbb18`): it called `GET /api/telegram/alert` directly, and a browser has no
cron secret. Nobody noticed because a broken button just looks like a failed
check.

Fixed with a separate read-only route, `app/api/alerts/preview` - NOT by
loosening the cron gate, which would re-open an endpoint that can burn AI budget
and message every connected chat on demand. Reads the caller's Supabase JWT,
answers for that user only, Pro-gated, 4/min per user. Sends nothing and mutates
nothing; there is no send path in the file and it does not import the alert
route, so it cannot reach `tg()` or the dedup maps.

The dedup point is the one worth remembering: those maps are what stop an
already-announced signal firing again, so a preview that consumed a slot would
SUPPRESS the real alert that followed and the user would silently never get it.
Any future "preview"/"test" surface must keep that property.

Scope is the EMA rule + market-structure breaks (the two with per-coin/timeframe
settings on that page, both pure functions over candles). The UI carries a scope
line saying so - without it, "No conditions active right now" reads as a claim
about every alert type. Verified in prod with a real Pro session: returns only
the user's own coins and enabled timeframes.

**Watch as usage grows:** each press fans out to (coins x timeframes) kline
fetches - up to ~50 at the page's own caps - and the limiter is the in-memory
one in `lib/rateLimit.ts`, which assumes Render's single long-lived process. Two
things break together if the service is ever scaled to multiple instances: the
per-user limit becomes per-instance, and Binance/Bybit rate-limit exposure rises
with it. Neither matters at one user; both need revisiting before real traffic.

### ✅ PEPE/BONK chart axis - FIXED (2026-08-01), live on prod

Root cause confirmed: the EMA ribbon (200-period especially) was registered as
a klinecharts **indicator**, and indicators contribute to the main pane's
y-axis range - so on a fast timeframe where price barely moves, the long EMA
sitting far from candles dragged the axis to fit it, squashing the candles
into the middle. Two earlier hypotheses this session (analysis overlay,
pricePrecision) were tested live and ruled out before landing on this one.

Fixed by rewriting the EMA ribbon from an indicator to a plain line **overlay**
(`registerOverlay('emaRibbonLine', ...)` in `components/KLineProChart.tsx`),
which draws over the pane without feeding its range calc. `overrideOverlay`
updates points in place on new bars/live ticks instead of remove+recreate.
Verified on the bug case (PEPE 15m - axis now tracks candles) and the
regression case (BTC 1h - unaffected), plus coin-switch cleanup and live-tick
paths. Merged to `main` (`6a44b00`), deployed (`dep-d9n3666417fc73cio38g`,
live), prod HTTP 200 confirmed post-deploy.

### The 1000x fix flushed out four separate bugs - worth remembering the shape

One root cause (Bybit quoting PEPE/BONK per 1000 tokens, normalised in two
places and missed in four) surfaced three more the moment it was fixed, because
correct-but-tiny numbers finally reached code that had never seen them:

1. `lhq_alert_fires` compared raw against 1000x prices - 22 rows at +-100,000%,
   dragging the Track Record average to -126.70% against a +0.27% median.
2. EMA and structure alerts quoted PEPE entry/SL/TP at 1000x the ticker.
3. Three price formatters floored too shallow: the structure card printed `$0`,
   the alert body would have printed `$0.0000`, the S/R chip printed `$0.00003`
   for a level at 0.0000271.
4. The chart could not render the true per-token scale at all.

The lesson worth keeping: fixing a magnitude bug does not end at the fix. Every
consumer downstream had been silently calibrated to the wrong magnitude, and
each one has to be re-checked against the corrected value. Grep for the symbol
prefix, then check every formatter and every stored price on the path.

### What the outcome data said, and its limits (2026-08-01)

First real measurement across 6,201 resolved fires, after the PEPE/BONK unit
corruption was cleaned out:

| rule | n | win rate | avg 24h |
|---|---|---|---|
| ema_signal_1d | 51 | 80.4% | +13.36% |
| ema_signal_4h | 299 | 59.2% | +2.45% |
| ema_signal_1h | 677 | 61.3% | +1.27% |
| ema_signal_30m | 1218 | 60.5% | +1.11% |
| **rsi** | 592 | **52.7%** | **+0.31%** |
| ema_signal_5m | 782 | 51.5% | +0.11% |
| ema_signal_1m | 1983 | 49.6% | -0.01% |
| whales | 216 | 48.1% | **-0.39%** |

This is what justified removing the RSI double-count - momentum was carrying ~45
of ~95 directional weight while winning barely more than a coin flip.

**Three caveats that must travel with these numbers:**
- 24h horizon biases toward slow signals. A 1m alert is not meant to be held a
  day, so the timeframe ranking is partly measurement artifact. RSI vs EMA-1h is
  a fair comparison though - same horizon.
- **12 days, one market regime** (Jul 19-31), no out-of-sample check.
  `ema_signal_1d` at n=51 is as likely a trending fortnight as an edge.
- `ema_signal_1m` is the largest sample and has no edge at 24h; `whales` is
  negative. Neither has been acted on.

### ✅ CI/CD pipeline — SHIPPED (2026-08-01)

`.github/workflows/ci.yml` added: on push to `dev`/`main`, checkout + Node 24 +
`npm ci` + `npx tsc --noEmit` + `npm run build`. Deliberately scoped narrow -
no test step (none exist yet), no auto-deploy wiring (Render's manual-trigger
convention is intentional, left alone). First push was rejected (PAT lacked
`workflow` scope) - fixed via a credential-manager reauth, then pushed clean.
Gate is live on both branches.

## ✅ Environments finally isolated — dev has its own bot (2026-08-04)

Dev now runs `@Liquidity_hq_dev_bot` with its own `TELEGRAM_BOT_TOKEN` and its
own registered webhook. Prod keeps `LiquidityHQ_bot`. **Both report
`webhook_ok: true` at the same time**, which was structurally impossible before -
Telegram allows exactly one webhook per bot, so whichever environment registered
last owned it and the other was simply dead.

This unblocked the last open QA item (`docs/QA_TEST_PLAN.md` layer 4), which then
passed end to end - and in passing found the RLS bug below.

Dev also got its own `CRON_SECRET` (a different value from prod's, deliberately).
That was needed to call `setup-webhook` on dev, and it incidentally makes the
other cron-gated routes callable there. Nothing is *scheduled* on dev -
cron-job.org still points only at prod, which is what stops dev firing real
alerts.

### ⚠️ Prod bot token was rotated the same day

While opening BotFather to create the dev bot, prod's live token was exposed on
screen. It was revoked and rotated immediately, `TELEGRAM_BOT_TOKEN` updated on
`liquidity-hq-prod`, and the webhook re-registered with `?force=1`.

Two things worth remembering from that:
- **Revoking a token clears its webhook.** Outbound alerts kept working (they use
  the token directly) but *incoming* `/start` was dead until re-registration.
  After any token rotation, re-run `setup-webhook?force=1`.
- `?force=1` matters: a plain call short-circuits when the URL already matches
  and would skip re-applying `TELEGRAM_WEBHOOK_SECRET`.

## ⛔ OPEN — dev RLS drift, one table fixed, worth a periodic re-check

`lhq_dev_user_settings` had RLS **enabled with zero policies** - deny-all, not
allow-all. Service-role clients (webhooks, cron, `/api/*`) bypass RLS, so writes
worked and every server-side check passed; only the browser was blocked, and it
got empty results rather than an error.

Symptom: Telegram connect wrote `telegram_chat_id` successfully while `/alerts`
insisted "Not connected" through a full reload. Masked for a long time because
`SettingsProvider` caches to localStorage, so any browser that had ever read the
row kept showing the cached copy.

Fixed by migration `add_missing_rls_policies_lhq_dev_user_settings`, mirroring
prod's three policies exactly. Prod was always correct - this was dev drift.

A full sweep of all 28 `lhq_dev_*` tables found no other genuine gap: the dev
zero-policy list matches prod's (server-only tables where deny-all is intended),
and `lhq_dev_price_alerts`' single `for all` policy is equivalent to prod's four
per-command ones. The comparison query is in `docs/QA_TEST_PLAN.md` - worth
re-running after any schema work on dev, since this drift was silent.

## ❓ OPEN — YOUR action (can't do from code)

### 1. Supabase Pro — see the decision item at the top of this file

Still Free, still zero backups. Parked until revenue by your call; listed here
only so it is not mistaken for handled.

### 2. Nothing else is blocking

The dev-bot item that used to sit here is done (above). No QA item is waiting on
you.

### Branch/deploy state (2026-08-04)

`dev` = `32b2e86`, `main` = `40a5096` (a merge of the same content), nothing
unmerged. Prod live on `40a5096`, dev on `32b2e86`, CI green on both.

## 🔭 DEFERRED — tied to unfinished payment feature

Moved to `pendings/LEMONSQUEEZY.md` (LemonSqueezy variant price, the
`custom_data.user_id` binding gap, webhook idempotency) — not urgent, payments
aren't live yet.

## ✅ Pricing analysis + repricing — DONE 2026-07-24

The pricing analysis doc (removed 2026-07-25, fully resolved - see git
history for the original write-up) was rewritten with real xAI grok-4.3 rates
(console.x.ai/models, cross-validated against this account's actual invoice)
— the old output rate assumption was **6× too high** ($15/M assumed vs
$2.50/M real). That correction, plus a real-competitor-pricing check
($16-$50/mo is normal for this market), led to a final decision — **all
implemented and verified live**, not just analyzed:

- `AI_GLOBAL_DAILY_MAX = 2,000` — set on both Render services.
- **Pro price $15 → $25/mo** — updated everywhere: `/upgrade`, landing page
  (4 locales), DB-backed checkout CTA label (5 locales, both Supabase
  projects), `lib/labelDefaults.en.json` regenerated.
- **Pro caps trimmed** in `lib/limits.ts`: quick 50→40, deep 25→18, chat
  100→75, search 25→18, briefing 10→8, one-shot tools 25→18 each.
- **Free caps trimmed**: quick 7→5, deep 5→3, chat 15→10, search 5→3,
  briefing 3→2, tools 5→3 each. Landing-page hand-typed copy (4 locales)
  updated to match.
- Result: a fully cap-maxing Pro account now costs an estimated **~$42/mo**
  against $25 revenue (1.67× underwater — down from the original 19×).
  Free worst-case dropped to **~$6.54/mo** for $0 revenue (was ~$54).

**Live on prod** — verified in a real browser against
`liquidity-hq.onrender.com/upgrade`: `$25/mo` and the trimmed caps both render
correctly.

## ✅ Second repricing — worst case now PROFITABLE (2026-07-27, on `dev`)

Recomputing straight from `lib/limits.ts` + `lib/aiCost.ts` gave a worse
number than the ~$42 above: **~$52.01/mo** worst case (303 plain calls/day ×
$0.0041 + 54 search calls/day × $0.0091), i.e. **2.08× underwater** at $25
revenue. Fixed by attacking where the ceiling actually sat.

Diagnosis: **43% of the worst-case bill was the 11 one-shot tools**, whose
independent 18/day caps multiply out to a 198-call/day ceiling — for tools
nobody runs 18 times a day. Trimming each per-tool number would have made
every tool feel stingy for no structural gain, so they were **pooled**
instead.

- **Shared tool pool**: `AI_LIMITS.pro.toolPool = 25`/day across all 11
  one-shot tools; free stays per-tool (`toolPool: null`) so a free user can
  still sample every tool. A Pro user who only runs SMC snapshots now gets
  **25/day, up from 18**, while the ceiling drops — more generous per tool
  AND cheaper.
- `increment_ai_usage()` gained `p_pool_limit` + a `tool_pool_count` column,
  checked/incremented atomically alongside the per-tool counter. New `-2`
  sentinel = pool exhausted, distinct from `null` (per-tool) and `-1`
  (global breaker), so the 429 names the cap that actually blocked.
- Other caps trimmed: Pro quick 40→30, deep 18→10, chat 75→50, search
  18→10, briefing 8→4. Free chat 10→5, free tools 3→2.
- **New worst case: ~$22.62/mo vs $25 revenue — profitable.** Realistic
  usage (10-30% of caps) lands at 70-90% margin. Free worst case
  $8.24 → **$6.12/mo**.
- `/upgrade` now advertises the pool too (new `UPGRADE_PRO_FEATURE_TOOL_POOL`
  label, `{tools}` interpolated from `limits.ts`) — the landing page already
  did, and the two pricing surfaces must not disagree.

**Migrations already applied to BOTH Supabase projects** (`20260727e`,
`20260727f`, `20260727g`) and verified by direct SQL: pool binds across
different tools; a pool-blocked call refunds its tool column without
over-counting the pool; a global-cap block refunds both; a per-tool-cap block
consumes no pool slot. Also smoke-tested over real HTTP against PostgREST with
the exact argument names `lib/aiUsage.ts` sends (returned `1, 2, -2` against a
pool of 2), so the wiring is proven end to end, not just in SQL.

### Pre-ship alignment audit (2026-07-27) — 2 fixes it forced

1. **Tool pool was invisible in the UI.** `tool_pool_count` existed in the DB
   but never reached the client — `GrokUsageInfo` and `/api/grok` both stopped
   at the same 5 fields. Since pooling made the effective tool ceiling much
   tighter (198/day → 25/day), a user spreading ~6 runs over ~5 tools was fine
   before and is blocked now, with a hard 429 as the first warning. Plumbed
   through as `tool_pool_used`/`tool_pool_limit` + a 6th "Tools" ring
   (Pro-only; the component filters out any ring whose limit is 0, which also
   makes a pre-field payload render nothing instead of `NaN`). Modal widened
   400px → 460px so all six fit one row.
2. **`components/GrokChat.tsx` reported the wrong cause.** It discarded the
   server message and hardcoded "No chat messages left today", so a circuit-
   breaker trip told users their personal quota was gone while the meter beside
   it showed quota left. Now uses the server's wording.

Also fixed stale comments the audit surfaced: `app/api/grok-chat/route.ts`
restated the caps in its docblock and had gone stale across **two** repricings
(claimed Free 15 chat + 5 search, Pro 100 + 25); `app/api/ops/ai-cost/route.ts`
said "8 one-shot tools" (there are 11); `lib/aiCost.ts` cited a deleted doc.

**Verified in the real browser signed in as Pro:** usage meter shows 0/30 and
1/10, the usage modal shows all six rings (30 / 9 / 49 / 9 / 4 / 24 remaining)
matching the API payload exactly, no console errors. `/upgrade` and the landing
page verified signed-out in all locales. Swept all 2,436 label keys — zero
hardcoded caps, everything templated.

Code is committed + pushed to `dev` (through `9a5a5e0`) — **not yet merged to
`main`/prod.**

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru. Pending: vi, pt-BR, tr, es, id. Do not resume proactively.

**Those locales have since fallen behind (measured 2026-08-03).** The
"2370/2370" figure recorded here was true when written; `en` has grown since
and the translated locales did not follow. Live counts, identical in dev and
prod:

| locale | rows |
|---|---|
| en | 2570 |
| ko / zh / ar / ru | 2416 each |

**154 keys behind per locale** when measured. Nothing is broken -
`app/api/labels/route.ts` layers English underneath every locale, so the gap
renders as English rather than raw keys, which is why it went unnoticed.

**✅ The two worst surfaces are now done (2026-08-03)** - migration
`20260803g_labels_i18n_trial_banner_telegram.sql`, applied to both projects:

- **`TRIAL_BANNER_*`** (5 keys) - the trial countdown, i.e. the main conversion
  surface. Was counting a paying-trial user down in English.
- **`ALERTS_CONNECT_*`** (18 keys) - the whole Telegram connect wizard, the
  onboarding flow the FAQ walks users through.

23 keys x ko/zh/ar/ru = 92 rows. Both surfaces now at 24/24 in all five
locales. Verified live on the dev deploy at 7 days remaining:
`프로 체험판 전체 이용 가능 - 7일 남음` and
`النسخة التجريبية PRO وصول كامل - الأيام المتبقية: 7`.

Two things worth carrying forward for whoever does the rest:

- **Placeholders are load-bearing.** `{days}` and `{time}` are interpolated by
  `lib/labels.ts`; drop a brace and the user sees the literal token. The
  generator guards this - keep that guard.
- **Arabic plurals.** Arabic has four plural forms and each label is one
  template for every count, so an inflected phrase is wrong somewhere no matter
  what. `TRIAL_BANNER_DAYS_LEFT` uses a label:value construction
  (`الأيام المتبقية: {days}`) which sidesteps agreement entirely. Russian uses
  the abbreviated `дн.` for the same reason. Prefer that shape over a
  grammatically inflected one for any count-bearing string.

**Still outstanding: ~131 keys per locale** across the rest of the app, plus the
`LOGIN_LEGAL_*` and `CONSENT_*` keys added today (English-only by design, and
now visible as English islands on an otherwise translated login page).

**Separately: the language switcher offered locales that have zero rows.**
`vi`, `pt-BR`, `tr`, `es`, `id` were all selectable in the UI with no
translations in either project, so choosing one silently rendered English.
**✅ Fixed 2026-08-03** - `lib/locales.ts` now exports `AVAILABLE_LOCALES`
(the seeded five) and both pickers use it. `SUPPORTED_LOCALES` deliberately
stays complete: it is the validation list, so a preference already saved as
`tr` still resolves to English instead of erroring. Re-adding a language is a
one-line change to `AVAILABLE_LOCALES` once its rows land.

---

## ⛔ OPEN — `/api/ath` is rate-limited by CoinGecko on the QA service

**Found 2026-08-05** while verifying the new `qa` staging environment.

| Host | `/api/ath` |
|---|---|
| liquidity-hq.com (prod) | **200** |
| liquidity-hq-qa.onrender.com | **502** — `{"error":"CoinGecko 429"}`, three attempts |

`app/api/ath/route.ts` calls CoinGecko's keyless public API, which rate-limits
per IP. The QA service is a new Render instance sharing the same egress pool, so
it arrives at a bucket that is already close to spent.

**Same shape as the Binance fan-out**: a keyless public upstream, a per-IP
limit, and no server-side cache in front of it. `lib/apiCache.ts` already exists
and is used by `/api/funding` and `/api/proxy`; `/api/ath` does not use it. A
`cached()` wrapper with a long TTL is the obvious fix - all-time-high prices are
about as slow-moving as data gets, so a multi-hour cache costs nothing and
removes almost all the requests.

Not blocking QA: the ATH figure is one number on the page and it fails soft.
Worth fixing because a third environment makes every keyless per-IP upstream in
this app one step closer to its limit, and ATH is just the first one to show it.

---

## ⛔ OPEN — QA needs its own Telegram bot (owner decided option B, parked)

**Decided 2026-08-05, deferred to when QA needs it.**

`liquidity-hq-qa` currently holds **dev's** `TELEGRAM_BOT_TOKEN`,
`TELEGRAM_CHAT_ID` and `TELEGRAM_WEBHOOK_SECRET`, copied over when the service
was configured from dev's environment.

**It is safe today only because `CRON_SECRET` is unset on qa.** Registering a
webhook goes through `/api/telegram/setup-webhook`, gated by `checkCronAuth`,
which fails **closed** with no secret configured. Verified: that route returns
`401 {"error":"Unauthorized"}` on qa.

**So: do not set `CRON_SECRET` on qa until it has its own bot.** Doing so hands
qa the ability to point dev's bot at itself and silently steal every alert —
the same failure that already cost a day on this project (see the webhook
hijack section above).

### What option B needs, when it is picked up

1. **BotFather → `/newbot`**, named `Liquidity_hq_qa_bot` to match the dev
   naming (`Liquidity_hq_dev_bot`).
2. On `liquidity-hq-qa`, set **all three fresh, none copied**:
   - `TELEGRAM_BOT_TOKEN` — the new bot's
   - `TELEGRAM_WEBHOOK_SECRET` — new random string
   - `CRON_SECRET` — new random string, **different from dev's and prod's**.
     Safe at this point, and required: it is what unlocks
     `/api/telegram/setup-webhook`.
   `TELEGRAM_CHAT_ID` can stay — it only says where alerts land, and messages
   will visibly come from the new bot.
3. After the redeploy, register the webhook:
   `GET /api/telegram/setup-webhook?secret=<the new CRON_SECRET>` — expect
   `webhook_ok: true`.

**Consequence to accept deliberately:** giving qa a `CRON_SECRET` also makes
`/api/telegram/alert`, `/api/macro-alert` and `/api/signals/track` triggerable
there, so QA runs can fire real alerts into the chat. That is the point of
option B, but it is a change in what a QA session can set off.

**Until then**, Telegram is only half-testable on qa: outbound messages reach
the real dev chat, inbound (`/start`, account linking, bot commands) never
arrives because the webhook belongs to dev.
