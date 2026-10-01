-- #1113: two page hints that named things the page does not have. QA flagged
-- both (#1113, 2026-09-30 20:42Z) after 20260928a shipped them; the owner
-- approved the corrected wording on 2026-09-30 (relayed by PM/DevOps).
--
-- 1. SETTINGS_HINT_BODY (en). Settings has no connected-accounts section, and
--    the phrase reads as linking an exchange account, which we do not offer.
--      BEFORE: "Your trading profile, risk defaults, watchlist, notifications,
--              connected accounts and subscription - everything that
--              personalizes how LiquidityHQ works for you."
--      AFTER:  "Your trading profile, risk defaults, watchlist, notifications
--              and subscription - everything that personalizes how LiquidityHQ
--              works for you."
--    ALREADY APPLIED TO PRODUCTION by PM/DevOps on 2026-09-30 at 22:05:20Z
--    (guarded on the old value, read back; recorded on #1113). The production
--    row below is that same value, so re-running it changes nothing.
--
-- 2. ALERTS_HINT_BODY (en). /alerts has no funding alert. Its 12 toggles are
--    RSI, rapid moves, whales, OI spike, CVD, squeeze, distribution, news, fear
--    and greed, sentiment extremes, price level and daily summary. In the
--    Telegram cron, funding is only an input to the combined sentiment and
--    squeeze alerts. The one funding-only alert is the Arena's in-page browser
--    notification (#1113, Dev answer).
--      BEFORE: "Set price, funding, RSI, whale and open-interest alerts per
--              coin. When one fires you get a Telegram or push notification -
--              toggle which are active and mute the ones you don't need."
--      AFTER:  the same without "funding, ".
--    ALREADY APPLIED TO PRODUCTION by PM/DevOps on 2026-09-30 at 22:07:46Z,
--    on the owner's approval (read back; see #1113). Same value as below.
--
-- The English values equal lib/labelDefaults.en.json, changed in the same PR.
-- No ko/zh/ar/ru rows exist for either key in either database. #1475's
-- translation migration (20261001c) fills them from this corrected English.
--
-- `do update`: these rows exist and are wrong. Only these two keys, en only.
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention). Shared-database write. Dev has no row for
-- either key today, so the dev block inserts them.

insert into lhq_labels (key, locale, value) values
('SETTINGS_HINT_BODY','en','Your trading profile, risk defaults, watchlist, notifications and subscription - everything that personalizes how LiquidityHQ works for you.'),
('ALERTS_HINT_BODY','en','Set price, RSI, whale and open-interest alerts per coin. When one fires you get a Telegram or push notification - toggle which are active and mute the ones you don''t need.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write; PM/DevOps applies after QA clears the timing).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('SETTINGS_HINT_BODY','en','Your trading profile, risk defaults, watchlist, notifications and subscription - everything that personalizes how LiquidityHQ works for you.'),
-- ('ALERTS_HINT_BODY','en','Set price, RSI, whale and open-interest alerts per coin. When one fires you get a Telegram or push notification - toggle which are active and mute the ones you don''t need.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
