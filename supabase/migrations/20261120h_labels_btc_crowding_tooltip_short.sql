-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The BTC crowding tooltip is cut to the 20-word tooltip budget (OWNER-RULES s25; PM 2026-11-19: the 20261120e text was about 50 words and was rejected). 1 key x 5 locales; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('BTC_RISK_LEVEL_TOOLTIP','en','Fear & Greed, daily RSI, positive funding and long-account share, combined 0-100. Positioning, not a forecast.'),
('BTC_RISK_LEVEL_TOOLTIP','ko','공포·탐욕 지수, 일봉 RSI, 양의 펀딩, 롱 계정 비율을 합친 0-100 점수. 포지셔닝일 뿐 예측이 아닙니다.'),
('BTC_RISK_LEVEL_TOOLTIP','zh','恐惧与贪婪、日线 RSI、正资金费率和多头账户占比，合成 0-100 分。反映仓位，不是预测。'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Fear & Greed, дневной RSI, положительный фандинг и доля лонгов, сведённые в 0-100. Позиционирование, не прогноз.'),
('BTC_RISK_LEVEL_TOOLTIP','ar','مؤشر الخوف والطمع وRSI اليومي والتمويل الموجب ونسبة الحسابات الطويلة معًا من 0 إلى 100. تموضع وليس توقعًا.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('BTC_RISK_LEVEL_TOOLTIP','en','Fear & Greed, daily RSI, positive funding and long-account share, combined 0-100. Positioning, not a forecast.'),
('BTC_RISK_LEVEL_TOOLTIP','ko','공포·탐욕 지수, 일봉 RSI, 양의 펀딩, 롱 계정 비율을 합친 0-100 점수. 포지셔닝일 뿐 예측이 아닙니다.'),
('BTC_RISK_LEVEL_TOOLTIP','zh','恐惧与贪婪、日线 RSI、正资金费率和多头账户占比，合成 0-100 分。反映仓位，不是预测。'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Fear & Greed, дневной RSI, положительный фандинг и доля лонгов, сведённые в 0-100. Позиционирование, не прогноз.'),
('BTC_RISK_LEVEL_TOOLTIP','ar','مؤشر الخوف والطمع وRSI اليومي والتمويل الموجب ونسبة الحسابات الطويلة معًا من 0 إلى 100. تموضع وليس توقعًا.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
