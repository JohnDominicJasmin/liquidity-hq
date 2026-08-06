# LiquidityHQ — Infrastructure & Operations

This file exists because the codebase alone doesn't tell the whole story. `docs/ARCHITECTURE.md` documents what's *in* the repo; this file documents what runs *around* it — external services, scheduled jobs, API accounts, and hosting that a `grep` across the codebase cannot find. Several routes in this app (`api/telegram/alert`, `api/macro-alert`, `api/signals/track`, `api/alert-outcomes/resolve`) are written to run on a schedule but contain zero code that schedules them — the scheduler lives entirely outside the repo, on cron-job.org or n8n. Anyone (including an AI assistant) reading only the source code will wrongly conclude these routes are dead. They are not. Check this file first.

**Keep this file honest:** any time a new external cron job, API key, or hosted service is added for this project, add it here in the same pass. A stale version of this file is worse than no file — it actively misleads.

---

## 1. Hosting — Render

Four services, one Render account, org workspace shared with unrelated projects (`n8n workflows` is also used by other automations, not exclusive to LHQ).

| Service | Render ID | Plan | Region | Branch | URL | Purpose |
|---|---|---|---|---|---|---|
| `liquidity-hq-prod` | `srv-d8aluf6l51nc73e1ijp0` | starter | Singapore | `main` | `liquidity-hq.onrender.com` | Production. `npm install; npm run build` → `npm start`. |
| `liquidity-hq-dev` | `srv-d8prs6po3t8c739aepdg` | free | Singapore | `dev` | `liquidity-hq-dev.onrender.com` | Dev integration. Free plan — spins down after inactivity, first request after idle is slow/can fail. |
| `liquidity-hq-qa` | `srv-d9p42ke1egvs73f8car0` | free | Singapore | `qa` | `liquidity-hq-qa.onrender.com` | **Staging — the environment QA tests against.** `autoDeploy: no`, like the other two: merging `dev` → `qa` moves the branch, not the environment. Uses the **dev** Supabase project (free plan caps the account at 2 active projects, so it has none of its own). Free plan, so it sleeps when idle. |
| `n8n-workflows` | `srv-d6e4fkq4d50c73b8dpk0` | starter | Singapore | n/a (Docker image `n8nio/n8n:latest`) | `n8n-workflows-6ig6.onrender.com` | Self-hosted n8n instance, 5GB persistent disk. Shared across projects, not LHQ-exclusive. |

All three LHQ services have `autoDeploy: no` — pushing to `main`/`dev` does **not** auto-deploy. Deploys are triggered manually (via Render dashboard, the `mcp__render__trigger_deploy` tool, or `git push` if that ever changes).

`liquidity-hq-qa` is the same: `autoDeploy: no`. **No service in this project auto-deploys.** Whoever merges `dev` → `qa` triggers the qa deploy — normally dev, as part of handing the build to QA. CI runs on `qa` as well (`.github/workflows/ci.yml`), so a merge is checked even though it does not ship by itself.

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
| `LiquidityHQ - trial reminder` | `https://liquidity-hq.com/api/trial-reminder` | daily 09:00 (`0 9 * * *`, tz Asia/Manila) | **Active**, created 2026-08-07; endpoint verified by direct curl the same day (no header → 401, wrong header → 401, real header → `200 {"ok":true,"sent":0}`) | `x-cron-secret` header | Emails anyone within 2 days of their 14-day trial expiring. Trial START was announced twice (welcome email + countdown banner) but the END was silent - this is the only notice that reaches a user who is not signed in. Route is `checkCronAuth`-gated and fails CLOSED, so without this job it silently never runs. |
| `n8nreq` | `https://n8n-workflows-6ig6.onrender.com` | (was recurring) | **Inactive** (disabled) | none | Old keep-alive ping for the n8n service. Last ran 2026-03-10. |
| **`LiquidityHQ - news ingest`** | `https://liquidity-hq.com/api/news/ingest` (**POST**) | every 1 min (`* * * * *`) | **Active** - verified 2026-08-01 against prod: newest `lhq_news` row 1.3 min old, and 11 of 12 feeds reported a fresh per-source health result 30 seconds prior. (This row previously read "Needs creating" long after the job existed.) | `x-cron-secret` header | Fetches the RSS feeds + Finnhub news once and writes new rows to `lhq_news`. Clients no longer poll for news at all; they subscribe to that table over Supabase Realtime (`components/NewsProvider.tsx`). Without this job the ticker only ever shows whatever was last ingested. |
| **`LiquidityHQ - econ snapshot`** | `https://liquidity-hq.com/api/econ-calendar/ingest` (**POST**) | hourly (`0 * * * *`) | **Active** | `x-cron-secret` header | Two jobs. (1) Writes the economic calendar into `lhq_econ_snapshot` for push delivery - `/api/econ-calendar` itself stays live, since `/econ-calendar`, `EconCalendarWidget` and `api/macro-alert` read it directly. (2) **Runs the API-health alert sweep** (`lib/healthAlert.ts`) - emails the owner when a tracked dependency has failed 3 checks in a row, and again when it recovers. The sweep rides this job because it needs an hourly schedule and this is the only hourly cron; giving it its own route would have repeated `api/ops/spike-alert`, which was built 2026-07-25, never wired, and is still dead. If this job is ever deleted or repointed, health alerting silently stops - the calendar snapshot going stale would be the visible symptom, the missing alerts would not be. |

**Both new jobs must be POST, not GET** - cron-job.org defaults to GET, and these
routes only export `POST`, so a GET returns 405 and the job will look "successful"
in some dashboards while never ingesting anything. Set the method explicitly and
confirm the response body is `{"ok":true,...}`.

**Target hostname corrected 2026-08-07:** the live jobs point at the custom domain `https://liquidity-hq.com`, NOT `liquidity-hq.onrender.com` as the older rows above still say. Verified in the dashboard. The onrender.com URLs still resolve, so nothing is broken - but copy the custom domain when adding a job, to match what is actually there.

All active jobs above target **prod only**. `macro-alert` and `signals/track` were both verified working on dev too via direct curl (`liquidity-hq-dev.onrender.com`, both `200 OK`, `signals/track` genuinely logged a real signal) - the routes work fine there, there's just no cron pointed at dev for them. Confirmed intentional with the user 2026-07-19: dev is staging, doesn't need production alert cadence. Don't re-flag this as a gap.
| `dev liquidity hq environment` | `https://liquidity-hq-dev.onrender.com/` | (was recurring) | **Inactive** (disabled), last run **failed** | none | Old keep-alive ping for dev (free-tier spin-down mitigation). Last ran 2026-07-01, failed. |

**`CRON_SECRET` IS set on prod, as of the security-audit fixes (`pendings/PENDING.md`: "Cron auth fail-closed, CRON_SECRET set, verified 200 on a live cron run").** This section previously said it was unset — stale, corrected 2026-07-25. `lib/cronAuth.ts`'s `checkCronAuth()` fails CLOSED with no secret configured, so every job in the table above must send a matching `x-cron-secret` header (or `?secret=` query param) or it 401s. Any NEW cron-job.org job or n8n workflow hitting a `checkCronAuth`-gated route needs this header from the start - it will not silently work unauthenticated the way the original jobs briefly did before the fail-closed change shipped.

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
> the app owner: the **`liquidity-hq-prod`** Supabase project is the
> **production** database (used by the `liquidity-hq-prod` Render service and
> local `.env.local`), and **`liquidity-hq-dev`** is the **deployed-dev**
> database (used by the `liquidity-hq-dev` Render service). Both
> are live and actively used — this is intentional isolation (dev testing can
> never touch prod data, since it's a separate physical project, not just a
> different table prefix), not a stale/decoy situation. (Project display names
> corrected 2026-08-01 below — this paragraph uses the current names; the
> owner's confirmation and the prod/dev mapping it established still stand.)
>
> History: a 2026-07-17 audit had this backwards (called the dev project "the
> real one", the prod project an "empty decoy"). A same-day 2026-07-20 fix
> over-corrected it, calling the dev project "stale/superseded" — also wrong.
> This version is the owner-confirmed final state.

| Project name | Ref | Region | Status | Used by LHQ? |
|---|---|---|---|---|
| **`liquidity-hq-prod`** | `qdpwhnvmhqgzijuwopso` | ap-northeast-2 | Active | **Yes — production only.** The `liquidity-hq-prod` Render service points here. Holds `lhq_*` (prod) tables. |
| **`liquidity-hq-dev`** | `wdtjhrilakoitfcezxpx` | ap-northeast-1 | Active | **Yes — all dev.** Both the `liquidity-hq-dev` Render service AND local `.env.local` point here. Holds the parallel `lhq_dev_*` table set. |

> **Corrected 2026-08-01:** the two rows above were named `LiquidityHq` and
> `Automations` — stale. Confirmed directly against the Supabase API
> (`list_projects`/`get_project`, not a guess): the projects behind these two
> refs are actually named `liquidity-hq-prod` and `liquidity-hq-dev` — same
> refs, same prod/dev mapping, only the display names were wrong. This is a
> genuine naming collision to watch for: the **Supabase projects** and the
> **Render services** now share the exact names `liquidity-hq-prod` /
> `liquidity-hq-dev`. When it matters which system you mean, say "Supabase
> project" or "Render service" — don't rely on the bare name. Identify
> Supabase unambiguously by ref (`qdpwhnvmhqgzijuwopso` = prod,
> `wdtjhrilakoitfcezxpx` = dev); Render by service id (`srv-d8aluf6l51nc73e1ijp0`
> = prod, `srv-d8prs6po3t8c739aepdg` = dev).
>
> **Corrected 2026-07-30:** the row above previously said local `.env.local`
> pointed at prod. It does not - verified by reading
> `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`, which is `wdtjhrilakoitfcezxpx`
> (`liquidity-hq-dev`), with `NEXT_PUBLIC_APP_ENV=dev` so it uses the `lhq_dev_`
> prefix. Local development has never touched the prod database. Check the env
> file rather than this table if it matters - that is what made the old claim
> detectable.
| `MotoTracker` | `bseewwodijmuvpbqdgcc` | ap-northeast-2 | Inactive | No - unrelated project. |
| `Solar ROI tracker` | `trpubozqrgjllwyukfol` | ap-northeast-2 | Inactive | No - unrelated project. |

Table naming convention (enforced in code, see `docs/ARCHITECTURE.md` §8): always reference tables via `T.xxx` from `lib/tables.ts`, never a literal string. Note this only controls the `lhq_` vs `lhq_dev_` prefix *within* a project — it does NOT make dev and prod share one database; they are two separate Supabase projects entirely. Any new table needed by the deployed dev service must be created in the `liquidity-hq-dev` Supabase project, not `liquidity-hq-prod` — a "table not found in schema cache" error on the `liquidity-hq-dev` Render service after creating a table is often this, not a PostgREST cache lag.

---

## 4b. `NEXT_PUBLIC_APP_ENV` — a switch, not a label

**It has exactly two states: `dev`, and everything else. Anything that is not
the literal string `dev` selects production behaviour.**

```ts
// lib/tables.ts
const p = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_';
```

Same test in `app/api/lemonsqueezy/webhook/route.ts` (`!== 'dev'` means treat as
production), `lib/apiHealth.ts`, and `app/api/auth/ban-reason/route.ts`.

So setting it to a plausible-looking environment name — `qa`, `staging`,
`test`, `preview` — silently gives that deployment **production table names and
production webhook handling**. Nothing errors. It is a value that looks correct
and is not.

This is not hypothetical: the `liquidity-hq-qa` service was first created with
`NEXT_PUBLIC_APP_ENV=qa`, which pointed it at `lhq_*` tables. Corrected to `dev`
on 2026-08-05.

**Rule: any non-production deployment sets it to `dev`, whatever the service is
called.** It names the *data set*, not the environment. If a third value is ever
genuinely needed, change the comparisons in all four files first — a new value
without that is a silent switch to production.

It is a `NEXT_PUBLIC_*` variable, so it is **inlined at build time**. Changing it
requires a rebuild, not a restart.

### Consequence: the error tracker needs its own variable

Because `qa` must run with `NEXT_PUBLIC_APP_ENV=dev`, everything that reads that
variable as a *label* reports qa as dev. GlitchTip did exactly this — qa's errors
and dev's errors arrived under the same `dev` environment, and since the two
services also share one Supabase project, nothing else distinguished them.

The fix is **not** to change `NEXT_PUBLIC_APP_ENV`. It is
`NEXT_PUBLIC_SENTRY_ENV`, read by `lib/monitoring.ts`, falling back to
`NEXT_PUBLIC_APP_ENV` and then `production`:

| Service | `NEXT_PUBLIC_APP_ENV` | `NEXT_PUBLIC_SENTRY_ENV` | Reports as |
|---|---|---|---|
| `liquidity-hq-prod` | `prod` | unset | `prod` |
| `liquidity-hq-qa` | `dev` (required) | **`qa`** | `qa` |
| `liquidity-hq-dev` | `dev` | unset | `dev` |

The same rule applies to anything else that ever wants an environment *name*:
add a variable, do not reuse the switch.

**Note as of 2026-08-06: that label is currently inert**, because only production
reports at all — see §4c below. Keep it; it becomes live the day non-prod gets its
own GlitchTip project.

---

## 4b-2. Error reporting is production-only — and why a tag was not enough

All three services pointed at **one** GlitchTip project (`25983`) sharing **one**
1,000-event/month free quota. Dev and qa spent it. Measured 2026-08-06: a forced
error from **both** `liquidity-hq.com` and `liquidity-hq-qa.onrender.com`
returned **HTTP 429**, so *production* error reporting was dead — and nothing
said so.

`environment` does not solve this. It is a **tag**: it makes events filterable
after they arrive. It does not stop them arriving and it does not give them
separate quotas.

Structurally the same compromise as qa and dev sharing one Supabase project, and
it fails the same way — the noisy environments starve the one that matters. The
difference is that the Supabase one is documented and consciously accepted, and
this one just looked like it worked.

Two layers, on purpose:

| | |
|---|---|
| **Config** | `NEXT_PUBLIC_SENTRY_DSN` set on `liquidity-hq-prod` only |
| **Code** | `lib/monitoring.ts` returns no DSN when `NEXT_PUBLIC_APP_ENV === 'dev'` |

The code layer exists because config alone is one dashboard edit from
regressing, and the regression is **silent** — nobody discovers monitoring is off
until they need it, which is precisely when they cannot afford it to be off. A
DSN that is present but suppressed logs once at startup, so it is answerable from
the logs either way.

Because both variables are `NEXT_PUBLIC_*` and therefore inlined at build time,
the guard resolves during the build: on a non-prod build the DSN is **not in the
bundle at all**, not merely unused.

**⚠️ Clearing the variable in the dashboard does nothing to an existing build.**
Each service needs a **rebuild**, or it keeps posting from the bundle it already
has.

---

## 4c. QA service environment variables

`liquidity-hq-qa` is configured from `liquidity-hq-dev`'s values, with
deliberate exceptions. Set as of 2026-08-05:

| Variable | Value | Why |
|---|---|---|
| `NEXT_PUBLIC_APP_ENV` | `dev` | **Not `qa`** — see §4b |
| `NEXT_PUBLIC_SENTRY_ENV` | `qa` | The one place qa may call itself qa. Separates its errors from dev's in GlitchTip without touching table selection — see §4b. **Not yet set; needs adding on the qa service** |
| `NEXT_PUBLIC_APP_URL` | `https://liquidity-hq-qa.onrender.com` | Its own URL, never dev's. Telegram webhook registration and email links build absolute URLs from this |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | dev project `wdtjhrilakoitfcezxpx` | Shares the dev database — see §1 |
| `SUPABASE_SERVICE_ROLE_KEY` | dev project's | Server routes return empty results without it. `/api/labels` answered `{}` until it was set |
| `AI_GLOBAL_DAILY_MAX` | `25` | Low cap. QA testing spends real xAI credit |
| `CMC_API_KEY`, `FINNHUB_KEY`, `GROK_API_KEY` | copied from dev | Shares dev's quota |

**Deliberately unset, do not "fix" these:**

| Variable | Why not |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | QA test runs would land in product analytics and corrupt the numbers |
| `LEMONSQUEEZY_WEBHOOK_SECRET` etc. | Payments. Staging has no business holding these |
| `CRON_SECRET` | Cron routes fail **closed** without it (`lib/cronAuth.ts`), which is the desired state on staging |

### Telegram on QA — currently dev's bot, safe only by accident

**`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_WEBHOOK_SECRET` on the
qa service are copies of dev's.** That is not the intended end state.

Why it has not broken anything yet: registering a webhook goes through
`/api/telegram/setup-webhook`, which is gated by `checkCronAuth`, and
`CRON_SECRET` is **unset** on qa. `checkCronAuth` fails **closed** with no secret
configured, so the route answers 401 and qa cannot re-register the webhook.
Verified 2026-08-05: `GET /api/telegram/setup-webhook` on qa returns
`{"error":"Unauthorized"}`.

**So the safety property is: qa must not have `CRON_SECRET` while it shares
dev's bot token.** Setting `CRON_SECRET` on qa without first giving it its own
bot hands qa the ability to point dev's bot at itself, silently stealing every
alert. That is the bug that already cost a day on this project.

What qa can still do today: send outbound messages into the real dev chat during
test runs. Noisy, not destructive. It cannot receive anything - the webhook
points at dev - so `/start`, account linking and bot commands are untestable on
qa either way.

The fix is a dedicated QA bot; see `pendings/PENDING.md`. Until then, treat
`CRON_SECRET` on qa as forbidden rather than merely absent.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is domain-locked. Copying dev's value is not
enough — add `liquidity-hq-qa.onrender.com` to that widget's allowed domains in
Cloudflare, or the login captcha fails on the qa host only.

---

## 5. Third-Party APIs

From `.env.example` — the authoritative list of what needs a key. Whether each key is actually *set* on Render (prod/dev) is not visible to an assistant; only that the app expects it.

| Service | Env var(s) | Used for | Tier |
|---|---|---|---|
| Supabase | `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | DB, auth. Without these, Arena signal history + Cluster Tracker are disabled but the rest of the app works. | — |
| CoinMarketCap | `CMC_API_KEY` | BTC/ETH dominance, Alt Season Index | — |
| PostHog | `NEXT_PUBLIC_POSTHOG_KEY`, `NEXT_PUBLIC_POSTHOG_HOST` | Product analytics | — |
| Grok (xAI) | `GROK_API_KEY` | AI chat/analysis features (Ask AI, briefing generation, dry-powder/macro-context routes) | — |
| Coinglass | `COINGLASS_API_KEY` | BTC liquidation heatmap (Arena), exchange net flow — **both DISABLED, see below** | **No free API tier** ($29–699/mo) |
| Finnhub | `FINNHUB_KEY` | (economic calendar / macro data) | — |
| Telegram Bot API | `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `TELEGRAM_WEBHOOK_SECRET` | Alert delivery channel | — |
| Web Push (VAPID) | `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_EMAIL` | Browser push notifications | — |
| Binance / Bybit public REST | none (no key) | Live price ticker used by `api/alert-outcomes/resolve` and elsewhere | Public, unauthenticated |
| `CRON_SECRET` | `CRON_SECRET` | Meant to protect `telegram/alert`, `macro-alert`, `signals/track`, `telegram/setup-webhook`, `alert-outcomes/resolve` from unauthenticated triggering. **Confirmed unset on prod** as of 2026-07-19 (see §2). | — |

**Coinglass is dead upstream (2026-07-30).** The row above previously claimed a
free tier; that was wrong and it cost real debugging time. What is actually true:

- The app called `open-api.coinglass.com/public/v2/{exchange_amount_chart,liquidation_chart}`.
  Coinglass retired that API. Both return HTTP 500 for every symbol, **including
  with `COINGLASS_API_KEY` attached** - confirmed through prod's own proxy.
- The v4 replacement (`open-api-v4.coinglass.com`) is live and the key is valid,
  but this account's tier returns `{"code":"401","msg":"Upgrade plan"}`. An
  invalid key returns `400 Invalid API key provided`, which is how we know the
  key itself is fine.
- **There is no free Coinglass API tier.** Plans run $29/mo (Hobbyist) to
  $699/mo, and Coinglass does not publish which tier includes the
  exchange-balance or liquidation endpoints - so ask their support which tier
  covers `/api/exchange/balance/chart` *before* paying.

Both features failed soft and still do: `btcExchangeNetFlow` stays null, and the
Arena liquidation card renders conditionally on `btcLiqLevels.length` so it just
does not appear. No user ever saw a wrong number. `fetchCoinglassData` and its
15-minute interval were removed from `components/MarketProvider.tsx` so the two
doomed requests per tab stop firing; the store fields, prompt lines, proxy
branches and heatmap component are all still wired, so restoring is a URL and
parsing change, not a rebuild.

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
