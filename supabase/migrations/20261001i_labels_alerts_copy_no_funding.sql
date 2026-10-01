-- #1113: the /alerts subtitle and the Connect Telegram card still named a
-- funding alert. There is none. The 12 /alerts toggles are RSI, rapid moves,
-- whales, OI spike, CVD, squeeze, distribution, news, fear and greed,
-- sentiment extremes, price level and daily summary. In the Telegram cron,
-- funding is only an input to the combined sentiment and squeeze alerts
-- (#1113, Dev answer). PM/DevOps made the copy call on #1113 at 03:35Z under
-- the owner's rule that copy says only what exists. This matches
-- ALERTS_HINT_BODY, already corrected in 20261001d.
--
-- 1. ALERTS_PAGE_SUBTITLE, the line under the "Telegram Alerts" heading.
--      BEFORE: "Push alerts to your phone, checked every 5 minutes - funding,
--              momentum, whale flow, sentiment, and price levels"
--      AFTER:  the same without "funding, ".
--    ko/zh/ar/ru: the 20260917 value with the funding item and its list
--    separator removed. Nothing else in the sentence changes.
--
-- 2. ALERTS_LOCKED_FEATURE_DESC, the body of the locked "Connect Telegram"
--    card that free accounts see on /alerts.
--      BEFORE: "Push alerts for funding rate extremes, RSI signals, open
--              interest spikes, whale moves, and price levels - sent
--              directly to Telegram."
--      AFTER:  the same without "funding rate extremes, ".
--    ko/zh/ar: the seed value (20260731a / 20260801a / 20260802a) with the
--    funding item and its list separator removed. No ru row exists in any
--    migration file for this key, so none is written here.
--
-- Not changed: ALERTS_SENTIMENT_EXTREMES_DESC, ALERTS_DISTRIBUTION_DESC and
-- ALERTS_EMA_SETUP_4H_DESC name funding as an input to those alerts, which
-- is true.
--
-- The English values equal lib/labelDefaults.en.json, changed in the same PR.
-- The non-English values are taken from the latest migration file that wrote
-- each row. The live label table is the record, and production can hold rows
-- no migration inserted. Read the live rows for both keys in every locale
-- before applying, and correct any row that differs from the BEFORE text.
--
-- `do update`: these rows exist and are wrong. Only these two keys.
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention). Shared-database write: needs the
-- owner's approval to apply.

insert into lhq_labels (key, locale, value) values
('ALERTS_PAGE_SUBTITLE','en','Push alerts to your phone, checked every 5 minutes - momentum, whale flow, sentiment, and price levels'),
('ALERTS_PAGE_SUBTITLE','ko','5분마다 확인하여 휴대폰으로 푸시 알림을 보냅니다 - 모멘텀, 고래 흐름, 심리, 가격 레벨'),
('ALERTS_PAGE_SUBTITLE','zh','每5分钟检查一次，推送到您的手机 - 动能、巨鲸流向、市场情绪和价格水平'),
('ALERTS_PAGE_SUBTITLE','ar','تنبيهات فورية إلى هاتفك، يتم فحصها كل 5 دقائق - الزخم، تدفق الحيتان، المعنويات، ومستويات الأسعار'),
('ALERTS_PAGE_SUBTITLE','ru','Push-уведомления на телефон, проверка каждые 5 минут - моментум, потоки китов, настроения и ценовые уровни'),
('ALERTS_LOCKED_FEATURE_DESC','en','Push alerts for RSI signals, open interest spikes, whale moves, and price levels - sent directly to Telegram.'),
('ALERTS_LOCKED_FEATURE_DESC','ko','RSI 신호, 미결제약정 급등, 고래 움직임, 가격 레벨에 대한 푸시 알림을 텔레그램으로 직접 전송합니다.'),
('ALERTS_LOCKED_FEATURE_DESC','zh','RSI 信号、持仓量异动、巨鲸动向、价位提醒 - 直接推送到 Telegram。'),
('ALERTS_LOCKED_FEATURE_DESC','ar','تنبيهات تُرسل مباشرة إلى تيليغرام عند إشارات RSI، قفزات الفائدة المفتوحة، تحركات الحيتان، ومستويات الأسعار.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write; PM/DevOps applies after QA clears the timing).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('ALERTS_PAGE_SUBTITLE','en','Push alerts to your phone, checked every 5 minutes - momentum, whale flow, sentiment, and price levels'),
-- ('ALERTS_PAGE_SUBTITLE','ko','5분마다 확인하여 휴대폰으로 푸시 알림을 보냅니다 - 모멘텀, 고래 흐름, 심리, 가격 레벨'),
-- ('ALERTS_PAGE_SUBTITLE','zh','每5分钟检查一次，推送到您的手机 - 动能、巨鲸流向、市场情绪和价格水平'),
-- ('ALERTS_PAGE_SUBTITLE','ar','تنبيهات فورية إلى هاتفك، يتم فحصها كل 5 دقائق - الزخم، تدفق الحيتان، المعنويات، ومستويات الأسعار'),
-- ('ALERTS_PAGE_SUBTITLE','ru','Push-уведомления на телефон, проверка каждые 5 минут - моментум, потоки китов, настроения и ценовые уровни'),
-- ('ALERTS_LOCKED_FEATURE_DESC','en','Push alerts for RSI signals, open interest spikes, whale moves, and price levels - sent directly to Telegram.'),
-- ('ALERTS_LOCKED_FEATURE_DESC','ko','RSI 신호, 미결제약정 급등, 고래 움직임, 가격 레벨에 대한 푸시 알림을 텔레그램으로 직접 전송합니다.'),
-- ('ALERTS_LOCKED_FEATURE_DESC','zh','RSI 信号、持仓量异动、巨鲸动向、价位提醒 - 直接推送到 Telegram。'),
-- ('ALERTS_LOCKED_FEATURE_DESC','ar','تنبيهات تُرسل مباشرة إلى تيليغرام عند إشارات RSI، قفزات الفائدة المفتوحة، تحركات الحيتان، ومستويات الأسعار.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
