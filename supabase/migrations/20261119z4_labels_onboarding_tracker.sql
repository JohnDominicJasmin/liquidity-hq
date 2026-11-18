-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Onboarding tracker sweep (#1113, PM persona walkthrough 2026-11-16). Two keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   TNAV_SESSION_TIP         new: hover text on the nav's session pill ("God Tier · 1h 19m").
--   TRADE_JOURNAL_AUTH_DESC  changed: the signed-out journal prompt names the stats the journal shows (all on the free Stats tab).
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('TNAV_SESSION_TIP','en','Current trading session window and the time left in it.'),
('TNAV_SESSION_TIP','ko','현재 거래 세션 시간대와 남은 시간입니다.'),
('TNAV_SESSION_TIP','zh','当前交易时段及其剩余时间。'),
('TNAV_SESSION_TIP','ru','Текущее торговое окно и сколько времени в нём осталось.'),
('TNAV_SESSION_TIP','ar','نافذة جلسة التداول الحالية والوقت المتبقي فيها.'),
('TRADE_JOURNAL_AUTH_DESC','en','Log your trades and see your win rate, total P&L, average R per trade, streaks, an equity curve, and results by coin and setup. Your journal is private to your account.'),
('TRADE_JOURNAL_AUTH_DESC','ko','거래를 기록하면 승률, 총 손익, 거래당 평균 R, 연속 기록, 자산 곡선, 코인별·셋업별 성과를 볼 수 있습니다. 저널은 내 계정에만 공개됩니다.'),
('TRADE_JOURNAL_AUTH_DESC','zh','记录你的交易,即可查看胜率、总盈亏、每笔平均R值、连胜连败、资金曲线,以及按币种和形态划分的表现。你的交易日志仅对你的账户可见。'),
('TRADE_JOURNAL_AUTH_DESC','ru','Записывайте сделки и смотрите процент прибыльных сделок, общий P&L, средний R на сделку, серии, кривую капитала и результаты по монетам и сетапам. Журнал виден только вашему аккаунту.'),
('TRADE_JOURNAL_AUTH_DESC','ar','سجّل صفقاتك واطّلع على نسبة الربح وإجمالي الربح والخسارة ومتوسط R لكل صفقة والسلاسل ومنحنى رأس المال والنتائج حسب العملة والإعداد. سجلّك خاص بحسابك.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('TNAV_SESSION_TIP','en','Current trading session window and the time left in it.'),
('TNAV_SESSION_TIP','ko','현재 거래 세션 시간대와 남은 시간입니다.'),
('TNAV_SESSION_TIP','zh','当前交易时段及其剩余时间。'),
('TNAV_SESSION_TIP','ru','Текущее торговое окно и сколько времени в нём осталось.'),
('TNAV_SESSION_TIP','ar','نافذة جلسة التداول الحالية والوقت المتبقي فيها.'),
('TRADE_JOURNAL_AUTH_DESC','en','Log your trades and see your win rate, total P&L, average R per trade, streaks, an equity curve, and results by coin and setup. Your journal is private to your account.'),
('TRADE_JOURNAL_AUTH_DESC','ko','거래를 기록하면 승률, 총 손익, 거래당 평균 R, 연속 기록, 자산 곡선, 코인별·셋업별 성과를 볼 수 있습니다. 저널은 내 계정에만 공개됩니다.'),
('TRADE_JOURNAL_AUTH_DESC','zh','记录你的交易,即可查看胜率、总盈亏、每笔平均R值、连胜连败、资金曲线,以及按币种和形态划分的表现。你的交易日志仅对你的账户可见。'),
('TRADE_JOURNAL_AUTH_DESC','ru','Записывайте сделки и смотрите процент прибыльных сделок, общий P&L, средний R на сделку, серии, кривую капитала и результаты по монетам и сетапам. Журнал виден только вашему аккаунту.'),
('TRADE_JOURNAL_AUTH_DESC','ar','سجّل صفقاتك واطّلع على نسبة الربح وإجمالي الربح والخسارة ومتوسط R لكل صفقة والسلاسل ومنحنى رأس المال والنتائج حسب العملة والإعداد. سجلّك خاص بحسابك.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
