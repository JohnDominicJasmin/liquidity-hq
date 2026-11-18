-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Strategy panel section labels had no row in any locale (ko/zh/ru/ar showed English), and the ru Liq chip name truncated at 390 px (PM visual sign-off, 2026-11-18). ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRATEGY_PANEL_SECTION_SET','en','Strategy set'),
('STRATEGY_PANEL_SECTION_SET','ko','전략 세트'),
('STRATEGY_PANEL_SECTION_SET','zh','策略组合'),
('STRATEGY_PANEL_SECTION_SET','ru','Набор стратегий'),
('STRATEGY_PANEL_SECTION_SET','ar','مجموعة الاستراتيجيات'),
('STRATEGY_PANEL_SECTION_INDICATORS','en','Indicators'),
('STRATEGY_PANEL_SECTION_INDICATORS','ko','지표'),
('STRATEGY_PANEL_SECTION_INDICATORS','zh','指标'),
('STRATEGY_PANEL_SECTION_INDICATORS','ru','Индикаторы'),
('STRATEGY_PANEL_SECTION_INDICATORS','ar','المؤشرات'),
('STRATEGY_PANEL_SECTION_LAYERS','en','Chart layers'),
('STRATEGY_PANEL_SECTION_LAYERS','ko','차트 레이어'),
('STRATEGY_PANEL_SECTION_LAYERS','zh','图表图层'),
('STRATEGY_PANEL_SECTION_LAYERS','ru','Слои графика'),
('STRATEGY_PANEL_SECTION_LAYERS','ar','طبقات الرسم البياني'),
('STRATEGY_PANEL_SECTION_RUN','en','Run the read'),
('STRATEGY_PANEL_SECTION_RUN','ko','분석 실행'),
('STRATEGY_PANEL_SECTION_RUN','zh','运行分析'),
('STRATEGY_PANEL_SECTION_RUN','ru','Запустить анализ'),
('STRATEGY_PANEL_SECTION_RUN','ar','تشغيل التحليل'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ru','Ликвидации')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRATEGY_PANEL_SECTION_SET','en','Strategy set'),
('STRATEGY_PANEL_SECTION_SET','ko','전략 세트'),
('STRATEGY_PANEL_SECTION_SET','zh','策略组合'),
('STRATEGY_PANEL_SECTION_SET','ru','Набор стратегий'),
('STRATEGY_PANEL_SECTION_SET','ar','مجموعة الاستراتيجيات'),
('STRATEGY_PANEL_SECTION_INDICATORS','en','Indicators'),
('STRATEGY_PANEL_SECTION_INDICATORS','ko','지표'),
('STRATEGY_PANEL_SECTION_INDICATORS','zh','指标'),
('STRATEGY_PANEL_SECTION_INDICATORS','ru','Индикаторы'),
('STRATEGY_PANEL_SECTION_INDICATORS','ar','المؤشرات'),
('STRATEGY_PANEL_SECTION_LAYERS','en','Chart layers'),
('STRATEGY_PANEL_SECTION_LAYERS','ko','차트 레이어'),
('STRATEGY_PANEL_SECTION_LAYERS','zh','图表图层'),
('STRATEGY_PANEL_SECTION_LAYERS','ru','Слои графика'),
('STRATEGY_PANEL_SECTION_LAYERS','ar','طبقات الرسم البياني'),
('STRATEGY_PANEL_SECTION_RUN','en','Run the read'),
('STRATEGY_PANEL_SECTION_RUN','ko','분석 실행'),
('STRATEGY_PANEL_SECTION_RUN','zh','运行分析'),
('STRATEGY_PANEL_SECTION_RUN','ru','Запустить анализ'),
('STRATEGY_PANEL_SECTION_RUN','ar','تشغيل التحليل'),
('STRATEGY_PANEL_LAYER_LIQ_SHORT','ru','Ликвидации')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
