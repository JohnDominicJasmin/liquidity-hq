# Security & Cost-Abuse Audit — LiquidityHQ

**Date:** 2026-07-24  **Scope:** third-party API cost exposure, signup/trial
abuse, traceability, general exploit surface.  **Method:** live target review,
not theoretical — enumerated every metered code path, traced each from trigger
to upstream call, verified DB/RLS state directly against prod Supabase
(`qdpwhnvmhqgzijuwopso`).

> ✅ **UPDATE 2026-07-24 (later same day) — deployed.** The core fixes below
> (routes #4–11 capped, TOCTOU, macro/telegram rate-limits, IP-spoof fix,
> global circuit breaker, Turnstile CAPTCHA, raw-label-key fix) merged to
> `main` and were **deployed + smoke-tested on prod** — verified live, not
> just merged (e.g. Turnstile's checkbox confirmed rendering on the real
> `/login` URL, `AI_GLOBAL_DAILY_MAX=2000` confirmed set on Render). A second,
> later batch — non-xAI full attribution (§2 F8c), the $25 repricing, and the
> `/ops` $-cost view — is **merged to `main` but not yet deployed** (prod
> `autoDeploy` is off; deploy is manual, your call on timing). Every "FIXED"
> below is live on prod unless explicitly marked "merged, not yet deployed."
> Full live status: `pendings/PENDING.md`.

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
| 4 | `app/api/thesis-check/route.ts` | yes | Cap | **Cap — deployed** |
| 5 | `app/api/strategy-research/route.ts` | yes | Cap | **Cap — deployed** |
| 6 | `app/api/shadow-account/route.ts` | yes | Cap | **Cap — deployed** |
| 7 | `app/api/behavioral-bias/route.ts` | yes | Cap | **Cap — deployed** |
| 8 | `app/api/pine-script/route.ts` | yes | Cap | **Cap — deployed** |
| 9 | `app/api/hypotheses/[id]/analyze/route.ts` | yes | Cap | **Cap — deployed** |
| 10 | `app/api/token-unlock/route.ts` | yes | Cap + strict input | **Cap + strict input — deployed** |
| 11 | `app/api/smc-snapshot/route.ts` | yes | Cap + strict input | **Cap + strict input — deployed** |
| 12 | `app/api/dry-powder/route.ts` | yes | Cache (fixed key, 1h) | Cache (fixed key) |
| 13 | `app/api/macro-context/route.ts` | yes + Pro | Cache (fixed key) | Cache (fixed key) |
| 14 | `app/api/onchain/route.ts` | yes + Pro | Cache (fixed key) | Cache (fixed key) |

All 14 rows above are now identical dev/prod — deployed and smoke-tested. The
distinction that used to matter here (dev-only vs prod) no longer applies to
this table; kept for the historical record of what pass 1 found.

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
our outbound address rather than a bill. **The user-attribution code (CMC,
Finnhub, proxy, econ-calendar) is merged to `main` but not yet deployed** —
see the top-of-doc update note.

---

## 2. Findings by priority objective

### P0 — #1 Uncapped third-party API cost exposure

**F1 (CRITICAL → fixed, deployed). Six xAI routes + two cache-bypass routes
were uncapped on prod.** Routes #4–11 above. Exploit (closed): any signed-in
user (incl. a free 14-day-trial account) scripts `POST /api/thesis-check` (or
strategy-research, shadow-account, behavioral-bias, pine-script,
hypotheses/analyze) in a tight loop → unbounded grok-4.3 calls → unbounded
xAI bill. `token-unlock`/`smc-snapshot` had a second vector: vary the
`symbol`/`asset` string to miss the cache every time.
- Fix: shared `lib/aiUsage.ts` reserves an atomic daily unit before the
  upstream call; strict `^[A-Z0-9]{2,10}$` input on the cached routes.
  **Merged to `main` and deployed — live on prod.**

**F2 (HIGH → fixed). TOCTOU race on the daily caps.** The pre-existing capped
routes read-then-wrote usage non-atomically; two concurrent requests could both
pass the check. Fix: single atomic `UPDATE … WHERE col < limit RETURNING` in
the `increment_ai_usage()` Postgres fn (live on prod DB; called by dev code).

**F3 (MEDIUM → fixed, deployed). `macro`, `telegram/detect`, `telegram/bot-info`
had zero rate-limit/auth.** `macro` fired 5 Yahoo calls per request with
`cache:'no-store'`. Exploit (closed): unauthenticated loop → hammer Yahoo, get
our egress IP throttled. Fix: per-IP `rateLimit()` added; `macro` switched to
a 60s cache. **Live on prod.**

**F4 (LOW → fixed, deployed). No GLOBAL ceiling / circuit breaker on xAI.**
Per-user caps didn't stop a *fleet* of farmed accounts each spending its own
daily allotment (ties to P0-#2). Fix: one app-wide `lhq_global_ai_usage`
daily counter, incremented atomically inside the same `increment_ai_usage()`
call as the per-user cap; every xAI route blocks once the global total hits
`AI_GLOBAL_DAILY_MAX`. **Live on prod: `AI_GLOBAL_DAILY_MAX=2000` set on both
Render services (Render `srv-d8aluf6l51nc73e1ijp0` + `srv-d8prs6po3t8c739aepdg`),
DB function live on both Supabase projects.**

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
- **(Fixed) Residual: distinct real inboxes.** Turnstile CAPTCHA (stops
  scripted mass account creation) and the disposable-domain blocklist (stops
  a human farming trials with real throwaway addresses) are both now live —
  see §4.

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

1. **(Done) Merge `dev`→`main` + deploy.** The per-user caps, atomic increment
   wiring, cache-key hardening, rate-limits, and error-leakage fixes are live
   on prod, smoke-tested. (A later, separate batch — non-xAI attribution,
   pricing/caps, `/ops` cost view — is merged but awaiting your manual deploy;
   not part of what "DO FIRST" was protecting against.)

2. **(Done) Global daily circuit breaker for xAI.** `lhq_global_ai_usage`
   counter, incremented inside the same `increment_ai_usage()` call as the
   per-user cap; every xAI route blocks once the daily total hits
   `AI_GLOBAL_DAILY_MAX` (set to 2,000). This is what stops a farmed fleet
   (F4/F5) that individually stays under per-user caps. **Live on prod.**
   Not yet paired with a Telegram alert on trip — still worth adding (see §5).

3. **Per-user cap on the 3 cached xAI routes' cache-MISS path too** (dry-powder,
   macro-context, onchain). They're fixed-key so cost is naturally ~1 call/TTL,
   but add a small per-user counter for symmetry + attribution. **Still open —
   not attempted.**

4. **(Fixed, merged — awaiting deploy) Attribute the metered non-xAI routes
   per user, not just per IP.** Covers all four routes with a real vendor
   key/quota behind them: CMC, Finnhub (`news/finnhub`), Coinglass (`proxy`),
   and Finnhub-via-`econ-calendar`. Auth stayed optional (all four remain
   public/unauthenticated by design) but a signed-in caller's user id is now
   logged alongside IP, so a quota spike is traceable to an account when the
   caller was signed in.

5. **(Done) Fix `getClientIp` (LOW).** `lib/rateLimit.ts` took the first
   `X-Forwarded-For` value = client-controlled. Now derives the real client
   IP from the trusted rightmost (Render-appended) hop so per-IP limits can't
   be rotated around. **Live on prod.**

## 4. Signup / trial gap — recommendation

- **(Fixed, live on prod) Enable Supabase Auth CAPTCHA** — Turnstile is live
  (Dashboard → Authentication → Attack Protection). This was the single
  highest-leverage control — it breaks scripted mass account creation, the
  root enabler of trial farming (F5).
- **(Fixed, live on both DB projects) Disposable-domain blocklist** at trial
  issuance — `lhq_grant_signup_trial()` now checks the signup email's domain
  against `lhq_disposable_email_domains` (46-domain starter list: mailinator,
  guerrillamail, 10minutemail, yopmail, etc.) and grants `trial_ends_at=null`
  instead of a fresh 14-day trial on a match. Catches a human manually farming
  trials with real throwaway addresses — the gap Turnstile alone doesn't close.
- **IP / velocity signal (optional, needs an Auth Hook):** a Supabase
  `before-user-created` Auth Hook can reject when >N signups from one IP/day.
- **Keep the email-normalization dedup** already shipped — it's the alias-trick
  defense and stays valuable alongside the above.
- Backstop: the **global circuit breaker (§3.2)** makes trial farming
  cost-bounded even if some accounts slip through.

## 5. Logging & admin "who's using how much" — recommendation

- **(Done, merged — awaiting deploy) Add an estimated-cost column.**
  `lib/aiCost.ts` holds the real per-token rates ($1.25/$0.20/$2.50 input/
  cached/output per 1M, from console.x.ai/models); `/api/ops/ai-cost` now
  computes real $ figures (24h/7d/30d, global + per-user) instead of raw
  counts.
- **(Partially done) Global daily total + threshold alert.** `/ops` now shows
  today's calls vs `AI_GLOBAL_DAILY_MAX` with an 80%-of-cap spike flag in the
  UI. **Still missing:** a cron that Telegrams the owner on breach — right
  now a spike is caught by looking at `/ops`, not pushed to you. Worth
  adding if you want to stop checking the dashboard manually.
- **(Fixed) Attribute non-xAI metered calls.** CMC, Finnhub (`news/finnhub`),
  Coinglass (`proxy`), and Finnhub-via-`econ-calendar` now all log user id
  (or `anon`) alongside IP on every call — no schema change, structured
  console log only.
- **(Done, merged — awaiting deploy) Per-user drill-down.**
  `/api/ops/users/[id]` now includes the same $ cost breakdown (14-day) plus
  a margin figure (Pro revenue minus cost); `/api/ops/ai-cost` has a sortable
  top-10 "top spenders (30d)" list by $ with margin.

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

## 7. Where things actually stand now (2026-07-24, later same day)

Every P0/P1 finding from this audit is fixed. Status split by what's live vs.
merged-but-not-yet-deployed:

**Live on prod:**
- All 14 xAI routes capped (F1); TOCTOU closed (F2); macro/telegram RL (F3);
  global circuit breaker, `AI_GLOBAL_DAILY_MAX=2000` (F4); trial email-dedup,
  revoked grants, CASCADE→SET NULL (F5–F7); error-message leakage fixed (F9);
  IDOR fixed (F10); cron/webhook fail-open fixed (F11); Telegram/GrokChat
  injection fixed (F12); IP-spoof fix (§3.5); Turnstile CAPTCHA (§4);
  disposable-email domain blocklist (§4, DB-only change, always live
  regardless of app deploy).
- **Both structural residuals this doc originally flagged as "needs non-code
  action" are done: CAPTCHA is enabled, and the disposable-domain blocklist
  closes the remaining real-inbox gap.**

**Merged to `main`, awaiting your manual deploy** (prod `autoDeploy` is off):
- Non-xAI full attribution (CMC/Finnhub/proxy/econ-calendar user-id logging).
- `/ops` $-cost view (real per-token rates, top spenders, margin).
- Pro repricing ($15→$25) and cap resize — not a security fix, bundled in the
  same merge; see `pendings/PRICING_ANALYSIS.md`.

**Still genuinely open, not attempted (all LOW priority):**
- Per-user cap on the 3 cached xAI routes' cache-miss path (§3.3).
- Telegram alert on global-cap-breach spike (§5) — the spike flag exists in
  the `/ops` UI, just isn't pushed anywhere yet.
- IP/velocity Auth Hook for signup (§4) — optional, CAPTCHA + the disposable
  blocklist already cover the higher-value cases.

See `pendings/PENDING.md` for the live, continuously-updated status — this
document is the point-in-time audit, that one is the working list.


