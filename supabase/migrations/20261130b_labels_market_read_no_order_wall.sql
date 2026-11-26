-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- Apply with the release that removes the Order wall tile from Market Read (#1651): the tip no longer names order walls.
-- The removed keys keep their rows (nothing reads them): MARKET_READ_TXT_ORDER_WALL, MARKET_READ_TXT_TIGHT, MARKET_READ_TXT_NEARBY, MARKET_READ_TXT_FAR, MARKET_READ_TXT_NO_WALLS, MARKET_READ_TXT_WALL_TIGHT, MARKET_READ_TXT_WALL_CLOSE, MARKET_READ_TXT_WALL_AWAY, MARKET_READ_TXT_WALL_FAR, MARKET_READ_TXT_WALL_TOO_FAR.

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('MARKET_READ_TIP','ar','عدد الإشارات المتوافقة لهذه العملة: الجلسة، يوم الأسبوع، Fear & Greed، التمويل (فاندنغ)، الأموال الذكية. 0–100. وصف وليس نصيحة.'),
('MARKET_READ_TIP','en','How many signals agree for this coin: session, weekday, Fear & Greed, funding, smart money. 0–100. A description, not advice.'),
('MARKET_READ_TIP','ko','이 코인에 대해 일치하는 신호 수: 세션, 요일, Fear & Greed, 펀딩, 스마트 머니. 0–100. 설명일 뿐 조언이 아닙니다.'),
('MARKET_READ_TIP','ru','Сколько сигналов совпадает по этой монете: сессия, день недели, Fear & Greed, фандинг, умные деньги. 0–100. Описание, а не совет.'),
('MARKET_READ_TIP','zh','该币种有多少信号一致：时段、星期、Fear & Greed、资金费率、聪明钱。0–100。仅为描述，不是建议。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('MARKET_READ_TIP','ar','عدد الإشارات المتوافقة لهذه العملة: الجلسة، يوم الأسبوع، Fear & Greed، التمويل (فاندنغ)، الأموال الذكية. 0–100. وصف وليس نصيحة.'),
('MARKET_READ_TIP','en','How many signals agree for this coin: session, weekday, Fear & Greed, funding, smart money. 0–100. A description, not advice.'),
('MARKET_READ_TIP','ko','이 코인에 대해 일치하는 신호 수: 세션, 요일, Fear & Greed, 펀딩, 스마트 머니. 0–100. 설명일 뿐 조언이 아닙니다.'),
('MARKET_READ_TIP','ru','Сколько сигналов совпадает по этой монете: сессия, день недели, Fear & Greed, фандинг, умные деньги. 0–100. Описание, а не совет.'),
('MARKET_READ_TIP','zh','该币种有多少信号一致：时段、星期、Fear & Greed、资金费率、聪明钱。0–100。仅为描述，不是建议。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
