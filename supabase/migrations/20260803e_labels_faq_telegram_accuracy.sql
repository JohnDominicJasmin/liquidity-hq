-- Corrects the FAQ's Telegram setup answer to match the actual flow.
--
-- FAQ_Q_TELEGRAM_SETUP_A claimed Connect Telegram "gives you a link that
-- connects your account in one tap". app/alerts/page.tsx does not do that:
-- botLink is a plain https://t.me/{username} with no ?start= payload, so
-- nothing is pre-filled. The real flow is a two-step wizard - open the bot,
-- then copy and send "/start CODE" (there is a Copy button for it).
--
-- The other half of the old sentence was accurate and is kept: you never do
-- have to find or copy a chat ID.
--
-- Found by QA_TEST_PLAN.md layer 5, which exists to catch exactly this kind of
-- doc-vs-behaviour drift.
--
-- Worth noting for later: Telegram supports t.me/BOT?start=PAYLOAD deep links,
-- which would auto-fill the command and make the original "one tap" claim true.
-- That is a product change, not a copy fix, so it is not done here.

insert into lhq_labels (key, locale, value) values
('FAQ_Q_TELEGRAM_SETUP_A','en','Telegram alerts are a Pro feature. Open the Alerts page and press Connect Telegram. You get a one-time code and two steps: open the bot, then send it the /start message shown on the page - there is a Copy button so you do not have to type it. The page updates itself the moment the bot receives it, and you never have to find or copy a chat ID.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same row against lhq_dev_labels (already applied live).
