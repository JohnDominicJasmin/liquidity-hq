-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Short mute from a Telegram alert (#1651 Telegram checklist, #2560 open list), 2 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   ALERTS_TYPE_MUTED_UNTIL       new: the line under OI spike / CVD / Rapid moves on /alerts while a "Mute 1 h / 4 h" tapped in Telegram lasts.
--   ALERTS_SIGNAL_DIRECTION_DESC  reworded: the Long / Short signals mutes now also reach OI, CVD and rapid-move alerts, so the old list of examples was short.
-- The Telegram buttons and the bot's confirmation stay English constants (lib/alertTypeMute.ts): the bot has no locale yet.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_TYPE_MUTED_UNTIL','en','Muted from Telegram until {time}'),
('ALERTS_TYPE_MUTED_UNTIL','ko','텔레그램에서 {time}까지 음소거됨'),
('ALERTS_TYPE_MUTED_UNTIL','zh','已在 Telegram 静音至 {time}'),
('ALERTS_TYPE_MUTED_UNTIL','ru','Отключено в Telegram до {time}'),
('ALERTS_TYPE_MUTED_UNTIL','ar','مكتوم من تيليجرام حتى {time}'),
('ALERTS_SIGNAL_DIRECTION_DESC','en','Silence one side of every directional signal.'),
('ALERTS_SIGNAL_DIRECTION_DESC','ko','모든 방향성 신호의 한쪽을 음소거합니다.'),
('ALERTS_SIGNAL_DIRECTION_DESC','zh','屏蔽所有方向性信号中的某一侧。'),
('ALERTS_SIGNAL_DIRECTION_DESC','ru','Отключает одну сторону всех направленных сигналов.'),
('ALERTS_SIGNAL_DIRECTION_DESC','ar','أسكت جانباً واحداً من كل الإشارات الاتجاهية.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_TYPE_MUTED_UNTIL','en','Muted from Telegram until {time}'),
('ALERTS_TYPE_MUTED_UNTIL','ko','텔레그램에서 {time}까지 음소거됨'),
('ALERTS_TYPE_MUTED_UNTIL','zh','已在 Telegram 静音至 {time}'),
('ALERTS_TYPE_MUTED_UNTIL','ru','Отключено в Telegram до {time}'),
('ALERTS_TYPE_MUTED_UNTIL','ar','مكتوم من تيليجرام حتى {time}'),
('ALERTS_SIGNAL_DIRECTION_DESC','en','Silence one side of every directional signal.'),
('ALERTS_SIGNAL_DIRECTION_DESC','ko','모든 방향성 신호의 한쪽을 음소거합니다.'),
('ALERTS_SIGNAL_DIRECTION_DESC','zh','屏蔽所有方向性信号中的某一侧。'),
('ALERTS_SIGNAL_DIRECTION_DESC','ru','Отключает одну сторону всех направленных сигналов.'),
('ALERTS_SIGNAL_DIRECTION_DESC','ar','أسكت جانباً واحداً من كل الإشارات الاتجاهية.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
