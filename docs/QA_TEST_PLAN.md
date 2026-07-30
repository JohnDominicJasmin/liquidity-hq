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

## Known gotcha, discovered today - read before running anything live

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
| `safeNextPath` open-redirect fix | DONE (13 cases, Node harness) | - | - | not clicked through in a real browser |
| Telegram webhook fail-closed on missing secret | - | - | DONE (curl, prod) | - |
| Trial-ending email + cron job | - | - | DONE (curl auth check + DB due-count) | **the email itself has never actually sent** (0 rows were due both times checked) |
| LemonSqueezy webhook: payer-email check + replay guard | - | - | - | **yes** - payments aren't live, no real webhook payload exists to test with |
| `grok-chat` model pin + `max_tokens` clamp | DONE (9 cases, Node harness) | - | build+tsc only | **not curled against a live deployment** |
| `ban-reason` rate limit (5/min/IP) | - | - | **attempted, inconclusive** (ran during deploy cutover, see gotcha above) | needs re-run |
| `/api/admin` honeypot rate limit (5/min/IP) | - | - | **attempted, inconclusive** (same cutover) - also: status code is 404 either way BY DESIGN, so status code alone can never prove the limit fired | needs a DB-row-count check, not just curl |
| PostHog `maskTextSelector` on TradeJournal | - | - | class-uniqueness confirmed via grep | **never opened in a real browser with recording on** |
| Price-alerts PATCH Pro-gate | - | - | build+tsc only | **not curled with a real free-tier token** |

## Test plan by layer

### 1. Unit tests (pure logic, no network, no server) - can run right now, cheapest tier
Already done ad hoc in throwaway Node scripts this session; the only new work
here is making them permanent instead of one-off.

- [ ] Move the `safeNextPath` 13-case harness into `__tests__/safeNext.test.ts` (or the project's existing test runner if one exists - `package.json` needs a check, no test framework was observed in use this session).
- [ ] Same for the `grok-chat` `max_tokens` clamp (9 cases already written).
- [ ] Same for the link-code generator (alphabet/length/entropy check already run once manually).

### 2. Integration tests (real DB, no live server - what the SQL-against-dev checks already were)
- [ ] Re-confirm `increment_ai_usage` three-tier behavior still holds after the newest migrations (last run 2026-08-07, before `d1a4a7b`).
- [ ] Re-run the 4-case Telegram link-code claim test (valid/replay/expired/unknown) - last run before the UI rebuild, never re-run after.

### 3. System tests (the actual deployed dev service, black-box HTTP) - do these AFTER the deploy-cutover wait above
- [ ] `ban-reason`: 7 requests, same IP, spaced ~1s apart, expect requests 1-5 → `200`, 6-7 → `429`.
- [ ] Admin honeypot: cannot verify via status code (404 both ways by design). Instead: `select count(*) from lhq_dev_admin_audit_log where action='honeypot_admin_api_hit'` before and after a 10-request burst - expect at most 5 new rows, not 10.
- [ ] `grok-chat`: authenticated request with `max_tokens: 999999` in the body; confirm via GlitchTip/Render logs (not the response, which won't reveal the true value sent to xAI) that the outbound request used 600, not 999999. If no cheap way to observe the outbound value, add a temporary debug log for one test run and remove it after.
- [ ] Price-alerts PATCH: real free-tier token, attempt to edit an existing alert, expect `403 PRO_REQUIRED`. Needs one real free-tier test account with at least one existing alert row.

### 4. End-to-end (real browser, real Telegram bot, clicking through as a user)
- [ ] Full Telegram connect flow: sign in on `/alerts` as a Pro/trial test account → press Connect Telegram → confirm deep link opens the real bot → send `/start CODE` for real → confirm the page auto-updates to connected within the 3s poll → press Disconnect → confirm it returns to the not-connected state and a fresh `/start` on the same code fails (already used).
- [ ] Open-redirect fix, in a real browser: navigate to `/login?next=%2F%5Cevil.com`, sign in, confirm the browser lands on `/dashboard` (the fallback), not `evil.com`.
- [ ] PostHog masking: open `/journal` with a PostHog recording active (may need a temporary project API key pointed at a scratch PostHog project, or just the real one filtered to a test session), add a trade with real notes and a P&L figure, then check the recording in PostHog's own replay UI - the notes/thesis/dollar figures should render as blocked rectangles, not the real text.

### 5. User acceptance (the actual product experience, judged by outcome not internals)
- [ ] As a brand-new signup: does the 14-day trial banner appear, in the correct language, with a correct day count?
- [ ] As a free user: does every locked feature show the `LockedFeatureCard` treatment (title + description + Upgrade), never a raw error or a silent no-op?
- [ ] As a trial user 2 days from expiry: does the reminder email actually arrive, and does its copy match what the trial actually loses? (Blocked until a real account is naturally 2 days from expiry, or a test row's `trial_ends_at` is manually set close to now and the cron route is called directly.)
- [ ] As a returning free user (post-trial): open the FAQ, confirm the Telegram setup answer matches the actual current flow (this was already corrected once this session after being caught stale - worth a final read-through, not just a grep for the old wording).

## Who does what

- **I run** layers 1-3 (unit, integration, system) - these don't need a human in the loop and I can drive them directly via Bash/SQL/curl.
- **I can drive layer 4 (E2E)** using the browser tools already used this session for the Supabase dashboard work, EXCEPT the parts that require a real Telegram account sending a real message to the bot - that half needs either your Telegram account or a disposable one.
- **Layer 5 (UAT) needs your judgment**, not just a pass/fail - "does this feel right" is not something I should certify on your behalf. I'll drive the mechanics (create the test account, trigger the state) and report what I observed; you make the call on whether the experience is acceptable.

## Sequencing

1. Layers 1-2 first (cheap, no live server, can start immediately).
2. Deploy the currently-pushed `dev` commit if not already live, WAIT for the cutover window to pass (see gotcha above), then layer 3.
3. Layer 4 next - needs the dev deploy settled and a real test account.
4. Layer 5 last, and only after 1-4 are clean - no point judging user experience against code that hasn't been proven to work yet.

Not started. Waiting for review before execution.
