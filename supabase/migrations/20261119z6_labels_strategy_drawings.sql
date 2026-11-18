-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Strategies draw what they watch (owner, 2026-11-19). 4 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   STRAT_OV_SR_LEVEL      new: the label on each support / resistance level an S/R flip is watching.
--   STRAT_OV_BAND_TOP / STRAT_OV_BAND_BOTTOM  new: the Bollinger band lines a squeeze strategy draws while it waits.
--   STRAT_NO_SETUP         new: the short chip on the chart when a strategy has nothing to draw.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_OV_SR_LEVEL','en','S/R level'),
('STRAT_OV_SR_LEVEL','ko','지지/저항 수준'),
('STRAT_OV_SR_LEVEL','zh','支撑/阻力位'),
('STRAT_OV_SR_LEVEL','ru','Уровень S/R'),
('STRAT_OV_SR_LEVEL','ar','مستوى دعم/مقاومة'),
('STRAT_OV_BAND_TOP','en','Band top'),
('STRAT_OV_BAND_TOP','ko','밴드 상단'),
('STRAT_OV_BAND_TOP','zh','通道上轨'),
('STRAT_OV_BAND_TOP','ru','Верх полосы'),
('STRAT_OV_BAND_TOP','ar','أعلى النطاق'),
('STRAT_OV_BAND_BOTTOM','en','Band bottom'),
('STRAT_OV_BAND_BOTTOM','ko','밴드 하단'),
('STRAT_OV_BAND_BOTTOM','zh','通道下轨'),
('STRAT_OV_BAND_BOTTOM','ru','Низ полосы'),
('STRAT_OV_BAND_BOTTOM','ar','أسفل النطاق'),
('STRAT_NO_SETUP','en','No setup right now'),
('STRAT_NO_SETUP','ko','지금은 셋업 없음'),
('STRAT_NO_SETUP','zh','当前没有信号设置'),
('STRAT_NO_SETUP','ru','Сейчас нет сетапа'),
('STRAT_NO_SETUP','ar','لا يوجد إعداد الآن')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_OV_SR_LEVEL','en','S/R level'),
('STRAT_OV_SR_LEVEL','ko','지지/저항 수준'),
('STRAT_OV_SR_LEVEL','zh','支撑/阻力位'),
('STRAT_OV_SR_LEVEL','ru','Уровень S/R'),
('STRAT_OV_SR_LEVEL','ar','مستوى دعم/مقاومة'),
('STRAT_OV_BAND_TOP','en','Band top'),
('STRAT_OV_BAND_TOP','ko','밴드 상단'),
('STRAT_OV_BAND_TOP','zh','通道上轨'),
('STRAT_OV_BAND_TOP','ru','Верх полосы'),
('STRAT_OV_BAND_TOP','ar','أعلى النطاق'),
('STRAT_OV_BAND_BOTTOM','en','Band bottom'),
('STRAT_OV_BAND_BOTTOM','ko','밴드 하단'),
('STRAT_OV_BAND_BOTTOM','zh','通道下轨'),
('STRAT_OV_BAND_BOTTOM','ru','Низ полосы'),
('STRAT_OV_BAND_BOTTOM','ar','أسفل النطاق'),
('STRAT_NO_SETUP','en','No setup right now'),
('STRAT_NO_SETUP','ko','지금은 셋업 없음'),
('STRAT_NO_SETUP','zh','当前没有信号设置'),
('STRAT_NO_SETUP','ru','Сейчас нет сетапа'),
('STRAT_NO_SETUP','ar','لا يوجد إعداد الآن')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
