-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- #2500: the anti-chop filter becomes "EMA ribbon: fewer, stricter signals" (owner 2026-11-17). Replaces the existing rows of ARENA_ANTICHOP_LABEL and ARENA_ANTICHOP_TIP in every locale. ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ARENA_ANTICHOP_TIP','en','Only changes the EMA ribbon signal. Stricter: needs a wider ribbon, a clear close past EMA 50 and a few candles of hold.'),
('ARENA_ANTICHOP_TIP','ko','EMA 리본 신호에만 적용됩니다. 더 엄격함: 더 넓은 리본, EMA 50을 확실히 넘는 종가, 몇 개 캔들의 유지가 필요합니다.'),
('ARENA_ANTICHOP_TIP','zh','仅影响 EMA 均线带信号。更严格：需要更宽的均线带、明确收于 EMA 50 之外，并持续数根 K 线。'),
('ARENA_ANTICHOP_TIP','ru','Меняет только сигнал EMA-ленты. Строже: нужна более широкая лента, чёткое закрытие за EMA 50 и удержание несколько свечей.'),
('ARENA_ANTICHOP_TIP','ar','يغيّر إشارة شريط EMA فقط. أكثر صرامة: يتطلب شريطًا أوسع وإغلاقًا واضحًا خلف EMA 50 وثباتًا لعدة شموع.'),
('ARENA_ANTICHOP_TIP_BACKTEST','en','Our 3-year backtest found it fires less often but did not improve results.'),
('ARENA_ANTICHOP_TIP_BACKTEST','ko','3년 백테스트에서 신호 빈도는 줄었지만 성과는 개선되지 않았습니다.'),
('ARENA_ANTICHOP_TIP_BACKTEST','zh','我们的三年回测显示信号变少，但结果没有改善。'),
('ARENA_ANTICHOP_TIP_BACKTEST','ru','Наш трёхлетний бэктест показал, что сигналов меньше, но результаты не улучшились.'),
('ARENA_ANTICHOP_TIP_BACKTEST','ar','وجد اختبارنا الخلفي لثلاث سنوات أنها تظهر أقل لكن النتائج لم تتحسن.'),
('ARENA_ANTICHOP_LABEL','en','EMA ribbon: fewer, stricter signals'),
('ARENA_ANTICHOP_LABEL','ko','EMA 리본: 더 적고 엄격한 신호'),
('ARENA_ANTICHOP_LABEL','zh','EMA 均线带：更少、更严格的信号'),
('ARENA_ANTICHOP_LABEL','ru','EMA-лента: меньше сигналов, строже'),
('ARENA_ANTICHOP_LABEL','ar','شريط EMA: إشارات أقل وأكثر صرامة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ARENA_ANTICHOP_TIP','en','Only changes the EMA ribbon signal. Stricter: needs a wider ribbon, a clear close past EMA 50 and a few candles of hold.'),
('ARENA_ANTICHOP_TIP','ko','EMA 리본 신호에만 적용됩니다. 더 엄격함: 더 넓은 리본, EMA 50을 확실히 넘는 종가, 몇 개 캔들의 유지가 필요합니다.'),
('ARENA_ANTICHOP_TIP','zh','仅影响 EMA 均线带信号。更严格：需要更宽的均线带、明确收于 EMA 50 之外，并持续数根 K 线。'),
('ARENA_ANTICHOP_TIP','ru','Меняет только сигнал EMA-ленты. Строже: нужна более широкая лента, чёткое закрытие за EMA 50 и удержание несколько свечей.'),
('ARENA_ANTICHOP_TIP','ar','يغيّر إشارة شريط EMA فقط. أكثر صرامة: يتطلب شريطًا أوسع وإغلاقًا واضحًا خلف EMA 50 وثباتًا لعدة شموع.'),
('ARENA_ANTICHOP_TIP_BACKTEST','en','Our 3-year backtest found it fires less often but did not improve results.'),
('ARENA_ANTICHOP_TIP_BACKTEST','ko','3년 백테스트에서 신호 빈도는 줄었지만 성과는 개선되지 않았습니다.'),
('ARENA_ANTICHOP_TIP_BACKTEST','zh','我们的三年回测显示信号变少，但结果没有改善。'),
('ARENA_ANTICHOP_TIP_BACKTEST','ru','Наш трёхлетний бэктест показал, что сигналов меньше, но результаты не улучшились.'),
('ARENA_ANTICHOP_TIP_BACKTEST','ar','وجد اختبارنا الخلفي لثلاث سنوات أنها تظهر أقل لكن النتائج لم تتحسن.'),
('ARENA_ANTICHOP_LABEL','en','EMA ribbon: fewer, stricter signals'),
('ARENA_ANTICHOP_LABEL','ko','EMA 리본: 더 적고 엄격한 신호'),
('ARENA_ANTICHOP_LABEL','zh','EMA 均线带：更少、更严格的信号'),
('ARENA_ANTICHOP_LABEL','ru','EMA-лента: меньше сигналов, строже'),
('ARENA_ANTICHOP_LABEL','ar','شريط EMA: إشارات أقل وأكثر صرامة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
