# QA harness: the Telegram alert cron against a fake network

The REAL `app/api/telegram/alert/route.ts` handler runs in-process (jiti transpiles the TypeScript) with `fetch` replaced by `qa/telegramWorld.mjs`: a fake Supabase REST, a fake Telegram Bot API that records every sendMessage, fake exchange tickers and klines. Nothing leaves the machine; the secrets are throwaway literals.

Run (not part of `npm test`: each cell runs the whole route, 10-30 s):

    node --import ./qa/alias-register.mjs --test --test-timeout=120000 qa/harness/*.test.mts

`telegramPriceAlerts.test.mts`: price alerts above/below, ownership and Free/Pro gating, consume-once, 403/400/network failures and the held retry, health row.
`telegramSignals.test.mts`: single signal and "Signals Aligned" text and the signals-not-predictions footer, per-type and per-coin mute, cooldown, trial coin ladder, Free exclusion, send failure.
The synthetic market makes PEPE and BONK fire EMA BUY signals on every timeframe; that is used on purpose to get confluence messages.
`opsBanGuard.test.mts` (#2335): PATCH `/api/ops/users/[id]` and `/api/ops/config` - staff cannot ban/unban an owner, staff or bootstrap owner (403, fails closed), an owner can, ordinary accounts and inactive admin rows are unaffected; the audit insert is checked (`auditLogged:false` on failure, action name reported, row content never), before-state in the detail; source guard for the four ops routes. 11 mutations each turn a cell red.
`telegramSend.test.mts` (#2332): POST `/api/telegram/send` end to end - 401 signed out, 403 not Pro (trial counts), 409 no linked chat and no global-chat fallback, own chat only, 413/400 body rules, text escaping, 10/min and 100/hour per user through a fake `lhq_rate_limit_hit` (and the in-memory fallback), no Telegram text echoed, flag off 503, and no browser caller left in the app. 10 route mutations each turn a cell red.
