# LiquidityHQ — Infrastructure & Operations

This file exists because the codebase alone doesn't tell the whole story. `docs/ARCHITECTURE.md` documents what's *in* the repo; this file documents what runs *around* it — external services, scheduled jobs, API accounts, and hosting that a `grep` across the codebase cannot find. Several routes in this app (`api/telegram/alert`, `api/macro-alert`, `api/signals/track`, `api/alert-outcomes/resolve`) are written to run on a schedule but contain zero code that schedules them — the scheduler lives entirely outside the repo, on cron-job.org or n8n. Anyone (including an AI assistant) reading only the source code will wrongly conclude these routes are dead. They are not. Check this file first.

**Keep this file honest:** any time a new external cron job, API key, or hosted service is added for this project, add it here in the same pass. A stale version of this file is worse than no file — it actively misleads.

---

## 1. Hosting — Render

Three services, one Render account, org workspace shared with unrelated projects (`n8n workflows` is also used by other automations, not exclusive to LHQ).

| Service | Render ID | Plan | Region | Branch | URL | Purpose |
|---|---|---|---|---|---|---|
| `liquidity-hq-prod` | `srv-d8aluf6l51nc73e1ijp0` | starter | Singapore | `main` | `liquidity-hq.onrender.com` | Production. `npm install; npm run build` → `npm start`. |
| `liquidity-hq-dev` | `srv-d8prs6po3t8c739aepdg` | free | Singapore | `dev` | `liquidity-hq-dev.onrender.com` | Staging. Free plan — spins down after inactivity, first request after idle is slow/can fail. |
| `n8n-workflows` | `srv-d6e4fkq4d50c73b8dpk0` | starter | Singapore | n/a (Docker image `n8nio/n8n:latest`) | `n8n-workflows-6ig6.onrender.com` | Self-hosted n8n instance, 5GB persistent disk. Shared across projects, not LHQ-exclusive. |

Both `liquidity-hq-prod` and `liquidity-hq-dev` have `autoDeploy: no` — pushing to `main`/`dev` does **not** auto-deploy. Deploys are triggered manually (via Render dashboard, the `mcp__render__trigger_deploy` tool, or `git push` if that ever changes).

`render.yaml` in this repo has **no cron job definitions** — Render's own Cron Jobs feature is not used anywhere for this project (it has no free tier, unlike the alternatives below).

---

## 2. External Scheduling — cron-job.org

Account: `console.cron-job.org` (external, separate login — not in this repo, not in Render, not discoverable by reading code). Login is the user's own; an AI assistant working on this repo has no visibility into this dashboard unless explicitly given the URL and asked to check it.

| Job name | Target | Schedule | Status | Auth | Purpose |
|---|---|---|---|---|---|
| `liquidity hq` | `https://liquidity-hq.onrender.com/` | every 5 min | **Active**, succeeding | none | Keep-alive / uptime ping for prod root. |
| `LiquidityHQ` | `https://liquidity-hq.onrender.com/api/telegram/alert` | every 5 min (`*/5 * * * *`, tz Asia/Manila) | **Active**, succeeding | none (no custom headers sent) | The actual Telegram/Web Push alert scanner — RSI, EMA crosses, whale trades, OI spikes, news, fear/greed. See `docs/ARCHITECTURE.md` §7. |
| `LiquidityHQ - macro-alert` | `https://liquidity-hq.onrender.com/api/macro-alert` | every 5 min (`*/5 * * * *`, tz Asia/Manila) | **Active**, confirmed succeeding (200 OK, first tick 2026-07-19 6:25 PM) | none | Economic-calendar event alerts (FOMC/NFP/CPI/etc). Wired 2026-07-19 — see §8, was previously the confirmed gap. |
| `LiquidityHQ - signals/track` | `https://liquidity-hq.onrender.com/api/signals/track` | every 15 min (`*/15 * * * *`, tz Asia/Manila) | **Active**, route confirmed live via direct curl (200 OK) same day; first scheduled tick pending at creation time | none | Live EMA Ribbon signal detection + resolution (majors, 1h/4h) feeding `/live-tracking`. Wired 2026-07-19 — see §8, was previously the confirmed gap. |
| `n8nreq` | `https://n8n-workflows-6ig6.onrender.com` | (was recurring) | **Inactive** (disabled) | none | Old keep-alive ping for the n8n service. Last ran 2026-03-10. |

All four active jobs above target **prod only** (`liquidity-hq.onrender.com`). `macro-alert` and `signals/track` were both verified working on dev too via direct curl (`liquidity-hq-dev.onrender.com`, both `200 OK`, `signals/track` genuinely logged a real signal) - the routes work fine there, there's just no cron pointed at dev for them. Confirmed intentional with the user 2026-07-19: dev is staging, doesn't need production alert cadence. Don't re-flag this as a gap.
| `dev liquidity hq environment` | `https://liquidity-hq-dev.onrender.com/` | (was recurring) | **Inactive** (disabled), last run **failed** | none | Old keep-alive ping for dev (free-tier spin-down mitigation). Last ran 2026-07-01, failed. |

**`CRON_SECRET` IS set on prod, as of the security-audit fixes (`pendings/pendings/PENDING.md`: "Cron auth fail-closed, CRON_SECRET set, verified 200 on a live cron run").** This section previously said it was unset — stale, corrected 2026-07-25. `lib/cronAuth.ts`'s `checkCronAuth()` fails CLOSED with no secret configured, so every job in the table above must send a matching `x-cron-secret` header (or `?secret=` query param) or it 401s. Any NEW cron-job.org job or n8n workflow hitting a `checkCronAuth`-gated route needs this header from the start - it will not silently work unauthenticated the way the original jobs briefly did before the fail-closed change shipped.

**`api/macro-alert` and `api/signals/track` schedule gap — CLOSED 2026-07-19.** Both wired to cron-job.org (see rows above), matching `telegram/alert`'s existing pattern rather than adding a third scheduling tool. `signals/track`'s route has no Binance→Bybit failover on fetch failure (unlike `alert-outcomes/resolve`, which tries both concurrently) — a pre-existing code characteristic, not something this wiring pass touched; worth hardening later if Binance rate-limiting becomes a recurring problem for that route specifically.

---

## 3. Workflow Automation — n8n

Self-hosted, see §1. Login is separate from Render/Supabase/cron-job.org — another credential silo an assistant can't see into without being handed the URL.

Project: **Personal** → folder **`liquidityhq`** (`https://n8n-workflows-6ig6.onrender.com/projects/9B0VhqigwtxZEqpc/folders/wiWQZx7PhztvoBTv/workflows`).

| Workflow | Trigger | Action | Status |
|---|---|---|---|
| `LHQ - Resolve Alert Outcomes (hourly)` | Schedule Trigger, Custom Cron `0 0 * * * *` (top of every hour) | HTTP Request `GET https://liquidity-hq.onrender.com/api/alert-outcomes/resolve` | Published/active as of 2026-07-19. Resolves the 24h/48h alert-outcome windows for `lhq_alert_fires` (Tier 2 backlog item #10). |

Why n8n over a Render cron job or cron-job.org for this one: Render cron jobs have no free tier (cheapest is a paid `starter` plan); n8n was already running and paid for, so this added zero new billable infrastructure. cron-job.org was the other free option but n8n was chosen since it was already open in this session — no strong reason either way, could be moved to cron-job.org later for consistency with `telegram/alert`.

A local Claude Code **scheduled-tasks** entry (`mcp__scheduled-tasks`, `lhq-alert-outcomes-resolve`) briefly filled this gap as a stopgap before the n8n workflow was built. It has since been **deleted** — it depended on this machine's Claude Code instance staying alive, which is not a real production guarantee. Its prompt is preserved at `C:\Users\Dominic\.claude\scheduled-tasks\lhq-alert-outcomes-resolve\SKILL.md` if it's ever needed as a reference.

---

## 4. Database — Supabase

**The organization has 4 Supabase projects. LHQ deliberately uses TWO of them — one per deploy tier, not one real / one stale.**

> **Corrected 2026-07-20 (twice — see history below).** Confirmed directly by
> the app owner: `LiquidityHq` is the **production** database (used by
> `liquidity-hq-prod` and local `.env.local`), and `Automations` is the
> **deployed-dev** database (used by the `liquidity-hq-dev` Render service). Both
> are live and actively used — this is intentional isolation (dev testing can
> never touch prod data, since it's a separate physical project, not just a
> different table prefix), not a stale/decoy situation.
>
> History: a 2026-07-17 audit had this backwards (called Automations "the real
> one", LiquidityHq an "empty decoy"). A same-day 2026-07-20 fix over-corrected
> it, calling Automations "stale/superseded" — also wrong. This version is the
> owner-confirmed final state.

| Project name | Ref | Region | Status | Used by LHQ? |
|---|---|---|---|---|
| **`LiquidityHq`** | `qdpwhnvmhqgzijuwopso` | ap-northeast-2 | Active | **Yes — production.** `liquidity-hq-prod` and local `.env.local` point here. Holds `lhq_*` (prod) tables. |
| **`Automations`** | `wdtjhrilakoitfcezxpx` | ap-northeast-1 | Active | **Yes — deployed dev.** `liquidity-hq-dev` (Render) points here. Holds its own parallel `lhq_dev_*` table set. |
| `MotoTracker` | `bseewwodijmuvpbqdgcc` | ap-northeast-2 | Inactive | No - unrelated project. |
| `Solar ROI tracker` | `trpubozqrgjllwyukfol` | ap-northeast-2 | Inactive | No - unrelated project. |

Table naming convention (enforced in code, see `docs/ARCHITECTURE.md` §8): always reference tables via `T.xxx` from `lib/tables.ts`, never a literal string. Note this only controls the `lhq_` vs `lhq_dev_` prefix *within* a project — it does NOT make dev and prod share one database; they are two separate Supabase projects entirely. Any new table needed by the deployed dev service must be created in `Automations`, not `LiquidityHq` — a "table not found in schema cache" error on `liquidity-hq-dev` after creating a table is often this, not a PostgREST cache lag.

---

## 5. Third-Party APIs

From `.env.example` — the authoritative list of what needs a key. Whether each key is actually *set* on Render (prod/dev) is not visible to an assistant; only that the app expects it.

| Service | Env var(s) | Used for | Tier |
|---|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | DB, auth. Without these, Arena signal history + Cluster Tracker are disabled but the rest of the app works. | — |
| CoinMarketCap | `CMC_API_KEY` | BTC/ETH dominance, Alt Season Index | — |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Product analytics | — |
| Grok (xAI) | `GROK_API_KEY` | AI chat/analysis features (Ask AI, briefing generation, dry-powder/macro-context routes) | — |
| Coinglass | `COINGLASS_API_KEY` | BTC liquidation heatmap (Arena), exchange net flow | Free tier available |
| Finnhub | `FINNHUB_KEY` | (economic calendar / macro data) | — |
| Telegram Bot API | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Alert delivery channel | — |
| Web Push (VAPID) | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | Browser push notifications | — |
| Binance / Bybit public REST | none (no key) | Live price ticker used by `api/alert-outcomes/resolve` and elsewhere | Public, unauthenticated |
| `CRON_SECRET` | `CRON_SECRET` | Meant to protect `telegram/alert`, `macro-alert`, `signals/track`, `telegram/setup-webhook`, `alert-outcomes/resolve` from unauthenticated triggering. **Confirmed unset on prod** as of 2026-07-19 (see §2). | — |

---

## 6. Native App — Android (Capacitor)

`android/` at the repo root is a Capacitor-wrapped native Android shell around the Next.js PWA, not a separate codebase.

- Application ID: `com.liquidityhq.app`, version `1.0` (`android/app/build.gradle`)
- Framework: Capacitor 8 (`@capacitor/core`, `@capacitor/android`, `@capacitor/cli` — devDependencies in `package.json`)
- Push notifications wired via `google-services.json` if present (Firebase) — the build gracefully skips the Google Services Gradle plugin if that file is absent, so push notifications silently don't work in that case rather than failing the build.

---

## 7. Core Framework & Key Dependencies

From `package.json`. **Next.js 16.2.6 is explicitly called out in `AGENTS.md` as not matching an AI assistant's training data** — read `node_modules/next/dist/docs/` before using any App Router API that hasn't been touched in this repo before.

- Next.js `16.2.6`, React `19.2.4` / React DOM `19.2.4`
- `@supabase/supabase-js` `^2.106.2`
- `klinecharts` `^10.0.0-beta3` (the Arena candlestick chart)
- `web-push` `^3.6.7`
- `posthog-js` `^1.404.1`
- `gsap` / `motion` (animation)
- Tailwind CSS v4 (`@tailwindcss/postcss`)
- TypeScript `^5`

---

## 8. Known Automation Gaps (as of 2026-07-19)

- ~~`api/macro-alert` and `api/signals/track` have no confirmed scheduler anywhere~~ — **CLOSED same day**, both wired to cron-job.org. See §2.
- ~~7 of the 11 `DASHBOARD_SECTIONS` toggles in Settings are inert~~ — **RESOLVED 2026-07-21**. Investigated each of the 7: `session` was a real gating bug (fixed, then removed along with the rest below); the other 6 (`accumulation`, `distribution`, `catalysts`, `gex`, `macro`, `commandments`) referenced widgets that either live on other pages entirely or were never built. Rather than build 6 new dashboard widgets or leave non-functional checkboxes, the user chose to remove the whole "Dashboard Sections" toggle feature - `DASHBOARD_SECTIONS`, `hidden_sections`, and the Settings UI for it no longer exist. `/dashboard` now always renders all its sections unconditionally.
- **`api/ops/spike-alert` — built 2026-07-25, NOT YET SCHEDULED.** Telegrams
  the owner (`TELEGRAM_CHAT_ID`) once today's xAI usage crosses 80% of
  `AI_GLOBAL_DAILY_MAX` (`pendings/SECURITY_AUDIT.md`'s one remaining open
  item). `checkCronAuth`-gated like the others - needs an `x-cron-secret`
  header. User is wiring this via n8n (own choice, has an existing similar
  workflow - see §3), not cron-job.org. Until that workflow exists, this
  route is genuinely dead - nothing calls it on a schedule yet. Update this
  entry once it's wired (workflow name, schedule) - don't leave it stale.
