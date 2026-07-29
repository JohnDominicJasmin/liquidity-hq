-- Copy for the rebuilt Connect Telegram flow on the Alerts page.
--
-- The old wizard asked the user to paste a Telegram chat ID, which is exactly
-- the hole 20260807j closed: the client supplied the value, so anyone could
-- point their alerts at a stranger's phone. The flow now hands out a one-time
-- code, the user sends it to the bot, and the webhook writes the chat ID
-- server-side - so every string here is about the code, the deep link, and
-- waiting for the bot to confirm. The old ALERTS_DETECT_*, ALERTS_CHAT_ID_*
-- and ALERTS_SAVE_* rows are left in place; they are simply no longer read.
--
-- ALERTS_CONNECT_EXPIRES_IN takes {time} as a minutes:seconds countdown built
-- in the component, so translators never have to format a clock themselves.
-- ALERTS_CONNECT_WEBHOOK_WARNING is a new key rather than an edit of
-- ALERTS_WEBHOOK_FAILED_WARNING, whose text told the user to enter a chat ID
-- by hand and is already translated into several locales with that wording.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('ALERTS_CONNECT_PREPARING','en','Preparing your link…'),
('ALERTS_CONNECT_OPEN_TELEGRAM','en','Open Telegram'),
('ALERTS_CONNECT_DEEP_LINK_HINT','en','This opens your chat with the bot. Press Start there and you are connected.'),
('ALERTS_CONNECT_MANUAL_FALLBACK','en','If that button does not work, connect by hand:'),
('ALERTS_CONNECT_MANUAL_ONLY','en','Connect in two steps:'),
('ALERTS_CONNECT_SEND_MESSAGE','en','Send this message to the bot:'),
('ALERTS_CONNECT_COPY_BUTTON','en','Copy message'),
('ALERTS_CONNECT_COPIED','en','Copied'),
('ALERTS_CONNECT_EXPIRES_IN','en','This code expires in {time}.'),
('ALERTS_CONNECT_CODE_EXPIRED','en','This code has expired. Get a new one to keep going.'),
('ALERTS_CONNECT_NEW_CODE_BUTTON','en','Get a new code'),
('ALERTS_CONNECT_WAITING','en','Waiting for you to finish in Telegram. This page updates on its own the moment you are connected.'),
('ALERTS_CONNECT_STILL_WAITING','en','Still not connected. Finish the steps in Telegram, then check again.'),
('ALERTS_CONNECT_CHECK_AGAIN','en','Check again'),
('ALERTS_CONNECT_FAILED','en','Could not start the connection. Please try again in a moment.'),
('ALERTS_CONNECT_SECURITY_NOTE','en','The code proves the Telegram chat belongs to you. It works one time only, and only for your account.'),
('ALERTS_CONNECT_WEBHOOK_WARNING','en','The bot is not responding properly right now, so it may not reply when you press Start. Try again in a few minutes.'),
('ALERTS_CONNECTED_DESC','en','Your Telegram account is connected. Alerts arrive in your Telegram chat.'),
('ALERTS_DISCONNECT_BUTTON','en','Disconnect'),
('ALERTS_DISCONNECTING','en','Disconnecting…'),
('ALERTS_DISCONNECT_FAILED','en','Could not disconnect. Please try again.'),

-- The FAQ still described the OLD flow ("get your chat ID, then paste it into
-- Settings"), which is now impossible - /api/settings rejects the field
-- outright. Instructions that cannot be followed are worse than none, so this
-- is corrected in the same pass rather than left as a follow-up. Checked
-- first: this key only exists in `en`, so there is no translated wording to
-- reconcile.
('FAQ_Q_TELEGRAM_SETUP_A','en','Telegram alerts are a Pro feature. Open the Alerts page and press Connect Telegram - it gives you a link that connects your account in one tap, so you never have to find or copy a chat ID.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
