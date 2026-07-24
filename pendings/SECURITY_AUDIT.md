# Security & Cost-Abuse Audit — LiquidityHQ

**Date:** 2026-07-24  **Scope:** third-party API cost exposure, signup/trial
abuse, traceability, general exploit surface.  **Method:** live target review,
not theoretical — enumerated every metered code path, traced each from trigger
to upstream call, verified DB/RLS state directly against prod Supabase
(`qdpwhnvmhqgzijuwopso`).

> ⚠️ **READ FIRST — dev/prod split.** Most fixes referenced below are committed
> to the `dev` branch. **Prod runs `main`.** DB changes (usage-cap function,
> trial dedup, grants, RLS) and env secrets (`CRON_SECRET`,
> `TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`) ARE live on prod, but the
> prod **code** does not yet call the new caps/validation. **Until `dev`→`main`
> merges, prod's cost-abuse surface is only partially closed.** Every "FIXED"
> below means "fixed on dev"; prod status is called out where it differs.

---

## 1. Metered / third-party API code-path checklist (Step 1 coverage)

Every backend route that ultimately calls a paid or rate-limited third party.
Auth = requires Supabase bearer token. Cap = per-user daily quota. RL = per-IP
rate limit. Cache = response cache bounding upstream calls.

### xAI / Grok (PAID, per-token billing) — the primary cost risk

| # | Route | Auth | Protection (dev) | Protection (PROD/main today) |
|---|-------|------|------------------|------------------------------|
| 1 | `app/api/grok/route.ts` | yes | Cap (atomic, deep/quick) | Cap (pre-existing) |
| 2 | `app/api/grok-chat/route.ts` | yes | Cap (atomic, chat/search) | Cap (pre-existing) |
| 3 | `app/api/briefing/route.ts` | yes | Cap (atomic, briefing) | Cap (pre-existing) |
| 4 | `app/api/thesis-check/route.ts` | yes | **Cap (new)** | **UNCAPPED** |
| 5 | `app/api/strategy-research/route.ts` | yes | **Cap (new)** | **UNCAPPED** |
| 6 | `app/api/shadow-account/route.ts` | yes | **Cap (new)** | **UNCAPPED** |
| 7 | `app/api/behavioral-bias/route.ts` | yes | **Cap (new)** | **UNCAPPED** |
| 8 | `app/api/pine-script/route.ts` | yes | **Cap (new)** | **UNCAPPED** |
| 9 | `app/api/hypotheses/[id]/analyze/route.ts` | yes | **Cap (new)** | **UNCAPPED** |
| 10 | `app/api/token-unlock/route.ts` | yes | **Cap + strict input (new)** | **Cache-key bypassable** |
| 11 | `app/api/smc-snapshot/route.ts` | yes | **Cap + strict input (new)** | **Cache-key bypassable** |
| 12 | `app/api/dry-powder/route.ts` | yes | Cache (fixed key, 1h) | Cache (fixed key) |
| 13 | `app/api/macro-context/route.ts` | yes + Pro | Cache (fixed key) | Cache (fixed key) |
| 14 | `app/api/onchain/route.ts` | yes + Pro | Cache (fixed key) | Cache (fixed key) |

Also xAI-calling on a schedule (not user-triggered): `app/api/telegram/alert`
(cron-gated), `app/api/macro-alert` (cron-gated).

### Crypto price / market-data providers

| Route | Provider | Paid? | Auth | Protection (dev) |
|-------|----------|-------|------|------------------|
| `app/api/cmc/route.ts` | CoinMarketCap pro-api | **PAID** | no | RL 20/min/IP + cache + **user-attributed (new)** |
| `app/api/proxy/route.ts` | Coinglass (**metered**) / SoSoValue / Google Trends | mixed | no | RL 20/min/IP + cache + **user-attributed (new)** |
| `app/api/macro/route.ts` | Yahoo Finance | free | no | **RL (new)** + 60s cache |
| `app/api/forex/jpy/route.ts` | Yahoo Finance | free | no | RL + cache |
| `app/api/ath/route.ts` | CoinGecko | free | no | RL + cache |
| `app/api/cycle/route.ts` | CoinGecko | free | no | RL + cache |
| `app/api/funding/route.ts` | Binance/Bybit | free | no | RL + cache |
| `app/api/coinbase-price/route.ts` | Coinbase | free | no | RL + cache |
| `app/api/signal-accuracy/route.ts` | Bybit | free | no | cache (10min), no RL |
| `app/api/signals/track/route.ts` | Binance/Bybit | free | cron | cron-gated |

### News providers

| Route | Provider | Paid? | Auth | Protection (dev) |
|-------|----------|-------|------|------------------|
| `app/api/news/finnhub/route.ts` | Finnhub | **metered** | no | RL + **user-attributed (new)** |
| `app/api/news-rss/route.ts` | RSS feeds | free | no | RL + cache |
| `app/api/econ-calendar/route.ts` | Finnhub (primary) + ForexFactory/Fed/computed (fallback) | **metered** (shares `FINNHUB_KEY`) | no | RL + **user-attributed (new)** |

**Coverage confirmation:** 14 xAI paths + 10 market-data + 3 news = 27 metered
paths enumerated. Highest $ risk: xAI routes (#1–11) and CMC/Finnhub/proxy
(coinglass)/econ-calendar (all metered key quotas, all now user-attributed —
see F8). Everything else is a free provider where abuse risks IP-blocking of
our outbound address rather than a bill.

---

## 2. Findings by priority objective

### P0 — #1 Uncapped third-party API cost exposure

**F1 (CRITICAL, prod). Six xAI routes + two cache-bypass routes are uncapped on
prod.** Routes #4–11 above. On `main` (prod) they require auth but have NO
per-user cap. Exploit: any signed-in user (incl. a free 14-day-trial account)
scripts `POST /api/thesis-check` (or strategy-research, shadow-account,
behavioral-bias, pine-script, hypotheses/analyze) in a tight loop → unbounded
grok-4.3 calls → unbounded xAI bill. `token-unlock`/`smc-snapshot` add a second
vector: vary the `symbol`/`asset` string to miss the cache every time.
- Fix status: **FIXED on `dev`** — shared `lib/aiUsage.ts` reserves an atomic
  daily unit before the upstream call; strict `^[A-Z0-9]{2,10}$` input on the
  cached routes. **Not yet on prod — merge `dev`→`main`.**

**F2 (HIGH → fixed). TOCTOU race on the daily caps.** The pre-existing capped
routes read-then-wrote usage non-atomically; two concurrent requests could both
pass the check. Fix: single atomic `UPDATE … WHERE col < limit RETURNING` in
the `increment_ai_usage()` Postgres fn (live on prod DB; called by dev code).

**F3 (MEDIUM, prod). `macro`, `telegram/detect`, `telegram/bot-info` had zero
rate-limit/auth.** `macro` fired 5 Yahoo calls per request with `cache:'no-store'`.
Exploit: unauthenticated loop → hammer Yahoo, get our egress IP throttled.
Fix: per-IP `rateLimit()` added on `dev`; `macro` switched to a 60s cache.

**F4 (LOW). No GLOBAL ceiling / circuit breaker on xAI.** Per-user caps do not
stop a *fleet* of farmed accounts each spending its daily allotment (ties to
P0-#2). There is no global daily xAI counter or kill-switch. Not yet built —
see §3 recommendation.

### P0 — #2 Signup & trial abuse

**F5 (HIGH). Unlimited trials via distinct real inboxes; no CAPTCHA/velocity
control.** Signup is client→Supabase (`signInWithOtp`/OAuth, `app/login/page.tsx`)
with no app-side choke point. Magic-link *does* prove inbox ownership (so
"no email verification" is partially mitigated — an unconfirmed email can't
complete signin), but nothing caps how many *distinct* inboxes one actor
registers. Exploit: script/registration farm creates N accounts → N fresh
14-day Pro-feature trials → N × per-account xAI allotment.
- Partial fix (live on prod DB): `lhq_grant_signup_trial()` now dedupes by
  **normalized email** (`lhq_trial_claims`, Gmail dot/+tag folding) → one real
  inbox = one trial ever. This kills the *alias* trick (name+1@, na.me@).
- **Residual (not code-fixable): distinct real inboxes.** Needs Supabase Auth
  CAPTCHA (Turnstile/hCaptcha) + disposable-domain blocklist — see §4.

**F6 (HIGH → fixed). Over-broad table grants = RLS was the only barrier to
self-serve Pro.** `anon`/`authenticated` held INSERT/UPDATE/DELETE/TRUNCATE on
`lhq_user_subscriptions` + `lhq_trial_claims`. RLS default-deny blocked writes,
but one policy slip = free Pro for everyone; TRUNCATE isn't even RLS-guarded.
Fix: grants revoked (live on prod DB). Verified no legit path used them (all
writes go via service-role or the SECURITY DEFINER trigger).

**F7 (MEDIUM → fixed). Trial-claims ledger not durable.** FK was
`ON DELETE CASCADE`: deleting an abuser's account wiped their trial-claim →
re-opened the trial. Fix: `ON DELETE SET NULL` (live on prod DB). Also
null-email signups now grant no trial (closes phone/anon-auth farming).

### P1 — #3 Traceability & observability

**F8 (MEDIUM). Metered-call logging exists for xAI but not for non-xAI, and has
no cost/global view.**
- What exists: `lhq_grok_usage` (per-user, per-type, per-day counts) + `/ops`
  admin console (`/api/ops/ai-cost` shows top-5 users by usage + call-type
  volume; `/api/ops/users/[id]` shows a 14-day per-user series). So an xAI spike
  IS traceable to accounts after the fact. Ban/grant/revoke all audit to
  `lhq_admin_audit_log`.
- Gaps: (a) no estimated **$ cost** column — only raw counts; (b) no **global
  daily total** or spike alert — you'd notice the xAI spike from the bill, not a
  dashboard. See §5.
- (c, fixed) non-xAI metered calls (CMC, Finnhub, and — once audited for the
  same shape — Coinglass via `proxy` and Finnhub-via-`econ-calendar`) were
  IP-rate-limited but not attributed to a user. Now fixed on all four:
  `MarketProvider`/`NewsProvider`/`EconCalendarWidget`/`ConfluenceScore` attach
  a bearer token when the caller is signed in, the routes verify it
  server-side and log the real user id (falling back to `anon`) alongside IP —
  auth stays optional, all four routes remain usable signed-out. The other
  free-provider routes (macro, coinbase-price, cycle, ath, forex/jpy, funding,
  news-rss) were checked and correctly excluded — no vendor key/quota to
  attribute.

### P1 — #4 General exploit surface

**F9 (HIGH → fixed). Error-message leakage, ~25 routes.** Raw `error.message` /
`String(e)` / upstream bodies returned to callers, leaking Supabase/PostgREST
schema + constraint text and internal hostnames. Fix (dev): `lib/apiError.ts`
logs server-side, returns generic message.

**F10 (fixed, verified). IDOR on trades/hypotheses/evidence.** Now RLS
(`auth.uid()=user_id`, verified live) + route-level ownership checks; evidence
POST verifies parent-hypothesis ownership.

**F11 (fixed, prod-live). Cron routes fail-open + Telegram webhook fail-open.**
`checkCronAuth` now fail-closed (live on prod, verified 200);
`TELEGRAM_WEBHOOK_SECRET` set + webhook re-registered so inbound updates are
authenticated (webhook also IP-rate-limited as belt-and-suspenders).

**F12 (fixed). Telegram HTML injection + GrokChat XSS.** Allowlist
`sanitizeTelegramHtml` and quote-escaping in `renderMd` — both verified sound
against the attribute-breakout and tag-injection vectors.

**SSRF / CORS / injection — checked, no open finding.** `app/api/proxy` is
type-switched (`trends`/`coinglass-*`/`etf`), NOT an arbitrary user URL → no
open SSRF. No route forwards a user-supplied URL to `fetch`. No custom CORS
allow-all headers found. Supabase queries are parameterized (PostgREST); the one
dynamic identifier (`p_column` in `increment_ai_usage`) is a fixed CASE
allowlist, not dynamic SQL. Secrets audited clean: no keys in client bundle,
service-role server-only, none in git, none logged.

---

## 3. Ranked cap recommendations (implementation-level)

1. **[DO FIRST] Merge `dev`→`main` + deploy.** The per-user caps, atomic
   increment wiring, cache-key hardening, rate-limits, and error-leakage fixes
   already exist on `dev` and are the single biggest risk reduction. Nothing
   protects prod until this ships. One PR, ~10 commits.

2. **Global daily circuit breaker for xAI (the missing layer).** Add a
   `global_ai_usage(date, count)` single-row counter incremented inside the same
   `increment_ai_usage()` fn (one extra `UPDATE`). Gate every xAI route on a
   configurable `AI_GLOBAL_DAILY_MAX` env; when exceeded, return 503
   `code:'GLOBAL_CAP'` and skip the upstream call. This is what stops a farmed
   fleet (F4/F5) that individually stays under per-user caps. Cheap, atomic,
   env-tunable. Pair with a Telegram alert to the owner when it trips.

3. **Per-user cap on the 3 cached xAI routes' cache-MISS path too** (dry-powder,
   macro-context, onchain). They're fixed-key so cost is naturally ~1 call/TTL,
   but add a small per-user counter for symmetry + attribution.

4. **(Fixed) Attribute the metered non-xAI routes per user, not just per IP.**
   Covers all four routes with a real vendor key/quota behind them: CMC,
   Finnhub (`news/finnhub`), Coinglass (`proxy`), and Finnhub-via-`econ-calendar`.
   Auth stayed optional (all four remain public/unauthenticated by design) but
   a signed-in caller's user id is now logged alongside IP, so a quota spike is
   traceable to an account when the caller was signed in.

5. **Fix `getClientIp` (LOW).** `lib/rateLimit.ts` takes the first
   `X-Forwarded-For` value = client-controlled. On Render, derive the real client
   IP from the trusted proxy hop so per-IP limits can't be rotated around.

## 4. Signup / trial gap — recommendation

- **Enable Supabase Auth CAPTCHA** (Dashboard → Authentication → Settings → Bot
  & Abuse Protection; Turnstile or hCaptcha). This is the single highest-leverage
  control — it breaks scripted mass account creation, which is the root enabler
  of trial farming (F5). Not doable from app code.
- **Disposable-domain blocklist** at trial issuance: extend
  `lhq_grant_signup_trial()` to skip the trial (grant `trial_ends_at=null`) when
  the email domain is on a maintained throwaway-domain list (mailinator, etc.).
- **IP / velocity signal (optional, needs an Auth Hook):** a Supabase
  `before-user-created` Auth Hook can reject when >N signups from one IP/day.
- **Keep the email-normalization dedup** already shipped — it's the alias-trick
  defense and stays valuable alongside the above.
- Backstop: the **global circuit breaker (§3.2)** makes trial farming
  cost-bounded even if some accounts slip through.

## 5. Logging & admin "who's using how much" — recommendation

- **Add an estimated-cost column.** Store per-call-type unit cost (env or a small
  table) and compute `$` in `/api/ops/ai-cost` so the console shows spend, not
  just counts.
- **Global daily total + threshold alert.** Surface today's total xAI
  units/$ on `/ops` overview; a cron (already have the cron harness) checks the
  daily total vs a threshold and Telegrams the owner on breach — so a spike is
  caught in minutes, not on the monthly invoice.
- **(Fixed) Attribute non-xAI metered calls.** CMC, Finnhub (`news/finnhub`),
  Coinglass (`proxy`), and Finnhub-via-`econ-calendar` now all log user id
  (or `anon`) alongside IP on every call — no schema change, structured
  console log only; a usage table would only be worth it once §5's cost view
  is built.
- **Per-user drill-down** already exists (`/api/ops/users/[id]`); add the cost
  figure and a sortable "top spenders (24h/7d)" view.

## 6. Pass confirmation (3 passes)

- **Pass 1 — enumeration + initial findings.** Walked every `app/api/**/route.ts`,
  built the metered checklist (§1), and identified the original finding set
  (uncapped xAI routes, TOCTOU, cache bypass, trial abuse, error leakage, cron
  fail-open). Most were then fixed on `dev`.
- **Pass 2 — five independent parallel deep-dives** (separate agents, fresh
  context, reading live prod DB): (a) API-cost completeness, (b) auth/IDOR/RLS,
  (c) secrets/keys/logging, (d) signup/trial/payment, (e) fix-verification.
  New items surfaced beyond pass 1: over-broad table grants (F6), trial-claims
  CASCADE (F7), null-email trial path, LemonSqueezy `custom_data.user_id` binding
  (deferred — payments not live), webhook fail-open (F11). Secrets pass
  confirmed CLEAN (no client-bundle keys, nothing in git/logs).
- **Pass 3 — adversarial re-verification against live prod DB.** Re-checked each
  applied fix assuming it was wrong: read the live `increment_ai_usage` /
  `lhq_grant_signup_trial` bodies, `pg_policies`, and grants. Result: 5/6 sampled
  fixes SOUND; the 1 defect (trial-claims CASCADE) was caught and fixed same
  session. Re-grepped the tree: no `error.message`/`String(e)` leak sites remain
  on `dev` except the two intentional rate-limit messages; no metered route left
  uncapped on `dev`. Re-confirmed items unchanged since pass 2: SSRF (none — proxy
  is type-switched), secrets (clean).

**Net:** on `dev`, the P0 cost-abuse and trial-abuse surfaces are closed except
the two structural residuals that need non-code action — **(a) merge to prod**
and **(b) enable signup CAPTCHA** — plus the recommended **global circuit
breaker** as the missing defense-in-depth layer. See `pendings/PENDING.md` for
live status.


