# LiquidityHQ Admin Panel (`/ops`) — Roadmap & Status

Living status doc for the owner/staff admin console at `/ops`. What's shipped, what's deferred, and the key facts you need to work on it.

Last updated: 2026-07-20.

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

---

## Deferred / backlog (not built)

| Item | Notes |
|---|---|
| **Welcome email** on signup | Same Brevo path; deferred by owner — needs a domain to be reliable at user-facing scale (see below). On owner's personal list. |
| **Sentry error tracking** | No error tracker exists anywhere in the app today. Prod bugs (failed Grok calls, cron failures, blank-screen errors) ship silently. Recommended next reliability add. |
| **PostHog session-replay masking** | `components/PostHogProvider.tsx` has `maskAllInputs: false` — every typed field except passwords is visible in replays, tied to the real user. On a financial app, worth setting to `true` or scoping. |
| **Custom ban reason / message** | Supabase shows a bare "user is banned" on login. A "suspended, contact support" message would need custom handling. |
| **Instant session kill on ban** | A banned user's already-issued token still authenticates for up to ~1h until expiry. Force-expiry would need extra work. |
| **Phase 3 — App-wide control** | Global feature flags / kill-switches (would give the 7 dead dashboard toggles a real home), maintenance mode, announcement banner. Needs a new `app_config` table. Not started. |

---

## Key facts (don't relearn these the hard way)

- **Two separate Supabase projects, one per tier:** `LiquidityHq` (ref `qdpwhnvmhqgzijuwopso`) = **prod + local dev**; `Automations` (ref `wdtjhrilakoitfcezxpx`) = the deployed **`liquidity-hq-dev`** Render service. A "table not found in schema cache" on dev is usually the env pointing at the wrong project, not a cache lag. (See `INFRASTRUCTURE.md` §4.)
- **Email needs a domain to be reliable.** Brevo single-sender from a Gmail gets deferred/spam-foldered by Gmail/Yahoo/Outlook (2024+ bulk-sender rules). Fine for occasional admin invites, not for user-facing welcome emails. Real fix = a verified domain (SPF/DKIM/DMARC).
- **OAuth uses the implicit flow, deliberately.** PKCE (`flowType: 'pkce'`) was tried and reverted 2026-07-20 — it broke real mobile Google logins ("PKCE code verifier not found in storage"). Any PKCE re-attempt needs real multi-browser mobile testing before prod. (See the comment in `lib/supabase.ts`.)
- **Git workflow:** commits land on `dev`; ship to prod by cherry-picking / merging to `main` then triggering the prod Render deploy. Both Render web services are `autoDeploy: no` (manual trigger).
- **Render services:** prod `srv-d8aluf6l51nc73e1ijp0` (`liquidity-hq.onrender.com`, branch `main`), dev `srv-d8prs6po3t8c739aepdg` (`liquidity-hq-dev.onrender.com`, branch `dev`).
