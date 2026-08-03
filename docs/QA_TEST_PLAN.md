# QA test plan — security/hardening batch, 2026-08-07 to 2026-07-30

Plan only. Nothing in this document has been executed yet except where marked
`DONE`. Review this, then say go and it gets carried out in the order below.

## Why this exists

This stretch of work shipped nine commits of security fixes across two
sessions, verified at three different rigor levels depending on the item:
full live proof (SQL against the real dev DB, real HTTP against deployed
prod), logic-only proof (a standalone Node script against extracted regex/
clamp logic), or build-only proof (`tsc` + `npm run build`, no runtime check
at all). Asked directly whether the last batch was "tested," the honest
answer was no - and a live-verification attempt right after that answered a
second, related question: verifying immediately after triggering a Render
deploy is unreliable, because the request can land mid-cutover between the
old and new instance. That is a real, reusable finding, folded into the
procedure below rather than left as a one-off war story.

## Gotcha: RLS enabled with zero policies is deny-all, and it fails silently (2026-08-04)

**If the browser shows stale or default data while the database clearly holds
the right row, check `pg_policies` before you debug the React.**

Cost us most of a Telegram QA run. `lhq_dev_user_settings` had RLS **enabled with
zero policies**. In Postgres that is deny-all, not allow-all. The consequences
are asymmetric and that is exactly what makes it hard to spot:

- Anything using the **service-role** client (webhooks, cron, `/api/*` routes via
  `getSupabaseAdmin()`) **bypasses RLS entirely**. Writes succeed. Server-side
  reads succeed. Every server test passes.
- The **browser** client (anon key + user JWT) gets an empty result for every
  select. No error - just zero rows.

So Telegram connect really did write `telegram_chat_id`, and `/alerts` really did
keep saying "Not connected", and both were behaving correctly. `SettingsProvider`
does `if (!data) return;` and falls back to `DEFAULT_SETTINGS`.

It hid for a long time because `SettingsProvider` also caches settings to
localStorage, so any browser that had ever read the row kept showing the cached
copy. Deleting the row during an account reset removed the disguise.

How to check, per project:

```sql
select c.relname, c.relrowsecurity as rls,
       (select count(*) from pg_policies p where p.tablename = c.relname) as policies
from pg_class c join pg_namespace n on n.oid = c.relnamespace
where n.nspname = 'public' and c.relkind = 'r' and c.relname like 'lhq_%'
order by policies, c.relname;
```

Then diff dev against prod. A dev table with **fewer** policies than its prod
twin is the signal. Two caveats learned while doing exactly that:

- A single `for all` policy is equivalent to four per-command ones.
  `lhq_dev_price_alerts` has one `ALL` policy where prod has four - **not** a gap.
- Plenty of tables correctly have zero policies. Those are server-only
  (`app_config`, `admin_users`, `telegram_link_codes`, `trial_claims`, ...) where
  deny-all to the browser is the intent. The dev zero-policy list matched prod's
  exactly apart from `user_settings`.

Fixed by mirroring prod's three policies onto the dev table (migration
`add_missing_rls_policies_lhq_dev_user_settings`). Prod was always correct; this
was dev drift.

## Known gotcha, discovered 2026-08-02 - read before running anything live

**Do not curl or click through a route within ~60 seconds of triggering a
Render deploy.** `trigger_deploy` returns immediately with `status:
build_in_progress`; the OLD instance keeps serving during build and upload,
then Render kills it and starts the new one. Render's own log for this
service shows the new instance's `next start` at `11:00:54` and the
`Your service is live` line at `11:01:01` - a real, human-visible window
where a request can hit a half-stopped old process (→ 502, or a hang if the
connection was mid-flight when the process died) or a just-started new
process (→ correct code, but with EVERY in-memory rate-limit bucket reset to
zero, since `lib/rateLimit.ts`'s `Map` is process memory, not persisted).

Procedure: after `trigger_deploy`, poll `get_deploy` until `status: "live"`,
OR poll the homepage until it returns `200` consistently across 3 consecutive
requests spaced 5s apart, before treating ANY response as meaningful.

**Related, permanent characteristic worth knowing (not a bug, not fixed
here):** every deploy resets every rate-limit bucket in `lib/rateLimit.ts` to
zero, on every route that uses it. Someone who was throttled 30 seconds ago
is not throttled anymore right after a deploy. Acceptable today (deploys are
infrequent, and worst case is a returning-to-normal rate limit, not a broken
one) - listed here so it is a documented tradeoff, not a surprise later if
this app ever needs multi-instance scaling, at which point in-memory buckets
also stop being shared across instances entirely and the limiter would need
to move to Postgres or Redis.

## Scope - every item from this stretch of work, by current verification level

| Item | Unit | Integration | System (live, deployed) | Never verified live |
|---|---|---|---|---|
| `getUsageTier` / 3-row `AI_LIMITS` (free/trial/pro) | - | - | DONE (SQL against dev, 4/4 cases) | - |
| Telegram link-code claim (valid/replay/expired/unknown) | - | - | DONE (SQL against dev, 4/4 cases) | - |
| Telegram connect UI (button → code → webhook → poll → connected/disconnect) | - | - | - | **yes** |
| `safeNextPath` open-redirect fix | DONE (13 cases, Node harness) | - | DONE (real browser, prod, 2026-08-02) | - |
| Telegram webhook fail-closed on missing secret | - | - | DONE (curl, prod) | - |
| Trial-ending email + cron job | - | - | DONE (curl auth check + DB due-count) | **the email itself has never actually sent** (0 rows were due both times checked) |
| LemonSqueezy webhook: payer-email check + replay guard | - | - | - | **yes** - payments aren't live, no real webhook payload exists to test with |
| `grok-chat` model pin + `max_tokens` clamp | DONE (9 cases, Node harness) | - | build+tsc only | **not curled against a live deployment** |
| `ban-reason` rate limit (5/min/IP) | - | - | DONE (real burst, dev, 2026-08-02) - see `getClientIp` finding below, this is what surfaced it | - |
| `/api/admin` honeypot rate limit (5/min/IP) | - | - | DONE (DB row-count before/after a 10-request burst, dev, 2026-08-02): 5 new rows for 10 requests, not 10 | - |
| **`getClientIp` reading Render's own internal IP, not the caller's - found 2026-08-02** | - | - | **FIXED, DONE** (dev, real burst pre/post-fix) | - |
| PostHog `maskTextSelector` on TradeJournal | - | - | DONE (real browser, prod, 2026-08-02): all 5 selector classes confirmed via live `element.matches()` against real DOM; PostHog confirmed actively capturing (network trace: `us.i.posthog.com/e/` 200, `surveys.js` loaded) - `window.posthog` itself reads `undefined`, which is expected (npm-import pattern, not the injected snippet, never attaches to `window`) | **CLOSED 2026-08-03**: owner opened the PostHog dashboard, a canary trade was seeded with distinctive notes/P&L, and the replay rendered them as asterisks. Note for anyone re-running this: PostHog masks matched text as **asterisks**, not blocked rectangles - the rectangle wording here was wrong, asterisks are the pass condition |
| Price-alerts PATCH Pro-gate | - | - | build+tsc only | **not curled with a real free-tier token** |

## Test plan by layer

### 1. Unit tests (pure logic, no network, no server) - can run right now, cheapest tier
Already done ad hoc in throwaway Node scripts this session; the only new work
here is making them permanent instead of one-off.

- [x] Move the `safeNextPath` 13-case harness into `__tests__/safeNext.test.ts` (or the project's existing test runner if one exists - `package.json` needs a check, no test framework was observed in use this session). **DONE 2026-08-02**: `__tests__/safeNext.test.mts`, `node --test` (Node 24 built-in, no new dependency), 13/13 pass.
- [x] Same for the `grok-chat` `max_tokens` clamp (9 cases already written). **DONE 2026-08-02**: extracted the clamp into `lib/grokTokenClamp.ts` (was inline in the route, not importable), `__tests__/grokTokenClamp.test.mts`, 9/9 pass.
- [x] Same for the link-code generator (alphabet/length/entropy check already run once manually). **DONE 2026-08-02**: extracted into `lib/telegramLinkCode.ts` (same reason), `__tests__/telegramLinkCode.test.mts` - length, alphabet-membership, 1000-code uniqueness, and full-alphabet-coverage checks, 5/5 pass. `npm test` runs all three files (30 cases total); `tsc --noEmit` and `npm run build` both clean after the refactor.

### 2. Integration tests (real DB, no live server - what the SQL-against-dev checks already were)
- [x] Re-confirm `increment_ai_usage` three-tier behavior still holds after the newest migrations (last run 2026-08-07, before `d1a4a7b`). **DONE 2026-08-02, dev DB**, isolated test (real user_id, fake future date `2099-01-01` so nothing touched real usage - rows deleted after). Confirmed via `increment_ai_usage_impl` directly: success returns the new count; hitting the per-tool cap returns `null`; hitting the pool cap returns `-2` and correctly refunds both the per-tool and pool columns; hitting the global cap returns `-1` and correctly refunds the per-tool column. All match the documented sentinel contract. Also found and confirmed a newer security property from the 08-07 migrations that wasn't in scope originally: the public `increment_ai_usage` wrapper now REJECTS the `authenticated` role at the GRANT level entirely (`42501 permission denied`), not just via an in-function `auth.uid()` check - confirmed this is intentional and matches how the app actually calls it (`lib/aiUsage.ts:107`, `getSupabaseAdmin().rpc(...)`, service-role only, never from the browser).
- [x] Re-run the 4-case Telegram link-code claim test (valid/replay/expired/unknown) - last run before the UI rebuild, never re-run after. **DONE 2026-08-02, dev DB**, disposable test codes against the real atomic claim UPDATE from `app/api/telegram/webhook/route.ts`. Valid code claims and sets `used_at`; replaying the same code returns no rows (still correctly unclaimed a second time is impossible - `used_at` stays at its first-claim value); an expired-but-unused code returns no rows and `used_at` stays `null`; an unknown code returns no rows. All 4 correct, rows cleaned up after.

### 3. System tests (the actual deployed dev service, black-box HTTP) - do these AFTER the deploy-cutover wait above
- [x] `ban-reason`: 7 requests, same IP, spaced ~1s apart, expect requests 1-5 → `200`, 6-7 → `429`. **Found a real bug 2026-08-02, then fixed and confirmed.** First clean, properly-isolated attempt (65s+ quiet beforehand, well clear of any deploy cutover) showed 8/8 requests returning `200` - the limit wasn't blocking AT ALL, reproducibly. Root-caused via three rounds of temp-debug logging (each deployed, checked, and reverted): `x-forwarded-for` is a 3-hop chain here - `[client, a Cloudflare edge machine, Render's own internal IP]` - not the 2-hop chain the original `getClientIp` assumed. Reading the rightmost hop landed on Render's own private `10.x.x.x` address, THE SAME VALUE FOR EVERY CALLER - every distinct client was silently sharing one bucket instead of getting their own. Worse, the middle hop (Cloudflare's own edge server) turned out to vary request-to-request even from one real client (Cloudflare's anycast network can route consecutive requests to different edge machines), so no fixed hop position would have worked. Fixed by switching to `cf-connecting-ip` (Cloudflare's purpose-built, unspoofable header for exactly this - confirmed live it held one stable value across an entire burst, while every `x-forwarded-for`-derived candidate did not), with the old position-based `x-forwarded-for` logic kept only as a fallback. Re-tested clean post-fix: 1-5 → `200`, 6-8 → `429`, exactly as expected. See `lib/rateLimit.ts` and commit `8e02474`.
- [x] Admin honeypot: cannot verify via status code (404 both ways by design). Instead: `select count(*) from lhq_dev_admin_audit_log where action='honeypot_admin_api_hit'` before and after a 10-request burst - expect at most 5 new rows, not 10. **DONE 2026-08-02, post-fix**: 7 rows before, 12 after a 10-request burst - exactly 5 new rows, not 10. Uses the same `getClientIp` fixed above.
- [x] `grok-chat`: authenticated request with `max_tokens: 999999` in the body; confirm via GlitchTip/Render logs (not the response, which won't reveal the true value sent to xAI) that the outbound request used 600, not 999999. If no cheap way to observe the outbound value, add a temporary debug log for one test run and remove it after. **DONE 2026-08-02**, dev, disposable free-tier test account (see below). Skipped log-instrumentation entirely in favor of a cleaner proof: asked for a long response (~3000 words) with `max_tokens: 999999` and read the actual completion back. Result: `"finish_reason":"length"`, `"completion_tokens":600` - the model was genuinely cut off mid-generation at exactly the ceiling, not 999999. Direct behavioral proof of the enforced value, no deploy needed.
- [x] Price-alerts PATCH: real free-tier token, attempt to edit an existing alert, expect `403 PRO_REQUIRED`. Needs one real free-tier test account with at least one existing alert row. **DONE 2026-08-02**, dev. Turned out an existing alert row isn't required - reading `app/api/price-alerts/route.ts`, the Pro-gate check runs before the `id` lookup, so it fires regardless. `PATCH ?id=<any-uuid>` with the free-tier token returned `403 {"error":"PRO_REQUIRED","message":"Price alerts are a Pro feature."}` exactly as expected.

**Both of the above used one disposable QA test account**, created directly in dev's `auth.users` (bcrypt password hash via `pgcrypto`, matching Supabase Auth's own format) since no real free-tier credentials were available and dev/prod Supabase sessions aren't interchangeable. Verified it could actually sign in via a real `POST /auth/v1/token` call before using it. The signup trigger grants a 14-day trial by default, so `trial_ends_at` was manually nulled to get genuinely free tier. Fully deleted after both tests - `auth.users`, `auth.identities`, `lhq_dev_grok_usage`, `lhq_dev_user_subscriptions`, `lhq_dev_trial_claims` rows all removed, 0 remaining confirmed.

**Layer 3 complete - all 4 items done.**

### 4. End-to-end (real browser, real Telegram bot, clicking through as a user)
- [x] Full Telegram connect flow: sign in on `/alerts` as a Pro/trial test account → press Connect Telegram → confirm deep link opens the real bot → send `/start CODE` for real → confirm the page auto-updates to connected → press Disconnect → confirm it returns to the not-connected state and a fresh `/start` on the same code fails (already used). **DONE 2026-08-04, on dev**, against the new dev-only bot (`@Liquidity_hq_dev_bot`), which is what finally unblocked this - see `pendings/PENDING.md`. Prod's bot and the owner's prod connection were untouched throughout.

  What passed: webhook received the update and verified `TELEGRAM_WEBHOOK_SECRET`; a bare `/start` (what Telegram's blue START button actually sends) returned the correct "open Alerts and press Connect Telegram" fallback; `/start CODE` claimed the code atomically and wrote `telegram_chat_id`; the UI flipped to Connected; Disconnect returned it to not-connected and burned the outstanding codes; and **replaying a spent code was rejected** - the bot answered "that link has expired or was already used", the account stayed disconnected (`telegram_chat_id` still `''`) and no code was re-claimed. That last step is the one that proves single-use is enforced against a real Telegram message rather than only in the SQL.

  Note on the disconnected state: Disconnect writes `telegram_chat_id = ''`, not `null`. Every consumer handles the empty-string sentinel (`!!settings.telegram_chat_id` in the UI, `?.trim()` then a truthiness check in the alert cron's recipient map, and an explicit `.neq('telegram_chat_id','')` in the digest query). A verification query that only tests `is not null` will therefore report a disconnected user as still connected - check for `''` too.

  Two things this run corrected about earlier notes in this file:
  - The deep link **already** carries the payload (`https://t.me/<bot>?start=<CODE>`, built in `app/api/telegram/link-code/route.ts:86`). An earlier read of the FAQ correction below implied it did not. One-tap works; the copy-the-message path is the deliberate fallback, and its step-1 link is payload-free on purpose.
  - Reissuing a code sets `used_at` on the previous one (link-code route burns outstanding codes so only one is ever live). A raw `used_at is not null` query therefore looks like "an expired code got claimed" when it did not. Check *why* `used_at` is set before calling that a defect.

  **The blocker this run actually exposed was not Telegram at all** - see the RLS finding in the gotchas section below. `lhq_dev_user_settings` had RLS enabled with zero policies, so the browser could never read the row the webhook had just written. The connect genuinely worked while `/alerts` insisted "Not connected".
- [x] Open-redirect fix, in a real browser: navigate to `/login?next=%2F%5Cevil.com`, confirm the browser lands on `/dashboard` (the fallback), not `evil.com`. **DONE 2026-08-02**, prod, real signed-in account. Turned out not to need a fresh sign-in at all: `app/login/page.tsx:57` fires `router.replace(nextUrl)` for any authenticated user on mount, not just post-credential-submit - so this ran against the existing session with zero sign-out risk. Landed on `/dashboard` as expected.
- [x] PostHog masking: open `/journal` with a PostHog recording active (may need a temporary project API key pointed at a scratch PostHog project, or just the real one filtered to a test session), add a trade with real notes and a P&L figure, then check the recording in PostHog's own replay UI - the notes/thesis/dollar figures should render as blocked rectangles, not the real text. **DONE 2026-08-03** - selectors and active capture were confirmed 2026-08-02; the replay-UI check was finished on 2026-08-03 once the owner opened the PostHog dashboard. A canary trade was seeded with distinctive notes and a distinctive P&L figure, and both came back as asterisks in the replay. The masked output is asterisks rather than blocked rectangles - that is what a pass looks like.

### 5. User acceptance (the actual product experience, judged by outcome not internals)
- [x] As a brand-new signup: does the 14-day trial banner appear, in the correct language, with a correct day count? **DONE 2026-08-03**, localhost, disposable dev account with `trial_ends_at = now() + 14 days`. Appears: yes. Day count: correct - banner read "14 days left" against a DB value of exactly 14 days, and Pro surfaces unlocked at the same time (the macro card flipped from locked to live). **Correct language: NO** - see the i18n finding below.
- [x] As a free user: does every locked feature show the `LockedFeatureCard` treatment (title + description + Upgrade), never a raw error or a silent no-op? **DONE 2026-08-03**, localhost, same account forced to genuinely free (`role='free'`, `trial_ends_at=null`). Checked every `LockedFeatureCard` call site: `/research` (Dry Powder, Global Macro Context, On-Chain Composite Score), `/alerts` (Connect Telegram, Price Alerts), `/dashboard` (Global Macro Context), `/arena` (Confluence Score). All render title + description + "Unlock with Pro". No raw errors anywhere; `/alerts` "Recently fired" degraded to a proper "No alerts fired yet" empty state. (That card was removed later the same day - it was not user-scoped, see `pendings/PENDING.md` - so this particular empty state no longer exists to re-test.) Also tested the one path that could have been a silent no-op - clicking a gated timeframe chip (`1m`) opens the upgrade modal ("The 1 minute timeframe is part of Pro") rather than doing nothing; free users default to `tf=1h` (`FREE_FALLBACK_TF`).
- [x] As a trial user 2 days from expiry: does the reminder email actually arrive, and does its copy match what the trial actually loses? **DONE 2026-08-03, end to end against prod.**

  *Copy* was audited against every `LockedFeatureCard` call site and `lib/limits.ts` `GATED_TFS`, and **did not match**: it omitted the Confluence Score, on-chain scores, macro context and Dry Powder - four Pro features, one of which (Confluence Score) the FAQ leads on. Fixed in `lib/email.ts`. Gated timeframes (1m/5m/15m) already matched `GATED_TFS` exactly.

  *Delivery* was proven with a plus-addressed disposable prod account (`mikocabal27+trialtest@`, `trial_ends_at` = now + 47h) so the mail reached a real inbox without touching the owner's actual account. Confirmed beforehand that it was the **only** row matching the route's filter, so no real user could be mailed. The owner ran the cron by hand (local `CRON_SECRET` matches neither project, and a secret is not something to paste into a chat).

  Result: `{"ok":true,"due":1,"sent":1}`, mail delivered from `noreply@liquidity-hq.com`, subject "Your LiquidityHQ Pro trial ends in 2 days", body carrying the corrected feature list including the four previously-missing entries. `trial_reminder_sent_at` was written, so the claim-then-send dedupe holds and a second run will not re-send. The not-yet-on-sale CTA branch rendered correctly ("Pro is not on sale yet..."), which is the branch that matters until checkout is live. Test account fully deleted afterwards; owner's real account verified intact.

  This also settled the open question about Brevo: `sendTrialEndingEmail` returns `false` silently when `BREVO_API_KEY`/`BREVO_SENDER_EMAIL` are missing, so a misconfiguration would have looked exactly like "nobody was due". Prod is configured correctly. Note that **local `.env.local` has no Brevo keys**, so this path silently no-ops in local dev - it can only be tested against a deployed environment.
- [x] As a returning free user (post-trial): open the FAQ, confirm the Telegram setup answer matches the actual current flow. **DONE 2026-08-03 - it did not match.** `FAQ_Q_TELEGRAM_SETUP_A` claimed Connect Telegram "gives you a link that connects your account in one tap". The real flow (`app/alerts/page.tsx`) is a two-step wizard: open the bot via a plain `https://t.me/{username}` link (no `?start=` payload, so nothing is pre-filled), then copy and send `/start CODE` using the Copy button. The "never have to find or copy a chat ID" half was accurate. Copy corrected and seeded to dev + prod.

**i18n gap found while checking the trial banner's language (2026-08-03).** `TrialBanner.tsx` is correctly wired to `t()` - the problem is missing rows, not hardcoded English. Under `ko` the nav translates (대시보드/아레나) but the banner stays English, because all five `TRIAL_BANNER_*` keys exist only in `en`. Scope: `en` has 2570 label rows, each of `ko`/`zh`/`ar`/`ru` has 2416 - **154 keys missing per locale**, identical counts in dev and prod. The gap covers the entire Telegram connect wizard (`ALERTS_CONNECT_*`) and the trial banner - i.e. both the onboarding flow the FAQ describes and the main conversion surface are English-only for every non-English user. This is the paused i18n workstream (see `pendings/PENDING.md`), not a regression, but these two surfaces are the ones worth unpausing for. Separately: the language switcher offers Türkçe, Español, Indonesia, Português and Tiếng Việt, none of which have any rows in either project - selecting them silently yields English.

## Who does what

- **I run** layers 1-3 (unit, integration, system) - these don't need a human in the loop and I can drive them directly via Bash/SQL/curl.
- **I can drive layer 4 (E2E)** using the browser tools already used this session for the Supabase dashboard work, EXCEPT the parts that require a real Telegram account sending a real message to the bot - that half needs either your Telegram account or a disposable one.
- **Layer 5 (UAT) needs your judgment**, not just a pass/fail - "does this feel right" is not something I should certify on your behalf. I'll drive the mechanics (create the test account, trigger the state) and report what I observed; you make the call on whether the experience is acceptable.

## Sequencing

1. Layers 1-2 first (cheap, no live server, can start immediately).
2. Deploy the currently-pushed `dev` commit if not already live, WAIT for the cutover window to pass (see gotcha above), then layer 3.
3. Layer 4 next - needs the dev deploy settled and a real test account.
4. Layer 5 last, and only after 1-4 are clean - no point judging user experience against code that hasn't been proven to work yet.

## Status (2026-08-04)

**Layers 1-5: complete.** Nothing in this plan is now blocked.

The last open item, the Telegram connect flow, was closed 2026-08-04 once dev got
its own BotFather bot. Both remaining access blockers are gone:

- **Telegram connect flow** - closed. Ran end to end on dev against
  `@Liquidity_hq_dev_bot`, with prod's bot and the owner's prod connection
  untouched. Previously impossible: dev and prod shared one bot, and Telegram
  allows exactly one webhook per bot, so dev could never receive an update.
- **PostHog replay masking** - closed 2026-08-03. Canary trade seeded, notes and
  P&L came back as asterisks in the replay.

### What running layer 4 actually bought

Both times this layer was run it found something the cheaper layers could not,
which is the argument for keeping it:

- **2026-08-03: the webhook-hijack defect.** A real prod bug where an
  unauthenticated GET repointed the live bot's webhook. Only observable because
  two environments touched the same bot.
- **2026-08-04: an RLS misconfiguration on dev** (`lhq_dev_user_settings`, RLS on
  with zero policies = deny-all for the browser). Invisible to every server-side
  test, because the service-role client bypasses RLS - writes succeeded and the
  table looked healthy. Only a real browser reading its own row could see it.

Both were silent failures that looked like success from the server's side. Layers
1-3 would never have caught either.

Layer 5's two runnable checks also found real defects (a stale FAQ answer, an
incomplete trial email), which is the same argument again.

Both layer 5 checks that could be run found real defects (a stale FAQ answer, an
incomplete trial email), which is the argument for running the rest when the
access exists rather than assuming they pass.
