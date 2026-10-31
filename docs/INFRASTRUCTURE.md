# LiquidityHQ — Infrastructure & Operations

This file exists because the codebase alone doesn't tell the whole story. `docs/ARCHITECTURE.md` documents what's *in* the repo; this file documents what runs *around* it — external services, scheduled jobs, API accounts, and hosting that a `grep` across the codebase cannot find. Several routes in this app (`api/telegram/alert`, `api/macro-alert`, `api/signals/track`, `api/alert-outcomes/resolve`) are written to run on a schedule but contain zero code that schedules them — the scheduler lives entirely outside the repo, on cron-job.org or n8n. Anyone (including an AI assistant) reading only the source code will wrongly conclude these routes are dead. They are not. Check this file first.

**Keep this file honest:** any time a new external cron job, API key, or hosted service is added for this project, add it here in the same pass. A stale version of this file is worse than no file — it actively misleads.

---

## 1. Hosting — Render

Five services, one Render account, org workspace shared with unrelated projects (`n8n workflows` is also used by other automations, not exclusive to LHQ).

**Four branches, four LHQ services, and since 2026-08-07 the hostname finally
tells you the branch** — `dev`, `qa`, `staging` and `main` each have their own.
This table said the opposite until 2026-08-08: it claimed `staging` was "a
release-candidate branch with no environment of its own" and called
`liquidity-hq-qa` "the QA test environment". Both were true for about six hours
on 2026-08-07 and were corrected in `render.yaml` the same day but not here — so
this table, which is where people actually look, kept asserting it. QA wrote a
doc from it on 2026-08-08 and put the wrong host in front of the test plan.
Anything created outside this repo has to be recorded in THIS table, not only in
`render.yaml`.

| Service | Render ID | Plan | Region | Branch | URL | Purpose |
|---|---|---|---|---|---|---|
| `liquidity-hq-prod` | `srv-d8aluf6l51nc73e1ijp0` | starter | Singapore | `main` | `liquidity-hq.onrender.com` | Production. `npm install; npm run build` → `npm start`. Health check path `/api/version` (set by the owner 2026-10-20 17:16 UTC; see "Health, monitoring and alerts" below). |
| `liquidity-hq-dev` | `srv-d8prs6po3t8c739aepdg` | free | Singapore | `dev` | `liquidity-hq-dev.onrender.com` | Dev integration. Free plan — spins down after inactivity, first request after idle is slow/can fail. Deployed by **PM/DevOps** only when a deployed check is genuinely needed (assigned 2026-09-07; ~500 build-hour/month cap). |
| `liquidity-hq-staging` | `srv-d9qskniju40c73brtqgg` | free | Singapore | `staging` | `liquidity-hq-staging.onrender.com` | **The environment QA tests and signs off on.** Created 2026-08-07 12:06. Serves the release candidate, so what QA tests IS the release rather than a branch dev keeps advancing. `autoDeploy: no` — **QA promotes `qa` → `staging` and deploys it** (both halves; see the promotion table below). Uses the **dev** Supabase project. Free plan, sleeps when idle. |
| `liquidity-hq-qa` | `srv-d9p42ke1egvs73f8car0` | free | Singapore | `qa` | `liquidity-hq-qa.onrender.com` | **Dev's integration site, not QA's.** Serves `qa`, which dev promotes into freely; it exists so dev can confirm a promotion before QA sees it. `autoDeploy: no` — dev promotes `dev` → `qa`, **QA triggers the deploy** and says so. Uses the **dev** Supabase project (free plan caps the account at 2 active projects, so neither non-prod service has one of its own). Free plan, sleeps when idle. |
| `n8n-workflows` | `srv-d6e4fkq4d50c73b8dpk0` | starter | Singapore | n/a (Docker image `n8nio/n8n:latest`) | `n8n-workflows-6ig6.onrender.com` | Self-hosted n8n instance, 5GB persistent disk. Shared across projects, not LHQ-exclusive. |

**All four LHQ services have `autoDeploy: no`. No service in this project auto-deploys.** Pushing to any branch deploys nothing; every deploy is triggered by a person (Render dashboard, or the `mcp__render__trigger_deploy` tool).

That applies to each hop, and the person differs:

| Promotion | Who promotes | Who deploys | Which service |
|---|---|---|---|
| `dev` → `qa` | dev | **QA**, and says so | `liquidity-hq-qa` |
| `qa` → `staging` | **QA** | **QA** | `liquidity-hq-staging` |
| `staging` → `main` | **PM/DevOps**, with the owner's approval for that release | **PM/DevOps**, with the owner's approval for that release. Never dev. | `liquidity-hq-prod` |
| (no promotion) | — | **PM/DevOps**, only when a deployed check is needed | `liquidity-hq-dev` |

**Updated 2026-10-21 to match `CLAUDE.md` ("Who DEPLOYS", "Who MERGES"), which is
the authority.** Until then this table said dev deploys `qa` and `staging` and QA
merges and deploys production. All three changed: on 2026-09-03 dev came under a
standing owner instruction to deploy no environment without the owner's go each
time; QA has deployed `qa` and `staging` since (QA has the Render tools too, so the
2026-08-10 premise that only dev could deploy was wrong); and on 2026-09-05 the
owner gave the `staging` → `main` merge and the production deploy to PM/DevOps.
The 2026-08-09 lesson still holds: a branch that moved while its service did not
serves old code under a new commit message, so whoever promotes says so and the
deploy follows at once, checked against `/api/version`.

Production is the exception that keeps the gate meaningful: PM/DevOps merges and
deploys it only with the owner's approval for that release, and only after QA's
sign-off. Dev deploys nothing, even if asked through GitHub.

**A promotion into `qa` or `staging` fires no CI at all**, and that is deliberate — `.github/workflows/ci.yml` lists `push` branches as `[dev, main]` only. Both promotions are fast-forward, so the commit landing is bit-identical to one already tested on `dev`, and re-running would bill a second full suite for the same tree. Do not read a quiet Actions tab after a promotion as a failure to run.

### Credentials with an expiry date

| Secret | Purpose | **Expires** |
|---|---|---|
| `RELEASE_PAT` | Lets `release-signals.yml` open the `staging` → `main` release PR | **2027-08-09** |

**Why a PAT rather than the built-in token.** GitHub does not trigger workflows
on events created by `GITHUB_TOKEN` — a deliberate loop-breaker. A release PR
opened by the bot therefore never fires `pull_request`, so `CI Gate` is **absent
rather than failing**, and `main` requires it. The PR sits unmergeable with
nothing red to explain why. Diagnosed on 2026-08-08 (issue #126) after a
promotion looked entirely successful and the checks never queued.

**What happens when it expires.** The release PR stops opening. The step **fails
rather than falling back** — `release-pr-failed` then opens an issue carrying the
release body it had already built, on a **different credential** (`github.token`)
so one expiry cannot silence the primary and the announcement together. That
separation is deliberate and load-bearing; see the comment on that job before
"tidying" the PAT up to a workflow-level `env:`.

Loud, and non-blocking: QA opens the PR by hand from that issue while the token is
rotated. But **the symptom is "the release PR did not appear", and this table is
the only place that connects that to a date.**

Fine-grained, scoped to this repository only: contents read, pull requests
read+write, issues read+write. Issues write is load-bearing — it is what lets the
fallback announce itself.

### The URL is fixed at creation and a rename cannot change it

**Render derives a service's hostname from its slug when the service is created, and renaming the service afterwards does not move the URL.** A renamed service keeps serving on its original hostname indefinitely.

This is recorded because acting on the opposite belief cost real time on 2026-08-07: `liquidity-hq-qa` was renamed rather than replaced, the rename was assumed to have moved the hostname with it, and `NEXT_PUBLIC_APP_URL` was pointed at a host that returned 404. The fix was a new service — `liquidity-hq-staging`, created 2026-08-07 12:06 — because that is the only way to get a different hostname.

So when a hostname and a service name disagree, **the hostname is the older fact.** Read the URL column of the table above, never the service name, and never infer either from the branch.

### Health, monitoring and alerts (recorded 2026-10-21)

- **Render health check (production):** `healthCheckPath` = `/api/version`, set by the owner on 2026-10-20 at 17:16 UTC and verified by PM via the Render API. Render stops routing to, and restarts, an instance that stops answering. Before that, Render only checked that the port accepted a connection.
- **Outside uptime alert:** the cron-job.org job `liquidity hq` (id 7680800, `GET https://liquidity-hq.com/` every 5 min, §2) notifies all of the owner's notification channels when the check fails twice in a row (~5-10 min down), when it recovers, when the job would be disabled, and when the TLS certificate expires within 7 days. Set by PM, owner-approved, 2026-10-21 09:43 UTC (#1594). **This is the check that catches a crash:** the out-of-memory abort of 2026-10-21 05:55 UTC never reached GlitchTip, because a crashed process cannot report itself.
- **GlitchTip is not used for uptime:** the free plan allows 1,000 events/month, and a 60-second monitor would use ~43,200, which would stop production error reporting.
- **Dependabot alerts:** switched on 2026-10-21 09:26 UTC at the owner's request (#1632). 59 open alerts at 09:55 UTC (`next` x17, 3 of them critical). PM files High and Critical ones on #1632. Secret scanning is a paid GitHub product and is off.
- **Node version:** Render builds use **Node 24.14.1**, Render's default; `NODE_VERSION` is **not pinned** (read from a build log, 2026-10-21; pinning is an env-var change, the owner's call).
- **The outbound IP is shared:** "Outbound IP ranges are shared across all services in the same region" (render.com/docs/static-outbound-ip-addresses). Every per-IP limit we depend on (Binance, Bybit, OKX, Hyperliquid) is shared with other Render customers. Dedicated outbound IPs are a paid option and are not taken (#1649).

`render.yaml` in this repo has **no cron job definitions** — Render's own Cron Jobs feature is not used anywhere for this project (it has no free tier, unlike the alternatives below).

---

## 2. External Scheduling — cron-job.org

Account: `console.cron-job.org` (external, separate login — not in this repo, not in Render, not discoverable by reading code). Login is the user's own; an AI assistant working on this repo has no visibility into this dashboard unless explicitly given the URL and asked to check it.

**Every job in this table that carries the `x-cron-secret` header targets `liquidity-hq.com`, and
no non-production service has a secret-bearing job — by decision, 2026-09-26: a production secret
must never be copied to `dev`, `qa` or `staging`.** That decision is minuted on the
**market-ingest** row below, and it applies to every secret-bearing row; for the others it is
otherwise inferable only from the hostname, which has now been re-derived twice.

**The practical consequence, because it has produced a false conclusion:** a `CRON_SECRET`-gated
route **cannot** be observed firing on `qa` or `staging` — not "has not fired yet", but *is never
called there*. On 2026-10-27 a seven-day search of `qa` logs for an ingest log line found nothing
and was read as a pending observation; the line can only ever appear in **production** logs. The two
rows below that do point at non-production hosts (`n8nreq`, `dev liquidity hq environment`) are
both **Inactive** and were unauthenticated keep-alive pings, so they are not exceptions to the rule
— they carried no secret to leak.

| Job name | Target | Schedule | Status | Auth | Purpose |
|---|---|---|---|---|---|
| `liquidity hq` | `https://liquidity-hq.com/` | every 5 min | **Active**, succeeding | none | Keep-alive and **uptime alert** for prod root (id 7680800). Since 2026-10-21 09:43 UTC it notifies the owner on 2 failures in a row, on recovery, before auto-disable, and on TLS expiry within 7 days (#1594). |
| `LiquidityHQ` | `https://liquidity-hq.com/api/telegram/alert` | every 5 min (`*/5 * * * *`, tz Asia/Manila) | **Active**, succeeding | none (no custom headers sent) | The actual Telegram/Web Push alert scanner — RSI, EMA crosses, whale trades, OI spikes, news, fear/greed. See `docs/ARCHITECTURE.md` §7. |
| `LiquidityHQ - macro-alert` | `https://liquidity-hq.com/api/macro-alert` | every 5 min (`*/5 * * * *`, tz Asia/Manila) | **Active**, confirmed succeeding (200 OK, first tick 2026-07-19 6:25 PM) | none | Economic-calendar event alerts (FOMC/NFP/CPI/etc). Wired 2026-07-19 — see §8, was previously the confirmed gap. |
| `LiquidityHQ - signals/track` | `https://liquidity-hq.com/api/signals/track` | every 15 min (`*/15 * * * *`, tz Asia/Manila) | **Active**, route confirmed live via direct curl (200 OK) same day; first scheduled tick pending at creation time | none | Live EMA Ribbon signal detection + resolution (majors, 1h/4h) feeding `/live-tracking`. Wired 2026-07-19 — see §8, was previously the confirmed gap. |
| `LiquidityHQ - trial reminder` | `https://liquidity-hq.com/api/trial-reminder` | daily 09:00 (`0 9 * * *`, tz Asia/Manila) | **Active**, created 2026-08-07; endpoint verified by direct curl the same day (no header → 401, wrong header → 401, real header → `200 {"ok":true,"sent":0}`) | `x-cron-secret` header | Emails anyone within 2 days of their 14-day trial expiring. Trial START was announced twice (welcome email + countdown banner) but the END was silent - this is the only notice that reaches a user who is not signed in. Route is `checkCronAuth`-gated and fails CLOSED, so without this job it silently never runs. |
| `n8nreq` | `https://n8n-workflows-6ig6.onrender.com` | (was recurring) | **Inactive** (disabled) | none | Old keep-alive ping for the n8n service. Last ran 2026-03-10. |
| `dev liquidity hq environment` | `https://liquidity-hq-dev.onrender.com/` | (was recurring) | **Inactive** (disabled), last run **failed** | none | Old keep-alive ping for dev (free-tier spin-down mitigation). Last ran 2026-07-01, failed. |
| **`LiquidityHQ - news ingest`** | `https://liquidity-hq.com/api/news/ingest` (**POST**) | every 1 min (`* * * * *`) | **Active** - verified 2026-08-01 against prod: newest `lhq_news` row 1.3 min old, and 11 of 12 feeds reported a fresh per-source health result 30 seconds prior. (This row previously read "Needs creating" long after the job existed.) | `x-cron-secret` header | Fetches the RSS feeds + Finnhub news once and writes new rows to `lhq_news`. Clients no longer poll for news at all; they subscribe to that table over Supabase Realtime (`components/NewsProvider.tsx`). Without this job the ticker only ever shows whatever was last ingested. |
| **`LiquidityHQ - market ingest`** | `https://liquidity-hq.com/api/market/ingest` (**POST**) | every 5 min (`*/5 * * * *`) | **Active** - created 2026-09-26 by cloning the news-ingest job, so the production secret header was copied inside the browser and never typed or read. **Verified against prod the same day:** `lhq_market_snapshot` went from empty to two rows (`bybit:account-ratio:1h`, `bybit:open-interest:1h:3`), written 18 s after the first 05:20:00Z run, and the routes stopped logging "no snapshot row yet - serving live". | `x-cron-secret` header | Refreshes the saved market data that visitors read instead of calling the exchange (#1404, #1412). Without it production keeps working but calls the exchange live every time (slower, more upstream calls). **`qa` has no such job, by decision (2026-09-26):** the saved-data protection matters for production under traffic, and a production secret must never be copied to `qa`. |
| **`LiquidityHQ - econ snapshot`** | `https://liquidity-hq.com/api/econ-calendar/ingest` (**POST**) | hourly (`0 * * * *`) | **Active** | `x-cron-secret` header | Two jobs. (1) Writes the economic calendar into `lhq_econ_snapshot` for push delivery - `/api/econ-calendar` itself stays live, since `/econ-calendar`, `EconCalendarWidget` and `api/macro-alert` read it directly. (2) **Runs the API-health alert sweep** (`lib/healthAlert.ts`) - emails the owner when a tracked dependency has failed 3 checks in a row, and again when it recovers. The sweep rides this job because it needs an hourly schedule and this is the only hourly cron; giving it its own route would have repeated `api/ops/spike-alert`, which was built 2026-07-25 and sat unwired for two weeks (it is wired now, via n8n — see §3). If this job is ever deleted or repointed, health alerting silently stops - the calendar snapshot going stale would be the visible symptom, the missing alerts would not be. |

**Both new jobs must be POST, not GET** - cron-job.org defaults to GET, and these
routes only export `POST`, so a GET returns 405 and the job will look "successful"
in some dashboards while never ingesting anything. Set the method explicitly and
confirm the response body is `{"ok":true,...}`.

**Target hostnames corrected in the rows themselves 2026-08-08.** Every active job
uses the custom domain `https://liquidity-hq.com`. Four rows previously said
`liquidity-hq.onrender.com` and carried a footnote saying "the rows above are
wrong" — the rows are now right and the footnote is gone, because a table nobody
can trust without reading a correction underneath it is worse than no table.
Note the asymmetry with §3: **cron-job.org jobs use `liquidity-hq.com`, the n8n
workflows use `liquidity-hq.onrender.com`.** Both resolve to prod. Copy whichever
the tool next to it already uses.

All active jobs above target **prod only** — re-verified 2026-08-08 by reading the
full job list in the dashboard (9 rows returned; the dashboard counter
independently reports 7 enabled + 2 disabled = 9, so nothing is hidden behind a
folder filter). `macro-alert` and `signals/track` were both verified working on
dev too via direct curl (`liquidity-hq-dev.onrender.com`, both `200 OK`,
`signals/track` genuinely logged a real signal) - the routes work fine there,
there's just no cron pointed at dev for them. Confirmed intentional with the user
2026-07-19: dev is staging, doesn't need production alert cadence. Don't re-flag
this as a gap.

**Nothing is scheduled against `liquidity-hq-qa.onrender.com` or
`liquidity-hq-staging.onrender.com`, in either tool.** Checked 2026-08-08 because
`CRON_SECRET` turned up set on qa (§4c) and the answer decided whether that was
cheap to remove or needed a dedicated bot first. It was cheap.

**`CRON_SECRET` IS set on prod, as of the security-audit fixes (`pendings/PENDING.md`: "Cron auth fail-closed, CRON_SECRET set, verified 200 on a live cron run").** This section previously said it was unset — stale, corrected 2026-07-25. `lib/cronAuth.ts`'s `checkCronAuth()` fails CLOSED with no secret configured, so every job in the table above must send a matching `x-cron-secret` header (or `?secret=` query param) or it 401s. Any NEW cron-job.org job or n8n workflow hitting a `checkCronAuth`-gated route needs this header from the start - it will not silently work unauthenticated the way the original jobs briefly did before the fail-closed change shipped.

**`api/macro-alert` and `api/signals/track` schedule gap — CLOSED 2026-07-19.** Both wired to cron-job.org (see rows above), matching `telegram/alert`'s existing pattern rather than adding a third scheduling tool. `signals/track`'s route has no Binance→Bybit failover on fetch failure (unlike `alert-outcomes/resolve`, which tries both concurrently) — a pre-existing code characteristic, not something this wiring pass touched; worth hardening later if Binance rate-limiting becomes a recurring problem for that route specifically.

---

## 3. Workflow Automation — n8n

Self-hosted, see §1. Login is separate from Render/Supabase/cron-job.org — another credential silo an assistant can't see into without being handed the URL.

Project: **Personal** → folder **`liquidityhq`**, on the n8n host in §1.

> The full admin deep link used to sit here, project and folder IDs included.
> Trimmed 2026-09-05: **this repo is public**, and a direct link into the
> workflow editor is a starting point rather than a maintainer's need — the
> host is already in §1 and anyone with a login reaches the folder by name in
> two clicks. Nothing operational is lost; the reconnaissance shortcut is.

| Workflow | Trigger | Action | Status |
|---|---|---|---|
| `LHQ - Resolve Alert Outcomes (hourly)` | Schedule Trigger, Custom Cron `0 0 * * * *` (top of every hour) | HTTP Request `GET https://liquidity-hq.onrender.com/api/alert-outcomes/resolve` | Published/active as of 2026-07-19. Resolves the 24h/48h alert-outcome windows for `lhq_alert_fires` (Tier 2 backlog item #10). |
| `LHQ - AI Spike Alert` | Schedule Trigger | HTTP Request `GET https://liquidity-hq.onrender.com/api/ops/spike-alert` | **Published**, confirmed 2026-08-08. Telegrams the owner once today's xAI spend crosses 80% of `AI_GLOBAL_DAILY_MAX`. Closes the last open item in §8 — that entry claimed this route was "genuinely dead" for two weeks after it had been wired. |

**These are the only two LHQ workflows.** The instance holds 38 in total; the other
36 belong to unrelated projects (`avmoto-*`, Vapi, Proposal Tracker, Solar ROI,
demos) and are not LiquidityHQ's. Both LHQ workflows live in the folder linked
above and both target **prod**.

Scope of that check, stated so it is not over-read: the two LHQ workflows were
opened and their HTTP Request node URLs read directly. The other 36 were matched
by name and project only, not opened. A workflow in someone else's project could
in principle call an LHQ host without saying so in its name.

**Read the node URL from the DOM, not the canvas.** n8n truncates the node
subtitle to `GET: https://liquidity-hq.onre...` — and a **qa** URL truncates to a
near-identical string. Anyone eyeballing the canvas to confirm "it points at prod"
will confirm it either way.

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

| Project name | Region | Status | Used by LHQ? |
|---|---|---|---|
| **`liquidity-hq-prod`** | ap-northeast-2 | Active | **Yes — production only.** The `liquidity-hq-prod` Render service points here. Holds `lhq_*` (prod) tables. |
| **`liquidity-hq-dev`** | ap-northeast-1 | Active | **Yes — all dev.** Both the `liquidity-hq-dev` Render service AND local `.env.local` point here. Holds the parallel `lhq_dev_*` table set. |

**Refs are deliberately not listed here.** They are public by design — a
Supabase ref is the hostname in every `NEXT_PUBLIC_SUPABASE_URL`, so it ships in
the browser bundle and hiding it would achieve nothing. What is worth not
publishing is this file **telling a reader which ref is production**, on a page
that also documents that production has no backups. Read the ref off
`NEXT_PUBLIC_SUPABASE_URL` for the environment you are actually in — the Render
service's env vars, or `.env.local` locally. That is one lookup, it cannot go
stale, and it answers for the environment in front of you rather than for a
table someone edited months ago.

> **Corrected 2026-08-01:** the two rows above were named `LiquidityHq` and
> `Automations` — stale. Confirmed directly against the Supabase API
> (`list_projects`/`get_project`, not a guess): the projects behind these two
> refs are actually named `liquidity-hq-prod` and `liquidity-hq-dev` — same
> refs, same prod/dev mapping, only the display names were wrong. This is a
> genuine naming collision to watch for: the **Supabase projects** and the
> **Render services** now share the exact names `liquidity-hq-prod` /
> `liquidity-hq-dev`. When it matters which system you mean, say "Supabase
> project" or "Render service" — don't rely on the bare name. Identify
> Supabase unambiguously by ref — read from `NEXT_PUBLIC_SUPABASE_URL`, not from
> this file — and Render by service id, which is in the §1 table.
>
> **Corrected 2026-07-30:** the row above previously said local `.env.local`
> pointed at prod. It does not - verified by reading
> `NEXT_PUBLIC_SUPABASE_URL` in `.env.local`, which resolves to the **dev**
> project, with `NEXT_PUBLIC_APP_ENV=dev` so it uses the `lhq_dev_` prefix. Local development has never touched the prod database. Check the env
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
| `NEXT_PUBLIC_SENTRY_ENV` | `qa` | The one place qa may call itself qa. Separates its errors from dev's in GlitchTip without touching table selection — see §4b. **Set — confirmed in the dashboard 2026-08-08** (this row previously read "not yet set") |
| `NEXT_PUBLIC_APP_URL` | `https://liquidity-hq-qa.onrender.com` | Its own URL, never dev's. Telegram webhook registration and email links build absolute URLs from this |
| `NEXT_PUBLIC_SUPABASE_URL` / `_ANON_KEY` | the **dev** Supabase project | Shares the dev database — see §1 |
| `SUPABASE_SERVICE_ROLE_KEY` | dev project's | Server routes return empty results without it. `/api/labels` answered `{}` until it was set |
| `AI_GLOBAL_DAILY_MAX` | `25` | Low cap. QA testing spends real xAI credit |
| `CMC_API_KEY`, `FINNHUB_KEY`, `GROK_API_KEY` | copied from dev | Shares dev's quota |

**Deliberately unset, do not "fix" these:**

| Variable | Why not |
|---|---|
| `NEXT_PUBLIC_POSTHOG_KEY` | QA test runs would land in product analytics and corrupt the numbers. **Also enforced in code since 2026-08-08** — `analyticsKey()` in `lib/analytics.ts` returns `''` whenever `NEXT_PUBLIC_APP_ENV` is `dev`, so a non-prod build cannot write into the single shared PostHog project even if someone sets the variable. dev and prod were found serving the *same* key that day |
| `NEXT_PUBLIC_SENTRY_DSN` | Prod only. All environments share one GlitchTip project on the free tier; non-prod traffic exhausted the quota once and production reported nothing at all — every envelope came back 429 |
| `LEMONSQUEEZY_WEBHOOK_SECRET` etc. | Payments. **This row is about the QA service and is still true there.** It said "staging has no business holding these" until 2026-08-11, which stopped being true that day: staging now holds a **test-mode** secret and checkout URL for the #243 purchase run. Test mode, on a service using the dev database — see §4d |
| `CRON_SECRET` | Cron routes fail **closed** without it (`lib/cronAuth.ts`), which is the desired state on any non-prod host. Was wrongly set on qa 2026-08-05 → 2026-08-08; removed, see below |

### Brevo is set on EVERY environment, on purpose

`BREVO_API_KEY` and `BREVO_SENDER_EMAIL` are on prod, dev, qa **and** staging.
Decided 2026-08-08. That is a deliberate exception to the usual "non-prod holds
as little as possible" rule, and the reason is worth keeping:

**`lib/email.ts` fails silently.** Every sender returns `false` when the keys are
missing rather than throwing, so an unconfigured environment is indistinguishable
from "nobody was due". QA hit exactly this: the trial-reminder path could only be
proven on a deployed environment, because local `.env.local` has no Brevo keys
and the route reported success while sending nothing.

So an environment without the keys cannot test email *and cannot tell that it is
not testing email*. Dev needs them to verify its own work before promoting;
staging needs them because that is where QA signs off. qa keeps them because
removing them buys nothing once the other three have them.

**What this costs, stated so it is not a surprise:** one Brevo account, one
sending quota, one sender reputation, shared by all four. Test-run bounces would
count against the reputation production depends on. If prod email ever starts
landing in spam, check what non-prod has been sending before looking anywhere
else.

**What limits the blast radius:** of the six senders, four go to the owner or
admins (`sendSpikeAlertEmail`, `sendHealthAlertEmail`, `sendAdminAddedEmail`, and
`sendBanEmail` in practice). Only welcome, ban and trial-ending reach ordinary
users — and on dev, qa and staging those tables are the **dev** Supabase project,
so the recipients are test accounts rather than real customers.

### `SPIKE_ALERT_RECIPIENTS` — a second way to send nothing and look fine

Added 2026-09-05 (#824). The AI-spend spike alert used to hold its two recipient
addresses in `lib/email.ts`; this repo is public, so they moved to an env var:
**comma-separated, server-only, NOT `NEXT_PUBLIC_`** — that prefix inlines the
value into the browser bundle and would publish them again by a longer route.

| Service | Needs it | Why |
|---|---|---|
| `liquidity-hq-prod` | **Yes** | The only service that runs the alert. n8n triggers `LHQ - AI Spike Alert` against the prod host — see §3. |
| dev / qa / staging | No | They do not run it. Setting it is harmless and buys nothing. |

**Unset means the alert is built and sent to an empty list.** It does not throw
and it does not warn: `sendSpikeAlertEmail` returns the same way it would if the
send had worked.

That is deliberate — an alert going nowhere beats one hardcoded to a person's
inbox in a public repo — but read it against the paragraphs above, because it is
**the same failure shape as a missing `BREVO_API_KEY`, one layer in.** Brevo
missing means no environment can send; this missing means one environment sends
to nobody. Both are indistinguishable from "nobody was due", and the spike alert
is the one that only fires when something has already gone wrong with spend.

If the alert is what you are relying on to notice a runaway xAI bill, **check the
variable is set rather than inferring it from silence.**

### Telegram on QA — currently dev's bot, safe only by accident

**`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` and `TELEGRAM_WEBHOOK_SECRET` on the
qa service are copies of dev's.** That is not the intended end state.

Registering a webhook goes through `/api/telegram/setup-webhook`, which is gated
by `checkCronAuth`. That guard is **all-or-nothing**: `lib/cronAuth.ts` returns
false when `CRON_SECRET` is unset, so the variable's presence unlocks **all
nine** `CRON_SECRET`-guarded routes at once, not just this one —
`telegram/{setup-webhook,alert}`, `alert-outcomes/resolve`,
`econ-calendar/ingest`, `macro-alert`, `news/ingest`, `ops/spike-alert`,
`signals/track`, `trial-reminder`. Count it with
`grep -rln "checkCronAuth(" app/api --include=route.ts` — **with the paren.**

**`api/telegram/webhook` is guarded, but not by this secret.** It checks
`TELEGRAM_WEBHOOK_SECRET` against the `x-telegram-bot-api-secret-token` header
Telegram echoes back. Different secret, different rotation story: rotating an
environment's `CRON_SECRET` changes what nine routes accept, rotating its
`TELEGRAM_WEBHOOK_SECRET` changes one and only after `setup-webhook` is called
again. Worth keeping straight now that staging has its own of both.

**This number was wrong twice before it was right.** Eleven (counted from a
too-loose grep), then ten. The ten came from `grep -rl checkCronAuth` without the
paren, which matched a **comment** in `telegram/webhook/route.ts` reading "same
as checkCronAuth". A grep that matches prose looks exactly like a grep that
matches code — which is also how `api/version/route.ts` gets miscounted, since
its comment mentions gating it behind `checkCronAuth` if it ever grows.

`api/telegram/bot-info` is **not** in that set and should not be added to it. It
is public and rate-limited, and deliberately **read-only** — it reports a webhook
mismatch rather than fixing one. It used to call `setWebhook` itself, which made
an unauthenticated GET fired by every `/alerts` page load able to repoint where
Telegram delivers updates; that was the 2026-08-03 hijack. Registration lives in
`setup-webhook` behind the secret precisely so this route does not need it.

> ### ✅ Resolved 2026-08-08 — `CRON_SECRET` removed from qa
>
> It had been **set** on qa while this section claimed it was unset, from
> 2026-08-05 until 2026-08-08. The whole safety argument below rested on that
> claim. Removed by the owner and redeployed (`dep-d9r0mvn40ujc73986dfg`, live
> 16:46 UTC); confirmed absent in the Render dashboard afterwards — 22 variables
> where there were 23, with Telegram, VAPID and Brevo untouched.
>
> **How it was found, since the same trap will recur.** Not by a test and not by
> the app — by reading the dashboard directly after two external probes of mine
> returned confident nonsense. There is no automated check that any environment's
> variables match what this file says, which is the gap issue #78 exists to close.
>
> **Why the route could not tell us.** `checkCronAuth` fails closed, so
> `/api/telegram/setup-webhook` answers `401` whether the secret is absent, wrong,
> or the wrong length. Before and after removal look identical from outside. Any
> future check of this has to read the dashboard — probing the endpoint proves
> nothing in either direction.

**The rule, stated so it does not need re-deriving.** An environment should have
`CRON_SECRET` only when **both** hold:

1. **Something on that host legitimately needs to call a cron-guarded route** —
   either a scheduler pointed at it, or a deliberate one-off operation such as
   registering that environment's *own* Telegram webhook.
2. **The environment owns its own side-effect credentials** — bot token, chat id,
   database, mail sender.

qa fails both today. Nothing is scheduled against it (§2), and the one manual
operation that would need the secret — webhook registration — is precisely the
thing that must not happen while the bot belongs to dev. And it borrows dev's bot,
dev's Supabase and dev's Brevo, so anything its cron routes trigger produces
effects attributed to **dev**: messages into the real dev chat, rows in the shared
database, mail from the real sender.

This is a restatement of the older phrasing, *"qa must not have `CRON_SECRET`
while it shares dev's bot token"* — same conclusion, but that version described
only condition (2), so it read as though owning a bot were sufficient on its own.

**The one path where qa should get a `CRON_SECRET`** is option B in
`pendings/PENDING.md` — give qa its own bot, then set a fresh secret different
from dev's and prod's, then register qa's own webhook. That flips both conditions
at once and is internally consistent. It is a deliberate migration with an
accepted consequence (QA runs can then fire real alerts), not a reason to leave a
secret sitting there today. **Today's state is neither: the secret is set and the
bot is still dev's — the worst of both.**

The worst case if both parts are ignored: qa points dev's bot at itself and
silently swallows every alert. That is the bug that already cost a day on this
project.

What qa can still do today: send outbound messages into the real dev chat during
test runs. Noisy, not destructive. It cannot receive anything - the webhook
points at dev - so `/start`, account linking and bot commands are untestable on
qa either way. A dedicated QA bot is still worth having for that reason (see
`pendings/PENDING.md`) — just not as a precondition for the removal above.

**Same rule, same answer, for `staging`**: nothing scheduled against it, no
side-effect credentials of its own. `CRON_SECRET` is correctly unset there
(confirmed 2026-08-08); leave it that way.

`NEXT_PUBLIC_TURNSTILE_SITE_KEY` is domain-locked. Copying dev's value is not
enough — add `liquidity-hq-qa.onrender.com` to that widget's allowed domains in
Cloudflare, or the login captcha fails on the qa host only.

---

## 4d. Staging has almost no integrations, and that shrank QA's coverage

**`liquidity-hq-staging` was created with a fraction of the env vars the app
reads.** The app reads **32** distinct variables
(`grep -rhoE "process\.env\.[A-Z0-9_]+" app lib components proxy.ts | sort -u`);
staging was stood up with the core config and little else.

**Why this is not a tidiness problem.** QA's sign-off target moved from the qa
service to the staging service when the fourth branch landed. The qa service
shares dev's Telegram bot, so it can at least deliver an alert; **staging cannot
deliver anything.** Adding `staging` therefore *reduced* what QA is able to
verify before a release, and it did so silently — nothing failed, a class of
tests simply stopped being runnable on the environment that signs off.

**The named gap: alert delivery is verified on no environment that matters.** A
Telegram or push test passing on `qa` is evidence about dev's bot, not about the
release candidate. That should be a decision, not a leftover of how the services
were created. Asked on issue #280.

### What is set, and how much of that is actually known

`NEXT_PUBLIC_*` is inlined into the client bundle at build time, so its presence
can be read off the **deployed** build without a dashboard or a secret. Measured
2026-08-11:

| | Sentry | PostHog | LemonSqueezy checkout |
|---|---|---|---|
| `qa` | – | – | – |
| `staging` | – | – | **set** |
| `prod` | **set** | **set** | – |

**Read a blank as "not detected", never as "not set".** Bundle coverage differs
per service (356 KB scanned on qa against 1 MB on prod), and a first pass using
tighter patterns reported prod as having **no Sentry**, which a looser probe
immediately disproved. The technique is sound for a positive and weak for a
negative.

Server-side secrets — `TELEGRAM_BOT_TOKEN`, `BREVO_*`, `ADMIN_EMAILS`,
`COINGLASS_API_KEY` — cannot be read this way at all. **The Render dashboard is
the only authority**, and the Render MCP integration can *write* environment
variables but not read them, so no session can produce this table from the API.

### Payments on staging, since 2026-08-11

`LEMONSQUEEZY_WEBHOOK_SECRET`, `NEXT_PUBLIC_LEMONSQUEEZY_CHECKOUT_URL` and
`E2E_USER_C_PASSWORD` are set on staging for the #243 test-mode purchase run.
**Test mode**, a separate webhook object from any live one, on a service pointed
at the dev database. §4c's "staging has no business holding these" was written
before this and describes the qa service.

**`NEXT_PUBLIC_*` is inlined at build time**, so setting the checkout URL did
nothing until the service rebuilt — and `/api/version` reports the same commit
either side of an env-only rebuild, so it cannot distinguish "deployed" from
"deployed with the new value". That gap is real for every `NEXT_PUBLIC_*` change
and cost a false "the URL has not landed" report on #243.

### Turning any of these on

| Integration | Prerequisite |
|---|---|
| Web Push | `npx web-push generate-vapid-keys`, set the trio. Free, self-generated, no third party |
| `/ops` console | `ADMIN_EMAILS` — a list of addresses. Grants admin access, so treat it as a permission change |
| Telegram | **A SECOND bot via BotFather.** A bot has one webhook: share dev's and whoever registers last silently steals the other's messages. It fails in the direction of "the test passed because someone else's message arrived" |
| Brevo / PostHog / Coinglass | Real sends, polluted analytics, shared quota respectively. Leave off unless a test plan names the flow |

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
| Binance / Bybit public REST (OKX and Hyperliquid planned) | none (no key) | Market data: prices, candles, funding, open interest, long/short, trades. **On `dev`, shipping in the release after v2026.10.21 (not on production yet):** every server call goes through one shared breaker and request budget (`lib/exchangeGuard.ts`, #1659), which stops all calls to an exchange for the ban period after a ban answer. The fallback chain is on #1649: Bybit WebSocket (phase 2), OKX + our own snapshots (phase 3), Hyperliquid as third source (phase 4, owner 2026-10-21). Bybit answered 403 to production's candle requests 15 times between 2026-10-16 and 2026-10-21 (GlitchTip); whether that is its rate limit or a block is not yet confirmed (#1649). | Public, per-IP limits on a shared Render IP (§1). Terms: most exchanges restrict commercial use without written permission; the requests wait until after launch (owner, 2026-10-21 09:36 UTC) |
| Whop | `NEXT_PUBLIC_WHOP_CHECKOUT_MONTHLY` / `_ANNUAL` / `_FORTNIGHTLY`, `WHOP_WEBHOOK_SECRET`, `WHOP_COMPANY_ID`, `WHOP_PLAN_ID_*` | Payments, Whop only since 2026-10-17 (#1567). The monthly link alone decides whether Pro is on sale (`lib/checkout.ts`, `isProBuyable`); the webhook refuses everything without its secret (`lib/whop.ts`). | **None set on production** (PM read the names on Render, 2026-10-21 ~14:17 UTC): payments are off there. Go-live sets all of them together, then rebuilds; never the links alone |
| `CRON_SECRET` | `CRON_SECRET` | Protects `telegram/alert`, `macro-alert`, `signals/track`, `telegram/setup-webhook`, `alert-outcomes/resolve` and the ingest routes from unauthenticated triggering. **Set on prod** (named in production's Render environment and reported by `/api/version` as `cronSecret: true`, 2026-10-21); this row said "unset" until then, long after §2 was corrected. | — |

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

## 8. Known Automation Gaps (last reviewed 2026-08-08)

- ~~`api/macro-alert` and `api/signals/track` have no confirmed scheduler anywhere~~ — **CLOSED same day**, both wired to cron-job.org. See §2.
- ~~7 of the 11 `DASHBOARD_SECTIONS` toggles in Settings are inert~~ — **RESOLVED 2026-07-21**. Investigated each of the 7: `session` was a real gating bug (fixed, then removed along with the rest below); the other 6 (`accumulation`, `distribution`, `catalysts`, `gex`, `macro`, `commandments`) referenced widgets that either live on other pages entirely or were never built. Rather than build 6 new dashboard widgets or leave non-functional checkboxes, the user chose to remove the whole "Dashboard Sections" toggle feature - `DASHBOARD_SECTIONS`, `hidden_sections`, and the Settings UI for it no longer exist. `/dashboard` now always renders all its sections unconditionally.
- ~~**`api/ops/spike-alert` — built 2026-07-25, NOT YET SCHEDULED**~~ — **CLOSED.**
  Wired via n8n as `LHQ - AI Spike Alert` (Schedule Trigger → `GET
  https://liquidity-hq.onrender.com/api/ops/spike-alert`), Published. See §3.
  Telegrams the owner (`TELEGRAM_CHAT_ID`) once today's xAI usage crosses 80% of
  `AI_GLOBAL_DAILY_MAX` — `pendings/SECURITY_AUDIT.md`'s last open item.

  **This entry ended with "don't leave it stale" and was left stale anyway**, for
  long enough that a later reader (correctly following the instruction at the top
  of this file) still concluded the route was dead. The instruction was not the
  weak link — nothing connects wiring a scheduler to editing this file, because
  the scheduler lives in a tool this repo cannot see. Anything wired outside the
  repo has to be written down by the person who wired it, in the same sitting, or
  it is not recorded at all.

---

## 9. Instrument traps found on 2026-10-30, each of which returns a confident wrong answer

None of these fails loudly. Each produces a result that looks like data. **§9e is the rule they all
collapse to; read that one if you read nothing else.** §9f sits after it because it was found after
it, and is two more instances of it rather than a new trap. **§9g is a new trap and sits last for the
same reason: found later.** Lettering records when something was found, not how important it is.

**This heading counted the traps - "Four instrument traps" - and appending §9f made the number
wrong in the title of the section about figures that rot. The count is gone rather than corrected: a
heading that does not count cannot go stale. §9e carries the same lesson about its own table, which
it learned by breaking twice - so this is the third time one section has caught itself.**

### 9a. `grep -i` COMBINED WITH `-F` **CRASHES** HERE (SIGABRT, exit 134)

**It does not fail to match. The process dies.** Verified independently by two sessions, 3 for 3:

```
grep -cF   LiquidityHQ file   ->  exit 0      correct   (control)
grep -ci   LiquidityHQ file   ->  exit 0      correct   (control)
grep -oF / -oi                ->  correct
grep -ciF  LiquidityHQ file   ->  exit 134    SIGABRT, also under LC_ALL=C
grep -oiF  LiquidityHQ file   ->  exit 134    SIGABRT
```

**grep prints NOTHING to its own stderr.** The familiar `Aborted` line comes from the interactive
shell's job control, so inside a subshell, a command substitution or a script there is **no
diagnostic at all** — an empty result and an exit code nobody reads.

Because the process dies before printing, **`-ciF` yields an empty string, not `0`.**

**Three consequences, and the third is the dangerous one:**

1. **`set -e` scripts DIE at exit 134.** A `set -e` script running `grep -ciF` never reaches the
   next line. This is the one loud case and the only good news here.
2. **A command substitution leaves the variable EMPTY**, so an `-gt` test fails with *integer
   expression expected* and exit 2 rather than evaluating false. Inside an `if`, or behind
   `2>/dev/null`, that error is swallowed and the branch simply is not taken.
3. **A `|| echo 0` fallback CONVERTS THE CRASH INTO A FABRICATED ZERO**, and it is the most natural
   way anyone writes this. Verified against a file that *does* contain the string: the variable
   comes back `0` while the string is present.

   **The defensive idiom that exists to stop a non-match aborting a script is exactly what turns
   this crash into clean, plausible, wrong data.**

**Use `-F` or `-i`, never both.** And pair every absence check with a string that MUST be present.

**How it was found, and why that matters more than the bug:** a positive control came back `0` on a
file the string was plainly visible in. The run before it had reported eight markers absent across
production and dev — coherent, plausible, entirely fabricated. In the output the failures printed
as **blank cells rather than zeros**, and that was first read as a formatting quirk.

**Both sweeps are clean AND both were controlled.** Dev: a repo-wide search for any grep combining
`-i` and `-F`, excluding `node_modules`, zero hits, pattern shown to fire on a planted `grep -oiF`.
QA: `qa/`, `__tests__/`, `scripts/`, `.github/`, `.githooks/` — 14 invocations, none using `-i`.
**QA's sweep needed TWO patterns:** against a planted file holding `grep -ciF`, `grep -i -F` and
`grep --ignore-case --fixed-strings`, the combined-letter regex missed the separated form and the
separated one missed `-ciF`. A single-pattern sweep returns clean for the wrong reason.

### 9b. A DEPENDENCY BEING DOWN READS AS "FINE"

Three instances in one day, each looking like a pass and each a missing measurement:

| What read as fine | What was actually happening |
|---|---|
| A sign-in failure naming a database schema bug | The body was not JSON at all — the hint printed unconditionally and its condition was false |
| `/api/labels` resolving, so labels "work" | File defaults were serving; the database behind them was unreachable |
| `/upgrade` showing no unconfirmed-placeholder string | The entire purchase block fails to mount against the degraded database — the defect is real and in the code, and the environment hides it |

**The third is the dangerous one.** A spec asserting the placeholder is ABSENT would have passed
there, confidently green, certifying a fix that had not happened.

> **An absence assertion needs a positive control proving the CONTAINER rendered**, because "the bad
> string is gone" and "the section is missing" are indistinguishable without one.

**Markup alone could not discriminate.** Those strings are absent from **production's** HTML too,
because the block is client-rendered on both hosts — so "absent server-side on dev" was true and
proved nothing. The control that settled it was the same probe against production, post-hydration:

```
                      prod              dev (degraded db)
purchase controls     3                 0
prices visible        yes               no
rendered words        587               301
footer links          11                16
```

Where a defect is "wrong content present", prefer asserting on **source** — a source-reading check
cannot be fooled by the environment. But see §9d for how it can be fooled instead.

### 9c. `execFileSync('npx', ...)` CANNOT RUN ON WINDOWS WITHOUT `shell: true`

`npx` is `npx.cmd` here, and `execFileSync` does not resolve `.cmd` without a shell. The call
throws, so **every invocation looks like the command failed.**

Found while mutation-testing a gate: `tsc` never ran once, every mutation reported "tsc failed",
and **the mutation expected to PASS produced a false confirmation** — the gate looked like it was
catching something it had never been given.

**The tell was a non-zero exit with zero `error TS` lines.** A compiler that rejects your code says
why; one that never started cannot.

### 9d. A SOURCE-READING GATE THAT MATCHES RAW TEXT CANNOT TELL CODE FROM PROSE

**Two directions and a third path, one defect. The second was found a day after the first and is the
nastier of the two, because it arrives looking like the gate doing its job - and the third needs no
gate at all.**

The first version of the legal-name gate (#1825) tested whether the file text contained
`LEGAL_NAME_CONFIRMED` — over the whole file, **including comments**. So a planted mutation that
removed the import *and* the guard, while leaving the explanatory comment behind, **compiled clean
and kept the gate green.**

**The comment that defeated the gate was a correct, useful comment** written in the fix it was
guarding (#1824). Good documentation acting as a false positive for a checker that cannot parse.

This is the repository's own grep-matches-comment-prose trap, promoted into a gate. **The fix is to
ask the AST whether the name appears as an identifier**, which excludes comments *by construction*.
Stripping comments first is a second instrument with its own failure modes — it has to decide where
a comment ends, including `//` inside a string literal — guarding the first.

#### The same defect with the sign flipped: the gate demands the deletion of good documentation

**2026-10-31, found by QA while writing the replacement for the gate above — which is the same gate,
one day later, failing the other way.** Worth recording because the first direction is the one
everybody anticipates and this one arrives looking like the gate working.

The replacement asserts that a retired mechanism has not come back. Its first version flagged the
placeholder string **wherever it appeared, comments included** — while a sibling assertion in the
same file held that *a comment recalling the retired mechanism is history, not a revival.* **Those
two cannot both be true**, and the file that would have failed is `app/(main)/upgrade/page.tsx`,
whose comment carries the clearest account anyone wrote of the #1824 defect: the one line whose
entire job is to say who is selling had read `Sold by PLACEHOLDER - LEGAL NAME NOT YET CONFIRMED`
directly above the checkout buttons.

> **A text-matching gate does not only go green on prose. It also goes RED on prose — and the
> obvious way to make it pass is to delete the documentation.**

**That is the worse direction, because the first one fails silently and this one recruits you.** A
red gate is believed. The cheapest fix is to remove the offending sentence, the suite goes green,
and the loss never appears in a diff as a loss — it appears as a cleanup.

**Same remedy, applied one level more precisely: read the AST for what the file would SHIP** — string
literals, template text, JSX text — **and ignore comments.** A real string literal is still caught;
prose about the thing is not. **Pin the distinction in both directions**, or it is one well-meaning
edit away from being lost again.

**And it was found by running the gate against the real tree rather than a fixture.** On a tree where
the mechanism still existed it went red naming all eight genuine traces, which is a positive control
taken from the code rather than written by the gate's own author — the difference between a control
and a mirror (§9f).

#### THE THIRD PATH, and it needs no gate at all

**The warning not to delete that comment arrived after it had already been deleted — and not
defensively.** Dev removed it while writing the change, for a reason that sounds like good hygiene:
**the comment described a mechanism that no longer existed.** The switch was gone, the warning block
was gone, so the prose about them looked like dead weight.

> **A comment about a removed mechanism still carries WHY the thing it guarded mattered. Delete it
> for describing dead code and you keep the code and lose the reason.**

What would have been lost here is the account of the #1824 defect: `/security` warned about the
unconfirmed name and `/upgrade` did not, so **the one line whose entire job is to say who is selling
printed a placeholder directly above the checkout buttons** — and dropping the seller line instead
was considered and rejected, because its absence is the exact thing the disclosure rule is about.
**None of that is inferable from the code that remains**, before or after the change.

**So the same loss has three routes, and only one of them involves a gate:** a checker that goes red
on the prose; someone deleting the prose to make the checker green; and **someone deleting it simply
because its subject is gone.** The third needs no tooling and no pressure, which makes it the one
most likely to happen on an ordinary day.

**The test, when a comment's subject is being removed: does it explain a MECHANISM, or does it
explain a CONSEQUENCE that was paid for once?** The first can go with the mechanism. The second is
the only record that the consequence ever happened, and the code never contained it.

**Restored in full substance here, in its own paragraph**, and checked to stay a comment: the string
appears exactly once across `app/`, `lib/` and `components/`, inside a JSX `{/* … */}` block — not
a string literal, not JSX text, so the AST gate above does not see it. **Both halves verified rather
than assumed**, which is what makes it safe to keep prose that quotes a forbidden string.

#### A THIRD DIRECTION, and it is about WHICH FILES get read

**Asked whether the AST remedy had a failure direction of its own, QA measured instead of reasoning
and found one — in their own gate, not in the remedy.** The scan covered `.ts/.tsx/.mts/.js`, so it
**skipped `lib/labelDefaults.en.json` entirely — which is where the user-facing sentences actually
live.** The TypeScript constants were only the values interpolated into them.

> **A revival delivered through a label would have passed in silence while rendering on the page.**

**That is not a flaw in reading the AST. It is a flaw in which surfaces the reader was pointed at**,
and the AST fix was still right for both prose directions. The two are independent: getting the
parser right does nothing about a file the walk never opens.

**The obvious repair was also wrong, and in the familiar way.** "No label may contain `{name}`" is
the nearest-helper rule, and `{name}` appears in **five** labels of which only two are operator
identity — the other three are market-session labels where `{name}` is a trading session, not a
person:

```
SECURITY_SECTION_OPERATOR_BODY   "...operated by {name}, an individual based in {country}..."   operator
UPGRADE_SELLER_IDENTITY_NOTE     "Sold by {name}, {country}..."                                 operator
HOURS_WINDOW_ACTIVE_NOW          "{name} - Active now"                                          session
HOURS_WINDOW_ACTIVE_RIGHT_NOW    "{name} is active RIGHT NOW"                                   session
SESSION_COUNTDOWN_HOLIDAY_ITEM   "{region} closed - {name}"                                     session
```

**So the gate is scoped BY KEY, never by value, and the three session labels are held as a control:**
a future broadening that takes their `{name}` away turns that cell red and names them. The
planted-wrong-repair shape (§9g, #1837) — **except this time the wrong repair was the one the gate's
own author was about to write**, and running it against the real tree is what stopped it.

**The general form — and the first version of it under-reached, which QA demonstrated using the same
gate.** It said "different file types". **The variable is SCOPE, and that gate had TWO scope limits
of different kinds:**

| Filter | What it skipped | Found by |
|---|---|---|
| Extension list — `.ts/.tsx/.mts/.js` | `lib/labelDefaults.en.json`, where the sentences live | the question "does the remedy have its own direction?" |
| Directory list — `app`, `components`, `lib` | `supabase/migrations/`, **130 files that insert into `lhq_labels`** | enumerating what the gate opens |

The second matters because `lib/labelOverrides.ts:4` says it plainly: **a row in `lhq_labels`
silently wins over the shipped default in `lib/labelDefaults.en.json`.** So a migration seeding an
operator label would override the very JSON the new check reads, and **neither filter would see it.**

> **When a check and the thing it protects can live in different places, the check's file filter is a
> silent scope limit — by extension AND by directory.** It produces a clean pass over the half it can
> see. **Ask what the gate does not open before asking whether its predicate is right** — then ask
> where the protected thing can live, because the answer is usually more places than the gate opens.

#### Some scope limits cannot be closed by a test, and those get NAMED

QA closed the migration half. **The other half cannot be closed from this repository at all: a row
written directly to `lhq_labels`, outside any migration, is invisible to every test here.** There is
no file to read.

**So it is stated as a limit in the gate's own header**, with the measurement and its date — zero
rows for all three retired keys on production on 2026-10-30, against a 198-row `NAV_%` control that
shows the query can find rows.

> **A gate that silently does not cover something is worse than one that says so.**

#### The mechanical test, which is cheaper than the insight

**Enumerate what the gate opens. List where the protected thing can live. Compare the two lists.**

That would have found both scope limits in about a minute, and it needs no judgement — which is why
it is the part to keep. The author of that gate had not done it for their own gate until the
question was asked directly.

**And the fix for the file-filter lesson needed the file-filter lesson applied to itself.** The new
migration scan carries its own positive control: a key that genuinely appears in migrations, taken
from the tree. **Without it the migration cell passes if the glob misses, if the reads come back
empty, or if the needle is simply never present anywhere — three distinct ways to be green over
nothing**, and none of them distinguishable from a real pass.

### 9e. THE RULE ALL OF §9 COLLAPSES TO

> **A control must be shown to FIRE before its silence means anything.**

Narrower and more useful than "add controls". Eight instances in one day, in eight different
instruments — and **the last two are instruments nobody here built**, which is why §9f exists:

| Instrument | Looked like | Actually |
|---|---|---|
| `grep -iF` | eight markers absent on two hosts | the process aborted; it can never match |
| `git show` under MSYS path mangling | `continue-on-error` already removed from `dev` | the command never ran; the piped `grep -c` printed `0` |
| `execFileSync('npx', ...)` | every mutation caught by the gate | `tsc` never started |
| A spec asserting a string is ABSENT | the placeholder fix verified | the whole section failed to mount |
| A range-scoped `sed` read of this file | the abort correction was never written | it was written further down, outside the range |
| `gh pr checks <n>` | "no checks reported on the branch" | a run was PENDING on the same head the whole time |
| A pull request's own API view | a 2-commit, 2-file branch ready to merge | `git ls-remote` had a THIRD commit — the suite that gated the work — and a merge would have taken the view |
| githubstatus.com | "all systems operational", no incidents | six write failures across three sessions in ~40 minutes |

**The `sed` row is this document being read with an instrument scoped narrower than the question**, and
it was caught by checking the whole file before claiming an absence — which is §9a's own advice
applied to §9a.

**Every one of them returns a clean, plausible, confidently wrong answer, and none of them looks
wrong on the page.**

**A note on maintaining this table, learned by breaking it twice.** Both sentences below it once
read "the last row", and appending a row silently repointed one of them at the wrong entry —
correct new material invalidating something above it that nobody re-read. **Prose that indexes a
table BY POSITION is the hazard itself.** Name the row, as these two now do, and the next row
appended breaks nothing.

**The `gh pr checks` row carries the nastiest variant of the whole family, and it is worth stating on its
own.** `gh pr checks` reported no checks while `gh run list` showed a run pending on the same
commit. What made that dangerous was not the stale instrument - it was that **a TRUE fact about
this repository stood ready to justify the wrong reading.** `ci.yml` really does carry a docs path
filter, so "docs-only, no checks needed" is plausible and the file can be cited for it. The filter
is on `push` and deliberately NOT on `pull_request`.

A wrong fact gets checked. **A correct fact that happens to explain a stale reading does not**, and
it supplies the confidence to stop looking. When two channels disagree about whether something ran,
wait for both rather than picking the one a known fact can explain - and prefer **watching the run**
over polling the checks API, which is the practical form of this.

### 9f. A VENDOR'S OWN STATUS PAGE IS A CONTROL THAT HAS NOT FIRED

**§9e's seventh and eighth instances, and the only two from instruments this project did not build.**
Placed after the rule rather than before it because that is when they were found; §9e's table is read
by row name, not by position, so adding them above would have been the hazard that section already
documents.

**2026-10-30. Six GitHub write failures across three sessions in about forty minutes:** a `git push`
rejected with `Internal Server Error` (twice in one session, once in another), a `502` on
`gh pr create`, a GraphQL error on `gh pr edit`, a GraphQL error on `gh pr close`, and a branch
delete that only went through over REST. **githubstatus.com, fetched directly during the window,
reported every component operational — Git Operations, API Requests, Actions, Pull Requests — with
no active or recent incidents.**

> **"The status page is green" is not a measurement. It is a detector that has not fired, and
> somebody else owns the detector.**

A status page is a *downstream* instrument: it reports what the vendor has decided to declare, after
they have noticed and decided to say so. **Our own six failures were the measurement.** They
outranked the page, and they were available the whole time.

### The expensive instance, and it is not the failed writes

The failed writes were loud. **The dangerous one was silent: a pull request's own view disagreed with
the branch it claimed to show.**

```
gh pr view 1831 --json headRefOid              ->  e29ec943   (2 commits, 2 files)
git ls-remote origin test/chart-structure-fixtures ->  0b8387fd
```

The missing third commit was the binding test suite — **the half that gated the feature it was
written for.** Nothing looked wrong. The PR was green, the branch was correct, and **a merge would
have taken what the view held**: the work would have landed, the gate would have been absent, and
the issue would have been ticked on a passing merge.

**It was caught because the author checked a ref against the view six times over several minutes
rather than accepting one refresh as lag.** That is the only reason.

**And the author's own account of why they kept going is worth more than the catch, so it is recorded
in their words rather than cleaned up:** *"my six checks were luck in the sense that I only kept
going because the first three agreed with each other; I had no principle saying to."* **A catch that
depended on a hunch is not a procedure.** That is precisely why practice item 1 below had to become
a rule — the next person will not have the hunch.

### Which pull requests are affected — a control, and a hypothesis that is NOT recency

The first reading was "the two most recently pushed branches". **That is checkable and it is wrong.**
Measured across every open pull request within the hour, with the matching rows as the control that
makes the mismatching ones mean anything:

| PR | view `headRefOid` | `git ls-remote` | |
|---|---|---|---|
| #1829 | `5dc385a2` | `dfea5924` | **MISMATCH** |
| #1831 | `e29ec943` | `0b8387fd` | **MISMATCH** |
| #1834 | `11bd7686` | `11bd7686` | MATCH |
| #1835 | `30efa234` | `30efa234` | MATCH |

**#1835 was pushed AFTER #1829 and its view is correct**, so recency does not discriminate. What the
two mismatching branches share is their push history: **both had a `git push` rejected with
`Internal Server Error` and succeeded only on a retry.** #1835's push was accepted first time.

> **Hypothesis, labelled as one because n is small: a push that fails and then succeeds on retry can
> leave the pull request's view pointing at the PRE-FAILURE head while the ref advances.** The failed
> write is the marker, not the clock.

**NARROWED, and it was first stated too broadly as "a failed write".** Two of that day's failures were
not pushes at all — a 502 on `gh pr create` and a GraphQL error on `gh pr edit`. **#1833 was created
on a retry after that 502 and its view MATCHED**, which is the row that discriminates: a retried
pull-request-object write did not produce a stale view. On the evidence the marker is specifically
**a failed PUSH**.

**That fits the remedy rather than fighting it.** PR-object writes are what *rebuilds* a stale view
(below), so it would be odd if they were also what caused one. Two findings from two sessions,
arrived at separately, pointing the same way.

**If it holds, it is better than the recency reading in the one way that matters — it tells you WHICH
pull requests to distrust.** The one you retried. It is also consistent with the rest of that day's
weather: GitHub refused its own merge of #1829 with *"Head branch is out of date"*, and
`update-branch` then failed with *"head sha didn't match the current head ref"* — the service
disagreeing with itself about a single branch.

**Do not promote this to a rule on this evidence:** four pull requests, two mismatching, one
known-clean push as the control. **The practice below does not depend on the hypothesis being right**,
which is the reason the practice is the part to follow.

### LAG IS NOT STALENESS — and this is where the first remedy claim fell over

**First this subsection claimed "tested twice rather than reasoned". It was not. It was measured
twice within a second of a push, which measures something else.**

**Immediately after the push that added this very subsection, #1835's own view read `1868e1cb`
while the ref read `e9d53634` — a MISMATCH. Re-measured after some elapsed time: both
`e9d53634`.** It had simply not propagated yet.

> **A view read within seconds of a push is measuring ordinary lag. The defect is a mismatch that
> PERSISTS — across minutes and across repeated checks.**

That distinction is the whole entry, and the first draft of this subsection did not have it. Both
"clean data points" above were instant reads: one of them would have resolved on its own, and the
other was never given the chance to.

**So what survives, stated at the strength the evidence supports:**

- **The persistent cases are real.** #1831 was checked six times over several minutes. #1829 held a
  stale view long enough for GitHub to refuse its own merge for *"Head branch is out of date"* and
  then fail `update-branch` on *"head sha didn't match the current head ref"*. Neither was lag.
- **That a push fixes a persistent one is ONE observation.** #1829 matched immediately after a
  single commit. **With no control for elapsed time**, "the push fixed it" and "it caught up anyway"
  are not distinguishable from that one run. It is worth trying because it is one commit, not
  because it is established.
- **The retry hypothesis is untouched by this.** It is about which branches go stale, not about how
  to measure them, and the table's MISMATCH rows were persistent ones.

**How to measure it properly, which is the part to actually follow:** read the view and the ref
**twice, with time between**, before concluding anything. One disagreement is lag. The same
disagreement minutes later, or after a refresh, is the defect.

### WHAT ACTUALLY REBUILDS THE VIEW — no push needed

**#1831 was fixed by `gh pr close` followed by `gh pr reopen`. No new commit, no write to the
branch at all.** Its ref had sat at `0b8387fd` for over an hour and never moved; view and ref agreed
afterwards, verified three times after a fetch, with all three files listed including the binding
suite. Found by QA.

**So "it takes one clean push" was wrong in a way that costs something.** A reader following it
would manufacture a commit they do not need, and **an empty commit on an already-reviewed pull
request is its own small harm** — it re-opens review state and adds a commit that explains nothing.

> **Any mutation of the pull-request object rebuilds the view. Prefer the one that touches no code:
> close, then reopen.**

**And it narrows the mechanism without supplying a cause: the stale record was DERIVED, not waiting
on anything from the branch side.** A close/reopen changed no commit and still produced a correct
view. That is a property of the remedy and it must not be allowed to grow into an explanation of
what GitHub was doing — see the evidence caveat above.

**One ordering detail that belongs next to the remedy rather than in a footnote:** `gh pr close` was
tried on #1831 **during** the write-failure window and failed with a GraphQL error. **The remedy
existed and was unavailable.** So: **retry the remedy once the write path is healthy**, and do not
read one failed attempt at it as the remedy not working.

**This does not touch the retry hypothesis.** #1831 was already in the stale set, so it adds no data
point to the question of *which* branches go stale. What it does is separate the **remedy** from the
**marker**, which had been travelling together in the first draft and did not belong together.

### What the earlier claim was, kept rather than deleted

**One clean push to the branch resyncs the view.** The hypothesis predicted it and it appeared to
work both times it was tried — and the second of those two is the observation that undid it:

- **#1835**, already matching, took a second commit on a push accepted first time - and its view
  read the PREVIOUS head for a moment before catching up on its own. **This is the row that
  falsified the subsection above it**, and it only did so because it was re-measured instead of
  being recorded once.
- **#1829**, stale at `view=5dc385a2` / `remote=dfea5924`, with its own merge refused for
  *"Head branch is out of date"* and `update-branch` failing on *"head sha didn't match the current head
  ref"*, took one commit: **view and ref both `be63dd12` immediately afterwards.**

**That claim is SUPERSEDED and is kept only as a record of how it failed. Do not follow it.**
#1831 was fixed with no push at all, so the commit was never the active ingredient — and the
instruction would have had readers manufacturing empty commits on reviewed pull requests. Follow
*WHAT ACTUALLY REBUILDS THE VIEW* above instead.

**Both of its failure modes arrived within the hour, and they are different in kind:**

- **Measurement:** #1835's "clean data point" was an instant read that resolved on its own. The
  claim was built on a measurement that could not tell lag from staleness.
- **Mechanism:** #1831's close/reopen fixed a stale view without touching the branch, so the push
  was never doing the work the claim credited it with.

**It is kept rather than deleted because a wrong remedy that was briefly recommended by this file is
worth more as a worked example than as a gap.** It was written confidently, with two observations
and a hypothesis that had just predicted something correctly — which is precisely the state in
which this section's own failures get written. The thing that undid it was re-measuring and someone
else trying a different remedy, not more care at the time of writing.

**Two caveats about the table itself.** The #1835 row is the state of this entry's own pull request at
the commit BEFORE the one that added the table, so it reports a past head rather than a current one -
every row here is an observation with a timestamp, including the row describing the file you are
reading. And the push that carried this table was itself a further test: on the hypothesis, a push
accepted first time should leave #1835 matching.

### What to do, stated as practice rather than principle

1. **Before merging anything whose contents matter, read the view and the ref TWICE, with time
   between.** One disagreement is propagation lag; the same disagreement minutes later is the
   defect. Compare `git ls-remote` against the PR's
   `headRefOid`.** They should be the same object. **A green PR is not evidence that the view holds
   what you pushed**, and neither is a passing CI run — both describe whatever the view has.
2. **Check the artifact before retrying any failed write.** Every failure that day genuinely had not
   landed, so no duplicates were created — but a write that both errors and lands turns a blind
   retry into a duplicate PR, a double comment, or a second branch.
3. **Never close out an incident on a status page.** It can confirm a vendor's own account of
   something you already measured. It cannot tell you nothing happened.
4. **Two channels disagreeing is a measurement, not noise.** This is §9e's `gh pr checks` row in a
   second tool, and the response is the same: wait for both, prefer watching the thing itself, and
   do not pick the channel that a known true fact can explain.

### 9g. A TEST ACCOUNT WITH ENTITLEMENTS CANNOT SEE AN ENTITLEMENT BUG

**Found 2026-10-30 by Dev, before commit, on #1631 item 5. Nothing shipped — and it would have
passed every green run on the account the team actually tests with.**

The change moved prompt assembly server-side so the coin and timeframe gates read the values the
prompt is built from. The gate was given `ctx.coin`. **`ctx.coin` is not a coin id:**
`gatherContext` writes `selectedCoin.toUpperCase() + '/USDT'`, so it holds `BTC/USDT`, and
`normalizeCoinId` only trims and lowercases — producing `btc/usdt`, which is not on the Free list.

**Consequence: every Free and trial account locked out of BTC, ETH and SOL** — the three coins that
tier is *for* — **while a Pro account saw nothing at all**, because `aiCoinAllowed` returns true for
Pro before it ever looks at the coin.

> **The entitlement check short-circuits for the highest tier, so the highest tier is blind to every
> bug in it.**

**This is §9e's rule with the ACCOUNT as the instrument.** A green run proves the gate allowed
*this* account; it says nothing about the gate. And the control is not available by accident: you
have to deliberately run as the restricted tier, because the unrestricted one cannot fail.

**What this costs when it escapes:** not an error. Free and trial users would simply find the
product's advertised coins unavailable, with a correct-looking "not on your plan" refusal. **A
defect that presents as the product working as designed does not generate a report.** Today that
means it would have produced no signal at all — not a complaint, not a support message, nothing to
notice it by. Once there are paying users it means the same silence, with churn behind it that
nobody can attribute.

**The first version of that sentence ended "it generates a cancellation", and QA sent it back.** It
was wrong twice: there are no paying users to cancel — payments went live 2026-10-28, and on prod
today `lhq_whop_webhook_events` is empty while `lhq_user_subscriptions` holds no row with an active or
trialing status — and **the affected tiers have nothing to cancel anyway.** A free user leaves
and a trial lapses; the one tier that could cancel is Pro, which is exactly the tier the bug cannot
touch. **`docs/OWNER-RULES.md` carries "do not argue urgency from user harm" as a standing rule,
because the bugs are real and the users are not yet** — and that sentence was this file breaking it.
The silence is the cost, and it is the cost today as well as later.

**And the first version of the CORRECTION carried a rotted figure, inside the entry about figures that
rot.** It said "both Whop tables at zero rows". Re-read on production 2026-10-30:
`lhq_whop_webhook_events` is 0, but **`lhq_user_subscriptions` holds 5 rows** - every one with a NULL
status, last touched 2026-10-02, so they pre-date payments going live. `active_or_trial` is 0, so the
conclusion never moved; **the stated measurement was simply wrong, and a reader who checked that table
would have found this file wrong on its own subject.**

**The load-bearing fact was a STATUS and what was reported was a ROW COUNT** - the cheaper measurement
answering a near-enough question, which is §9e one more time, this time inside a sentence correcting a
§9g claim about instruments. The replacement above is also harder to falsify by accident: a row
appearing does not break it, because the claim is about status. Caught by QA re-reading a figure they
had supplied themselves.

### What to do

1. **Every gate check runs as the RESTRICTED tier, and as each tier that differs.** Free, trial and
   Pro are three instruments here, not one feature with three skins. A Pro-only pass on anything
   touching entitlement is a pass on nothing.
2. **Assert the negative, with a control.** A cell that fails if a Free account is ever *allowed* a
   non-Free coin, and a control proving that cell can fail — otherwise it is an absence assertion
   with no evidence it is wired up (§9b).
3. **Suspect every value whose NAME reads like an id.** `ctx.coin` sounds like `btc`. It holds a
   display pair. The trap is written at the function now, which is the right place: a comment at
   the producer reaches the next reader, a note in this file does not.
4. **Short-circuits deserve a second look wherever they exist.** Any `if (isPro) return true` is a
   place where the most-tested path is the least-informative one.
5. **The early return is VISIBLE IN THE SOURCE, so look for it on purpose.** `aiCoinAllowed`
   short-circuits on `pro` before it reads the coin, which makes the blindness **structural rather
   than incidental** — and structural means greppable. A gate whose highest tier returns early is a
   gate where a privileged test account is an instrument, and that can be found deliberately instead
   of by a near-miss. QA's addition, and it is the one item here that turns the trap into a search.

### 9h. WHEN A CHECK DISAGREES WITH THE ARTIFACT IT CHECKS, SUSPECT THE CHECK FIRST

> **9e is about a control whose silence means nothing. This is its mirror: a check that SPEAKS
> and is wrong.**

Six instances on 2026-10-31, in six different checks, across two sessions. **In every one the
artifact was right and the check was wrong.** None of them resembled a tooling fault at the time;
each read as a finding.

| The check | Said | Actually |
|---|---|---|
| `grep -cE '^✖ [A-Z]'` over `node --test` | 2 failures | ONE failure. `node:test` prints each failing cell twice - inline and in the summary block - so every count was doubled |
| A mutation harness's own extraction filter | `red=[]` for both mutations | both mutations HAD fired; the filter could not see its own cells |
| `grep -c` in an `&&` chain | a bare `0`, reading as "no payment words on the page" | `grep -c` **exits 1 on zero matches**, which broke the chain and killed the controls before they printed. Real answer 3 |
| `grep -c "do not merge or rebase"` | 0, reading as "the edit did not land" | the row says **"Do not"**. Case-sensitive miss, and the exit-1 ALSO broke the chain so the next check never ran |
| A hand-written table validator | "must be 4 pipes", got 5 | the table has **four columns**, so five pipes is correct. Every sibling row agreed |
| `grep -c "held for the next window"` after a rewrite | 1, reading as "the stale claim survived" | it survives inside the **quotation of what the row used to say** - the record of the error, not a live claim |

**The fourth row is the worst of the family: a failure that hid its own second failure.** The case
error produced the wrong number, and the same non-zero exit suppressed the check that would have
caught it. One mistake, two silences.

**The last two rows are the ones that generalise beyond `grep`.** Both are a check encoding an
assumption the artifact never agreed to - a column count, and the idea that a string appears only
as an assertion. **A quotation is not a claim, and a deleted quotation is a deleted record.**

**How to apply, in order:**

1. **Read the lines, not the count.** Every row above is survivable by printing what matched.
2. **Never put a counting command in an `&&` chain.** `grep -c` exits 1 on zero matches; so does
   `grep` itself. Run it, capture `$?`, read the output anyway - the same rule as a gate
   (`cmd > out 2>&1; echo "EXIT=$?"`).
3. **Prefer the runner's own summary** - `node --test`'s `ℹ fail N` - over counting matched
   lines. The runner knows how many cells failed; a regex over its prose does not.
4. **Give a counting filter a positive control**: feed it a run you KNOW fails and confirm it says
   so. A harness that cannot report red is not evidence when it reports green.
5. **Check case and anchors against the artifact** before believing an absence, and prefer `-F`
   for a literal - subject to §9a, which is why `-iF` is not the answer here.

**THE COMMON FACTOR UNDER ALL SIX, AND THE REASON STEP 4 GENERALISES PAST `grep` ENTIRELY: every
one of these checks was written by the person who wanted the answer.** Not one was an
independent instrument. A check built to confirm a result inherits the author's expectation of
what it will find - the double-count went unnoticed because "2 failures" was plausible, the
`red=[]` went unnoticed because "my cells do not detect this" was the feared answer, and the
case-sensitive miss went unnoticed because "the edit did not land" was the thing being checked
for. **So a positive control is not optional hygiene on a self-written check; it is the only
thing standing in for the independence the check does not have.**

**Why this belongs beside §9e rather than inside it.** §9e's table is controls that never fired, and
its own maintenance note warns against prose that indexes that table by position. This is a
different failure with the same consequence - **a confident wrong answer that looks like data** -
so it gets its own heading and its own table, and nothing above it needs re-reading.

### 9j. A ZERO IS A MEASUREMENT OF THE INSTRUMENT UNTIL A CONTROL SAYS OTHERWISE

**Numbered 9j although this file ends at 9h: 9i is on PR #1875 and has not merged yet.** The
gap is deliberate rather than a mistake - taking 9i here would collide with that PR and produce two
sections with one number. If #1875 is ever abandoned, renumber this one rather than leaving a hole.

Two findings from 2026-10-31, on #1818's Draw Structure work. They look unrelated - one is about
Postgres, one about `git grep` - and they are the same failure: **a check reported an absence, the
absence was the check's own blind spot, and the number it printed was identical to the number a
true absence would print.**

#### A PROD FUNCTION BODY CANNOT BE DIFFED AGAINST ITS REPO MIGRATION DIRECTLY

Before replacing `increment_ai_usage_impl` - the function that meters every Pro tool - the live
definition was dumped with `pg_get_functiondef` and compared against
`supabase/migrations/20260727e_ai_tool_pool.sql`. **It differed.** The live body was missing
comments the repo body has, and no migration in the repo explained it: `20260807b` only renames
the function (a rename preserves the body verbatim) and `20260907b` mentions it in a comment. That
is the exact shape of "someone edited this by hand in the dashboard", and the correct response to
that reading is to stop.

**It was not a hand-edit. Something in the apply path strips SQL comments before Postgres sees
them**, so `prosrc` comes back comment-free for everything:

| Check | Result |
|---|---|
| Functions in prod `public` carrying a `--` in `prosrc` | **0 of 14** |
| `--` lines in the repo source of `lhq_grant_signup_trial` | 21 |
| `--` lines in the repo source of `lhq_record_api_health` | 3 |
| Normalised md5, prod live body vs repo body | **identical**, 7646 chars each side |

**Postgres does not do this** - it stores a function body as given. So the stripping is ours, and
the consequence is that **every function in the database looks modified** when compared to its
migration. Anyone auditing a function against its source will reach the same wrong conclusion.

**The control is what separated the two readings, and it was nearly skipped.** "Prod differs from
the repo" and "every function in the database differs the same way" lead to opposite actions, and
only the second reading is available if you look at **one** function. The question that produced
it was *do the other instances show this too* - not *let me read the body more carefully*, which
is what the first reading invites.

**So, to compare a live function against a migration:** strip comments and collapse whitespace on
both sides, then hash - or compare only the statements. And **give that normalisation a positive
control**: a one-character code change must flip the hash while removing a comment must not. Both
were verified before the hash match above was believed.

**A corollary that bites the other way.** A comment stripper cannot tell `--` in code from `--`
inside a string literal, so a `--` in a `format()` template or an error message would be truncated
at that point, silently, and the function would still be created. Check for `--` inside string
literals before applying DDL here. Same family as 9d, pointed the other direction.

#### `git grep` RETURNS THE SAME ZERO BEFORE AND AFTER A PUSH

Two sessions independently searched for a string and both got a reassuring zero, **for unrelated
reasons, neither of which was the string being absent**:

| Who searched | What they searched | Why the zero was meaningless |
|---|---|---|
| Dev | `git grep` over the working directory | `git grep` searches **tracked** files; the file was new and untracked |
| QA | `git grep` over `origin/feature/draw-structure` | the pushed ref **predated the work** - the route did not exist on it |

The claim being checked happened to be true, which is the worst outcome: a false method agreed with
reality and would have been trusted the next time.

**QA's search carried a positive control and dev's did not**, which is the only reason one of the
two zeros was caught in the act: searching `RATE_LIMIT` in the same command returned 5 files, so
the mechanism was known to work and the absence was known to be real for that ref. Without that
line QA would have sent a false confirmation.

**The trap is that the command does not change, only the truth does.** `git grep X` is wrong
before a commit and right after it, with no change in output format and no error. So:

1. **To search code you have just written, search the working tree** - `rg`, or the Grep tool -
   never `git grep`.
2. **To search a ref, first prove the file is on that ref**: `git ls-tree -r <ref> -- <path>`. An
   empty listing means the search could not have found anything.
3. **Never chain on a grep's exit code.** `git grep` and `grep -c` exit 1 on zero matches, so
   `grep ... && npx tsc` silently skips the typecheck and `$?` reports the grep. This happened in
   the same session that wrote rule 1, and the printed "exit" was the grep's.

**Why this sits beside 9h rather than inside it.** 9h is *when a check disagrees with the artifact,
suspect the check first* - a check that **speaks**. This is a check that **stays silent**, which is
harder, because disagreement prompts investigation and agreement does not. The shared remedy is
9i's step 4: **a positive control, because a self-written check has no independence to borrow.**
