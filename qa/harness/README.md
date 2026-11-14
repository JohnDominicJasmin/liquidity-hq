# QA harness: the Telegram alert cron against a fake network

The REAL `app/api/telegram/alert/route.ts` handler runs in-process (jiti transpiles the TypeScript) with `fetch` replaced by `qa/telegramWorld.mjs`: a fake Supabase REST, a fake Telegram Bot API that records every sendMessage, fake exchange tickers and klines. Nothing leaves the machine; the secrets are throwaway literals.

Run (not part of `npm test`: each cell runs the whole route, 10-30 s):

    node --import ./qa/alias-register.mjs --test --test-timeout=120000 qa/harness/*.test.mts

`telegramPriceAlerts.test.mts`: price alerts above/below, ownership and Free/Pro gating, consume-once, 403/400/network failures and the held retry, health row.
`telegramSignals.test.mts`: single signal and "Signals Aligned" text and the signals-not-predictions footer, per-type and per-coin mute, cooldown, trial coin ladder, Free exclusion, send failure.
The synthetic market makes PEPE and BONK fire EMA BUY signals on every timeframe; that is used on purpose to get confluence messages.
