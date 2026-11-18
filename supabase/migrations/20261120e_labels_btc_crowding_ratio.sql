-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- BTC crowding takes the long-account share as a fourth input (PM 2026-11-19: Research read 'BTC crowding 4/100 Low' while the Dashboard showed 74.6% long accounts). 3 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   BTC_RISK_LEVEL_TOOLTIP, BTC_RISK_LEVEL_INPUTS_COUNT  changed: four inputs.   BTC_RISK_LEVEL_RATIO_LABEL  new: the row label, {venue} = the venue the ratio is read from.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('BTC_RISK_LEVEL_TOOLTIP','en','Blends four inputs into one 0-100 score of how crowded long positions look: the Fear & Greed index, BTC''s daily RSI, BTC''s funding rate (only positive funding adds to it) and the share of accounts that are long. It describes positioning, not a forecast of price.'),
('BTC_RISK_LEVEL_TOOLTIP','ko','네 가지 입력을 0-100 점수 하나로 합쳐 롱 포지션이 얼마나 쏠려 있는지 보여줍니다: 공포·탐욕 지수, BTC 일봉 RSI, BTC 펀딩비(양수 펀딩만 반영), 롱 계정 비율. 포지셔닝을 설명할 뿐 가격 예측이 아닙니다.'),
('BTC_RISK_LEVEL_TOOLTIP','zh','将四个输入合成一个 0-100 分数，表示多头仓位的拥挤程度：恐惧与贪婪指数、BTC 日线 RSI、BTC 资金费率（仅正资金费率计入）和多头账户占比。它描述仓位情况，而非价格预测。'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Объединяет четыре показателя в одну оценку 0-100 того, насколько переполнены лонги: индекс страха и жадности, дневной RSI BTC, фандинг BTC (учитывается только положительный) и доля аккаунтов в лонге. Это позиционирование, а не прогноз цены.'),
('BTC_RISK_LEVEL_TOOLTIP','ar','يجمع أربعة مدخلات في درجة 0-100 توضح مدى ازدحام المراكز الطويلة: مؤشر الخوف والطمع وRSI اليومي لـ BTC ومعدل تمويل BTC (التمويل الموجب فقط يُحتسب) ونسبة الحسابات في مراكز لونغ. تصف التموضع وليست توقعًا للسعر.'),
('BTC_RISK_LEVEL_INPUTS_COUNT','en','{n} of 4 inputs'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ko','입력 {n}/4개'),
('BTC_RISK_LEVEL_INPUTS_COUNT','zh','{n}/4 项输入'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ru','Входов: {n} из 4'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ar','{n} من 4 مدخلات'),
('BTC_RISK_LEVEL_RATIO_LABEL','en','Long accounts ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','ko','롱 계정 ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','zh','多头账户 ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','ru','Аккаунты в лонге ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','ar','حسابات لونغ ({venue})')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('BTC_RISK_LEVEL_TOOLTIP','en','Blends four inputs into one 0-100 score of how crowded long positions look: the Fear & Greed index, BTC''s daily RSI, BTC''s funding rate (only positive funding adds to it) and the share of accounts that are long. It describes positioning, not a forecast of price.'),
('BTC_RISK_LEVEL_TOOLTIP','ko','네 가지 입력을 0-100 점수 하나로 합쳐 롱 포지션이 얼마나 쏠려 있는지 보여줍니다: 공포·탐욕 지수, BTC 일봉 RSI, BTC 펀딩비(양수 펀딩만 반영), 롱 계정 비율. 포지셔닝을 설명할 뿐 가격 예측이 아닙니다.'),
('BTC_RISK_LEVEL_TOOLTIP','zh','将四个输入合成一个 0-100 分数，表示多头仓位的拥挤程度：恐惧与贪婪指数、BTC 日线 RSI、BTC 资金费率（仅正资金费率计入）和多头账户占比。它描述仓位情况，而非价格预测。'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Объединяет четыре показателя в одну оценку 0-100 того, насколько переполнены лонги: индекс страха и жадности, дневной RSI BTC, фандинг BTC (учитывается только положительный) и доля аккаунтов в лонге. Это позиционирование, а не прогноз цены.'),
('BTC_RISK_LEVEL_TOOLTIP','ar','يجمع أربعة مدخلات في درجة 0-100 توضح مدى ازدحام المراكز الطويلة: مؤشر الخوف والطمع وRSI اليومي لـ BTC ومعدل تمويل BTC (التمويل الموجب فقط يُحتسب) ونسبة الحسابات في مراكز لونغ. تصف التموضع وليست توقعًا للسعر.'),
('BTC_RISK_LEVEL_INPUTS_COUNT','en','{n} of 4 inputs'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ko','입력 {n}/4개'),
('BTC_RISK_LEVEL_INPUTS_COUNT','zh','{n}/4 项输入'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ru','Входов: {n} из 4'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ar','{n} من 4 مدخلات'),
('BTC_RISK_LEVEL_RATIO_LABEL','en','Long accounts ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','ko','롱 계정 ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','zh','多头账户 ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','ru','Аккаунты в лонге ({venue})'),
('BTC_RISK_LEVEL_RATIO_LABEL','ar','حسابات لونغ ({venue})')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
