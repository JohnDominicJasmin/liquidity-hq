-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- #1651 data items (PM 2026-11-17): the BTC crowding card says what it measures; the two long/short figures say which accounts they are. These keys already have rows, so the rows are REPLACED in every locale. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('BTC_RISK_LEVEL_TITLE','en','BTC Crowding (sentiment + funding)'),
('BTC_RISK_LEVEL_TITLE','ko','BTC 쏠림 (심리 + 펀딩)'),
('BTC_RISK_LEVEL_TITLE','zh','BTC 拥挤度（情绪 + 资金费率）'),
('BTC_RISK_LEVEL_TITLE','ru','Перегрев BTC (настроения + фандинг)'),
('BTC_RISK_LEVEL_TITLE','ar','ازدحام BTC (المعنويات + التمويل)'),
('BTC_RISK_LEVEL_TOOLTIP','en','Blends three inputs into one 0-100 score of how crowded long positions look: the Fear & Greed index, BTC''s daily RSI, and BTC''s funding rate (only positive funding adds to it). It does not use the long/short account ratio. It describes positioning, not a forecast of price.'),
('BTC_RISK_LEVEL_TOOLTIP','ko','세 가지 입력을 0-100 점수 하나로 합쳐 롱 포지션이 얼마나 쏠려 있는지 보여줍니다: 공포·탐욕 지수, BTC 일봉 RSI, BTC 펀딩비(양수 펀딩만 반영). 롱/숏 계정 비율은 사용하지 않습니다. 포지셔닝을 설명할 뿐 가격 예측이 아닙니다.'),
('BTC_RISK_LEVEL_TOOLTIP','zh','将三个输入合成一个 0-100 分数，表示多头仓位的拥挤程度：恐惧与贪婪指数、BTC 日线 RSI 和 BTC 资金费率（仅正资金费率计入）。不使用多空账户比。它描述仓位情况，而非价格预测。'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Объединяет три входа в одну оценку 0-100 того, насколько переполнены лонги: индекс страха и жадности, дневной RSI BTC и фандинг BTC (учитывается только положительный). Соотношение лонг/шорт аккаунтов не используется. Описывает позиционирование, а не прогноз цены.'),
('BTC_RISK_LEVEL_TOOLTIP','ar','يجمع ثلاثة مدخلات في درجة 0-100 توضح مدى ازدحام المراكز الطويلة: مؤشر الخوف والطمع وRSI اليومي لـ BTC ومعدل تمويل BTC (التمويل الموجب فقط يُحتسب). لا يستخدم نسبة حسابات الشراء/البيع. يصف التمركز وليس توقعًا للسعر.'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','en','BTC long / short · Binance, all accounts, 1h'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','ko','BTC 롱 / 숏 · 바이낸스, 전체 계정, 1시간'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','zh','BTC 多 / 空 · 币安，全部账户，1 小时'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','ru','BTC лонг / шорт · Binance, все аккаунты, 1ч'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','ar','BTC شراء / بيع · Binance، كل الحسابات، 1س'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','en','long share {pct}% of accounts'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','ko','롱 비중 {pct}% (계정 기준)'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','zh','多头占比 {pct}%（按账户）'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','ru','доля лонгов {pct}% (аккаунты)'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','ar','حصة الشراء {pct}% من الحسابات'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','en','short share {pct}% of accounts'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','ko','숏 비중 {pct}% (계정 기준)'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','zh','空头占比 {pct}%（按账户）'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','ru','доля шортов {pct}% (аккаунты)'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','ar','حصة البيع {pct}% من الحسابات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('BTC_RISK_LEVEL_TITLE','en','BTC Crowding (sentiment + funding)'),
('BTC_RISK_LEVEL_TITLE','ko','BTC 쏠림 (심리 + 펀딩)'),
('BTC_RISK_LEVEL_TITLE','zh','BTC 拥挤度（情绪 + 资金费率）'),
('BTC_RISK_LEVEL_TITLE','ru','Перегрев BTC (настроения + фандинг)'),
('BTC_RISK_LEVEL_TITLE','ar','ازدحام BTC (المعنويات + التمويل)'),
('BTC_RISK_LEVEL_TOOLTIP','en','Blends three inputs into one 0-100 score of how crowded long positions look: the Fear & Greed index, BTC''s daily RSI, and BTC''s funding rate (only positive funding adds to it). It does not use the long/short account ratio. It describes positioning, not a forecast of price.'),
('BTC_RISK_LEVEL_TOOLTIP','ko','세 가지 입력을 0-100 점수 하나로 합쳐 롱 포지션이 얼마나 쏠려 있는지 보여줍니다: 공포·탐욕 지수, BTC 일봉 RSI, BTC 펀딩비(양수 펀딩만 반영). 롱/숏 계정 비율은 사용하지 않습니다. 포지셔닝을 설명할 뿐 가격 예측이 아닙니다.'),
('BTC_RISK_LEVEL_TOOLTIP','zh','将三个输入合成一个 0-100 分数，表示多头仓位的拥挤程度：恐惧与贪婪指数、BTC 日线 RSI 和 BTC 资金费率（仅正资金费率计入）。不使用多空账户比。它描述仓位情况，而非价格预测。'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Объединяет три входа в одну оценку 0-100 того, насколько переполнены лонги: индекс страха и жадности, дневной RSI BTC и фандинг BTC (учитывается только положительный). Соотношение лонг/шорт аккаунтов не используется. Описывает позиционирование, а не прогноз цены.'),
('BTC_RISK_LEVEL_TOOLTIP','ar','يجمع ثلاثة مدخلات في درجة 0-100 توضح مدى ازدحام المراكز الطويلة: مؤشر الخوف والطمع وRSI اليومي لـ BTC ومعدل تمويل BTC (التمويل الموجب فقط يُحتسب). لا يستخدم نسبة حسابات الشراء/البيع. يصف التمركز وليس توقعًا للسعر.'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','en','BTC long / short · Binance, all accounts, 1h'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','ko','BTC 롱 / 숏 · 바이낸스, 전체 계정, 1시간'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','zh','BTC 多 / 空 · 币安，全部账户，1 小时'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','ru','BTC лонг / шорт · Binance, все аккаунты, 1ч'),
('MARKET_CONDITIONS_WIDGET_LONG_SHORT_LABEL','ar','BTC شراء / بيع · Binance، كل الحسابات، 1س'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','en','long share {pct}% of accounts'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','ko','롱 비중 {pct}% (계정 기준)'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','zh','多头占比 {pct}%（按账户）'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','ru','доля лонгов {pct}% (аккаунты)'),
('DASH_EDGE_SETUP_DETAIL_LONG_SHARE','ar','حصة الشراء {pct}% من الحسابات'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','en','short share {pct}% of accounts'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','ko','숏 비중 {pct}% (계정 기준)'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','zh','空头占比 {pct}%（按账户）'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','ru','доля шортов {pct}% (аккаунты)'),
('DASH_EDGE_SETUP_DETAIL_SHORT_SHARE','ar','حصة البيع {pct}% من الحسابات')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
