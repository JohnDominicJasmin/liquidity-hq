# LiquidityHQ Admin Panel (`/ops`) — Roadmap & Status

Living status doc for the owner/staff admin console at `/ops`. What's shipped, what's deferred, and the key facts you need to work on it.

Last updated: 2026-07-25 (PostHog session-replay masking backlog item found already fixed - doc was stale, not the code).

---

## What it is

A web console for the app's owner + hired staff to monitor the app, manage users, and control access — without touching the Supabase dashboard or writing code. Lives in the same Next.js app under `/ops` (login at `/ops/login`). The old `/admin` path is a honeypot (logs the probe, 404s).

**Access model:** membership + roles live in the `admin_users` table (managed from the Team page), NOT an env var. `ADMIN_EMAILS` is only an emergency-bootstrap owner so you can't lock yourself out. Two roles: `owner` (full + manages the team) and `staff` (everything except team management).

---

## Shipped

### Phase 1 — Monitor (read-only) — LIVE on prod
- `/ops` dashboard: Users & revenue, Cron health, AI (Grok) cost, Signal accuracy.
- Users list (`/ops/users`) + user detail (aggregates/counts only — never raw journal/hypothesis content).

### Hardening — LIVE on prod
- Server-side guard on every `/api/ops/*` route (`withAdmin` / `withOwner`), applied by construction.
- `/ops` renders chromeless (no consumer nav/ticker/footer/AI-FAB).
- `/admin` honeypot + `admin_audit_log`.

### Login + roles + Team — LIVE on prod
- `/ops/login`: email+password (Supabase) + Google. Signed-in non-admin gets a clear "Access denied" screen.
- Team page (`/ops/team`, owner-only): add staff (creates a pre-confirmed Supabase user or grants an existing account access), change role, disable/remove. Every write audited.
- Best-effort "you've been added" email via Brevo (see Known limitations).

### Phase 2 — Account actions — LIVE on prod (2026-07-20)
On the user detail page, any admin can: **Grant/Revoke Pro**, **Ban/Unban**, **Reset today's AI limit**. Grant/Revoke only touches `role` (never clobbers real Lemon Squeezy billing fields). Ban uses Supabase's native `ban_duration`; self-ban blocked. Reset deletes today's `grok_usage` row. All audited.

### Phase 3 — App-wide control — LIVE on prod (2026-07-20)
New `app_config` table (key/value jsonb, service-role write only). Owner-only `/ops/config` page controls:
- **Maintenance mode** — one flag closes the whole consumer app (everything except `/ops`) behind a "down for maintenance" screen. Read via public `GET /api/config`, 15s in-memory cache, fails open (never blocks the app on a broken read).
- **Announcement banner** — text + optional link, dismissible per-visitor, shown above the nav on every consumer page.

Both are polled client-side every 60s (see `lib/useAppConfig.ts`) — this app has no middleware/server session, so a client poll is the only way to pick up an admin change without a hard refresh. Verified end-to-end locally AND on the deployed dev Render service, including the owner-only `/ops/config` UI itself (status card, history, duration expiry) - live-tested by the owner directly.

Seeded with only these two flags on purpose — no per-feature kill-switches (Grok, Telegram, etc.) yet; add them to `app_config` + a real check in code as they're actually needed, not speculatively.

### Error tracking — LIVE on prod AND dev, fully confirmed (2026-07-21)
`@sentry/nextjs` wired via the Next 16 `instrumentation.ts` / `instrumentation-client.ts` convention (Turbopack-safe), pointed at **GlitchTip** (glitchtip.com) rather than sentry.io - open-source, same wire protocol, sentry.io's free tier is gone. Captures server request errors, client runtime errors, and router-transition breadcrumbs. No session replay (PostHog already covers that — see Known limitations).

`NEXT_PUBLIC_SENTRY_DSN` is set on both Render services (dev + prod), both redeployed to pick it up. GlitchTip org/project: `liquidityhq` (project id `25983`), dashboard at `app.glitchtip.com/liquidityhq/issues`. Verified end-to-end on both sites - CSP allows `app.glitchtip.com`, DSN confirmed baked into each site's client bundle, and a real triggered error on each (prod and deployed dev) showed up in GlitchTip within seconds. DSN isn't a secret (meant to be public), so it's also in `.env.local` for local testing.

---

## Deferred / backlog (not built)

| Item | Notes |
|---|---|
| **Welcome email** on signup | Same Brevo path; deferred by owner — needs a domain to be reliable at user-facing scale (see below). On owner's personal list. |
| **Custom ban reason / message** | Supabase shows a bare "user is banned" on login. A "suspended, contact support" message would need custom handling. |
| **Instant session kill on ban** | A banned user's already-issued token still authenticates for up to ~1h until expiry. Force-expiry would need extra work. |
| **Feature-flag kill-switches** | `app_config` + the `/ops/config` pattern exist now (Phase 3); no specific flags (Grok, Telegram, etc.) seeded yet — add on demand. |

**Resolved 2026-07-21 (removed from this table):** the "7 dead dashboard toggles" - turned out to be 1 real bug (`session` was unconditional, gated it) + 6 checkboxes that never applied to the dashboard at all (`accumulation`/`distribution`/`gex`/`macro` live on other pages; `catalysts`/`commandments` were never built). First fix pass trimmed `DASHBOARD_SECTIONS` down to the 5 real ones - but hiding ALL 5 left an ugly blank dashboard (no empty-state fallback), and the user decided the whole toggle feature wasn't worth keeping for that risk. **Final state: the entire "Dashboard Sections" feature is removed** - `DASHBOARD_SECTIONS`, `UserSettings.hidden_sections`, and the Settings UI for it no longer exist anywhere in the codebase. `/dashboard` always renders every section unconditionally now.

**Resolved, date unknown (removed from this table 2026-07-25):** PostHog session-replay masking. This doc claimed `maskAllInputs: false` since 2026-07-21, but `components/PostHogProvider.tsx` was actually changed to `maskAllInputs: true` back on 2026-07-22 (commit `2ddec77`, "realtime ban kill-switch, friendly ban message, mask session inputs") - this doc just never got updated to match. Found and corrected 2026-07-25 while auditing all `pendings/*.md` files for stale claims.

---

## Key facts (don't relearn these the hard way)

- **Two separate Supabase projects, one per tier:** `LiquidityHq` (ref `qdpwhnvmhqgzijuwopso`) = **prod only**; `Automations` (ref `wdtjhrilakoitfcezxpx`) = **local dev AND the deployed `liquidity-hq-dev`** Render service (same project, both dev contexts). CORRECTED 2026-07-20 - earlier docs in this file said LiquidityHq covered local dev too; that was wrong and caused a real debugging detour (local `.env.local` pointed at LiquidityHq, which only has `lhq_dev_admin_users`/`admin_audit_log`/`app_config` - none of the app's other `lhq_dev_*` tables exist there). `.env.local` now correctly points at Automations. A "table not found in schema cache" locally is usually this exact mistake, not a cache lag. (See `docs/INFRASTRUCTURE.md` §4, which may still say the old thing.)
- **Email needs a domain to be reliable.** Brevo single-sender from a Gmail gets deferred/spam-foldered by Gmail/Yahoo/Outlook (2024+ bulk-sender rules). Fine for occasional admin invites, not for user-facing welcome emails. Real fix = a verified domain (SPF/DKIM/DMARC).
- **OAuth uses the implicit flow, deliberately.** PKCE (`flowType: 'pkce'`) was tried and reverted 2026-07-20 — it broke real mobile Google logins ("PKCE code verifier not found in storage"). Any PKCE re-attempt needs real multi-browser mobile testing before prod. (See the comment in `lib/supabase.ts`.)
- **Git workflow:** commits land on `dev`; ship to prod by cherry-picking / merging to `main` then triggering the prod Render deploy. Both Render web services are `autoDeploy: no` (manual trigger).
- **Render services:** prod `srv-d8aluf6l51nc73e1ijp0` (`liquidity-hq.onrender.com`, branch `main`), dev `srv-d8prs6po3t8c739aepdg` (`liquidity-hq-dev.onrender.com`, branch `dev`).
- **Local admin routes now work.** `.env.local` has `SUPABASE_SERVICE_ROLE_KEY` filled in (Automations project's key) as of 2026-07-20 - every `/api/ops/*` route and `/ops/config` itself are fully testable on `localhost:3000`, no dev-service hours needed. Get a fresh key from Automations -> Settings -> API -> Legacy API keys -> `service_role`, never LiquidityHq's.
- **Dev Render service has a monthly build-hour cap prod doesn't** (~500 hrs/mo) - default to local testing (`tsc --noEmit` + `next build` + `localhost:3000` with the service-role key above); only trigger a `liquidity-hq-dev` deploy on explicit go-ahead. Commits/pushes to the `dev` branch are always fine, no need to ask.
- **PostHog already does session replay** (`components/PostHogProvider.tsx`). Sentry is deliberately configured with no replay/breadcrumb DOM capture of its own - two replay recorders would double the privacy surface (see the `maskAllInputs` backlog item above), not add value.
