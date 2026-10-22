-- R4 (#1640): /alerts says "Telegram status unavailable" when /api/telegram/bot-info cannot read the bot's status (503, ok: false, or no
-- answer), instead of silently showing nothing. New key ALERTS_BOT_STATUS_UNAVAILABLE; English default is in lib/labelDefaults.en.json.
--
-- A new key, so `do nothing`: it only fills the gap and can never overwrite a row someone has since approved. ar/ko/ru/zh are Dev machine
-- translations, NOT native-reviewed. Telegram is written as the existing rows write it (ALERTS_CONNECT_TELEGRAM_TITLE).
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).
-- Until applied, every locale shows the English default.

insert into lhq_labels (key, locale, value) values
('ALERTS_BOT_STATUS_UNAVAILABLE','en','Telegram status unavailable'),
('ALERTS_BOT_STATUS_UNAVAILABLE','ar','حالة تيليغرام غير متاحة'),
('ALERTS_BOT_STATUS_UNAVAILABLE','ko','텔레그램 상태를 확인할 수 없음'),
('ALERTS_BOT_STATUS_UNAVAILABLE','ru','Статус Telegram недоступен'),
('ALERTS_BOT_STATUS_UNAVAILABLE','zh','Telegram 状态暂不可用')
on conflict (key, locale) do nothing;

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('ALERTS_BOT_STATUS_UNAVAILABLE','en','Telegram status unavailable'),
-- ('ALERTS_BOT_STATUS_UNAVAILABLE','ar','حالة تيليغرام غير متاحة'),
-- ('ALERTS_BOT_STATUS_UNAVAILABLE','ko','텔레그램 상태를 확인할 수 없음'),
-- ('ALERTS_BOT_STATUS_UNAVAILABLE','ru','Статус Telegram недоступен'),
-- ('ALERTS_BOT_STATUS_UNAVAILABLE','zh','Telegram 状态暂不可用')
-- on conflict (key, locale) do nothing;
