-- ARENA_STOP_HIT_* / ARENA_TARGET_HIT_* - the live invalidation/target-hit
-- banner on the Arena AI Read card. Entry/stop/target used to be a static
-- snapshot from whenever the analysis ran - price could move straight through
-- the stop or reach the target and the card looked identical, still
-- presenting the old trade as live. app/arena/page.tsx now compares the
-- cached result's sl/tp against the live price on every render and shows
-- one of these two banners when the thesis has already resolved.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('ARENA_STOP_HIT_HEADER', 'en', 'Stop hit - thesis invalidated'),
('ARENA_STOP_HIT_HEADER', 'ko', '스탑 도달 - 시나리오 무효화'),
('ARENA_STOP_HIT_HEADER', 'zh', '止损已触及 - 该判断已失效'),
('ARENA_STOP_HIT_HEADER', 'ar', 'تم الوصول لوقف الخسارة - السيناريو لم يعد صالحًا'),
('ARENA_STOP_HIT_HEADER', 'ru', 'Стоп сработал - сценарий больше не действует'),

('ARENA_STOP_HIT_BODY', 'en', 'Price crossed your stop at {price}. This setup no longer applies - re-run the analysis for a fresh read.'),
('ARENA_STOP_HIT_BODY', 'ko', '가격이 스탑 {price}을(를) 통과했습니다. 이 셋업은 더 이상 유효하지 않습니다 - 새로 분석을 실행하세요.'),
('ARENA_STOP_HIT_BODY', 'zh', '价格已跌破/突破止损位 {price}。该交易设置已不再适用 - 请重新运行分析获取最新判断。'),
('ARENA_STOP_HIT_BODY', 'ar', 'تجاوز السعر وقف الخسارة عند {price}. لم يعد هذا الإعداد صالحًا - أعد تشغيل التحليل للحصول على قراءة جديدة.'),
('ARENA_STOP_HIT_BODY', 'ru', 'Цена прошла ваш стоп на уровне {price}. Этот сетап больше не актуален - запустите анализ заново для нового прогноза.'),

('ARENA_TARGET_HIT_HEADER', 'en', 'Target reached'),
('ARENA_TARGET_HIT_HEADER', 'ko', '목표가 도달'),
('ARENA_TARGET_HIT_HEADER', 'zh', '目标价已达成'),
('ARENA_TARGET_HIT_HEADER', 'ar', 'تم بلوغ الهدف'),
('ARENA_TARGET_HIT_HEADER', 'ru', 'Цель достигнута'),

('ARENA_TARGET_HIT_BODY', 'en', 'Price hit your target at {price}. Consider this trade played out - re-run the analysis for what''s next.'),
('ARENA_TARGET_HIT_BODY', 'ko', '가격이 목표가 {price}에 도달했습니다. 이 트레이드는 마무리된 것으로 보세요 - 다음 판단을 위해 분석을 다시 실행하세요.'),
('ARENA_TARGET_HIT_BODY', 'zh', '价格已到达目标位 {price}。可视为该交易已完成 - 重新运行分析以获取下一步判断。'),
('ARENA_TARGET_HIT_BODY', 'ar', 'بلغ السعر هدفك عند {price}. اعتبر هذه الصفقة قد اكتملت - أعد تشغيل التحليل لمعرفة الخطوة التالية.'),
('ARENA_TARGET_HIT_BODY', 'ru', 'Цена достигла вашей цели на уровне {price}. Считайте сделку отыгранной - запустите анализ заново, чтобы узнать, что дальше.')
on conflict (key, locale) do update set value = excluded.value;
