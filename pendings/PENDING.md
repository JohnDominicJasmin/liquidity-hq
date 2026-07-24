# Pending Work

Single source of truth. Security audit = user's #1 priority (stop untraceable
API-cost abuse, signup/trial abuse, any exploit that breaches system/keys/logs).
Full audit deliverable: `pendings/SECURITY_AUDIT.md`. Pricing/costing analysis
is explicitly **paused** until this list is fully resolved — see
`pendings/PRICING_ANALYSIS.md` (aware of the issue, working it after this).

## ✅ FIXED — raw label keys flashing on page navigation (user-reported 2026-07-24 20:17, `dev` only)

User sent a screen recording of `/dashboard` showing raw i18n key names
(`NAV_DASHBOARD`, `DASH_EDGE_OI_LABEL`, `MARKET_CONDITIONS_WIDGET_TITLE`, etc.)
for a split second before real text replaced them; confirmed it also happens
typing `/markets`, `/arena`, `/settings` directly into the URL bar.
**Root-caused, not guessed:** `curl`ing the SSR HTML directly showed the raw
keys were literally in the server-rendered payload, on every full page load
(client-side `Link` nav was already flash-free - a genuinely different code
path than what was fixed earlier this project). `LabelsProvider` had no
SSR-safe default (`map` started as `{}`, since `localStorage` isn't reachable
server-side), so first paint always rendered empty until a post-mount effect
resolved. Fixed by seeding a static English label snapshot
(`lib/labelDefaults.en.json`) as the initial state - worst case is now a brief
English flash before the real locale swaps in, never a raw key. Verified: 0
raw-key matches server-rendered on all 4 reported routes, no hydration
warnings. Full writeup + regeneration process in `pendings/I18N_MIGRATION.md`.
Committed to `dev`, not yet merged to `main`.

## ✅ ALL CODE WORK DONE — merged to `main`, deployed, smoke-tested

`dev`→`main` merged (15 commits, 2026-07-24), deploy `dep-d9hktcb7uimc73fes8l0`
live, verified (homepage 200, `webhook_ok: true`). Since then, 5 more commits
shipped straight to `dev` (global circuit breaker, IP-spoof fix, non-xAI
logging, Turnstile CAPTCHA, raw-label-key SSR fix) — **not yet merged to
`main`**, see the one open item below.

- AI cost caps on all 9+2 xAI/Grok routes + TOCTOU race closed (atomic `increment_ai_usage`).
- **Global daily xAI circuit breaker** — one app-wide counter on top of per-user caps; stops a *fleet* of accounts each staying under their own cap. Built, live-tested (capped at limit, rolled back correctly), on both Supabase projects. **OFF until `AI_GLOBAL_DAILY_MAX` is set in Render** (see "your action" below).
- token-unlock / smc-snapshot cache-bypass closed.
- macro / telegram detect / bot-info / webhook per-IP rate-limited; telegram/test auth-required.
- **IP-spoof fix** — `getClientIp` read the client-controllable leftmost `X-Forwarded-For` hop; now reads the rightmost (Render-appended, trusted) hop. Every per-IP limit in the app now actually holds.
- **Non-xAI traceability** — `cmc` + `news/finnhub` now log IP on every call (structured, greppable) so a quota spike is traceable. Full user-attribution needs a client-side change (see open item below) — these routes are intentionally unauthenticated (public market data/news, called for signed-out visitors too).
- Cron auth fail-closed, `CRON_SECRET` set, verified 200 on a live cron run.
- Telegram webhook: secret set + re-registered, `webhook_ok: true` confirmed. `/start` restored.
- Trial abuse: email dedup, revoked stray write grants, FK CASCADE→SET NULL, null-email = no trial.
- Error-message leakage: ~25 routes via `lib/apiError.ts`.
- LemonSqueezy webhook rejects `test_mode` in prod.
- Secrets/keys/logs audited clean. Admin traceability exists at `/ops`.
- Adversarial re-verification (live prod DB, 3 passes): 5/6 sampled fixes SOUND; 1 defect found + fixed same session.
- **Turnstile CAPTCHA on magic-link login** — code side DONE and verified (widget renders only when configured, CSP updated to allow `challenges.cloudflare.com`, button correctly gates on the token, Google OAuth untouched). Tested end-to-end locally with Cloudflare's official always-pass test key. **OFF until you complete the 3-step handoff below** — this is what actually stops unlimited-distinct-inbox trial farming.

## ⛔ OPEN — code (mine)

1. **Merge the 5 newest `dev` commits to `main` + deploy** (circuit breaker,
   IP-spoof fix, IP logging, Turnstile, raw-label-key SSR fix) — same pattern
   as the earlier merge. Not done yet; ask before I push, per the established
   prod-deploy confirmation habit. The label-key bug is currently LIVE ON PROD
   too (this fix is dev-only until merged) — worth prioritizing this merge.

Everything else that was "mine" is now either done or explicitly deferred below
— nothing else is silently outstanding.

## ⏸️ DEFERRED — low priority, explicitly scoped, not blocking anything

- **Full non-xAI user-attribution** (CMC/Finnhub) — needs wiring a bearer token
  through `MarketProvider`/`NewsProvider` (1000+ line, always-mounted client
  components, currently have zero auth access wired in). Real regression risk
  for a LOW-severity, free-API item. IP logging (shipped) covers "traceable
  after a spike"; this would add "traceable to a specific account." Do later,
  deliberately, with its own test pass — not urgent.
- **Dev Render env vars** (`TELEGRAM_WEBHOOK_SECRET`, `NEXT_PUBLIC_APP_URL`) —
  dev isn't the live webhook target, so this doesn't protect anything real
  right now. Setting an env var triggers a Render deploy (dev has a 500hr/mo
  cap) — deferred until there's an actual reason to burn one.
- **Admin $-cost view** — tied to the paused pricing analysis
  (`PRICING_ANALYSIS.md` §5E). Will build once pricing/caps are decided, so the
  cost constants are real rather than placeholders.

## ❓ OPEN — YOUR action (can't do from code)

- **Set `AI_GLOBAL_DAILY_MAX` in Render** (prod, and dev if/when its env vars
  get set) — this is what actually turns the circuit breaker ON. Pick a number
  tied to a daily $ budget you're willing to eat (see PRICING_ANALYSIS.md §5A
  for a worked example).
- **Turnstile CAPTCHA — 3-step handoff** (code is done, waiting on you):
  1. Go to [dash.cloudflare.com](https://dash.cloudflare.com) → Turnstile →
     create a widget for your domain. Copy the **Site key** and **Secret key**.
  2. Set `NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>` in Render (prod, and dev
     if you want it there too) — triggers a redeploy, same as any env var.
  3. Paste the **Secret key** into Supabase Dashboard → Authentication →
     Settings → Bot and Abuse Protection → Enable CAPTCHA protection → provider
     Turnstile → Save. The secret only ever lives in Supabase's config, never
     in this repo or Render.
  Do steps 2 and 3 together/same session — once Supabase's toggle is on, magic
  link requires a valid token, so the widget needs to already be live.
- **Disposable-email domain blocklist** (optional, pairs with CAPTCHA).

## 🔭 DEFERRED — tied to unfinished payment feature

- LemonSqueezy `custom_data.user_id` unbound from payer (MED) — not
  exploitable until payments live. Build checklist when resuming: bind user_id
  to verified LS customer; add webhook idempotency/replay protection.

## Next up (per user, after this list is fully resolved)

- `pendings/PRICING_ANALYSIS.md` — is $15/mo Pro profitable, per-user cost
  model, recommended reprice + cap resize. Paused, not forgotten.

## i18n translation — paused (see also pendings/I18N_MIGRATION.md)

- Done: en, ko, zh, ar, ru (2370/2370, both DBs). Pending: vi, pt-BR, tr, es, id. Do not resume proactively.
