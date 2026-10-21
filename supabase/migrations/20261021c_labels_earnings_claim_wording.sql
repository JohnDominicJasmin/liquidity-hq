-- #1569 (owner order 2026-10-10, re-scoped 2026-10-21 to what is STILL VISIBLE): earnings-claim wording that payment reviewers (Whop, MoonPay Commerce) flag.
--
-- WHAT IS HERE (nine keys, five locales, all in use on a default build; the last four are PM's wording decisions of 2026-10-21, on #1569):
--   CALC_SIZER_RESULT_POTENTIAL_PROFIT  "Potential Profit" -> "Example Outcome"        (Position Sizer: the result of the user's OWN inputs)
--   CALC_PNL_BANNER_PROFIT              "PROFIT" -> "GAIN (example)"                  (P&L calculator banner)
--   CALC_PNL_BANNER_LOSS                "LOSS"   -> "LOSS (example)"                  (the same banner's other side, so the pair stays matched; Dev's addition)
--   JOURNAL_HINT_BODY                   "...your edge..." -> "...your patterns..."     (Trade Journal hint)
--   CALC_SIZER_RR_TIP, CALC_RR_RATIO_TIP  R:R tip: "how many dollars you stand to make ... profitable long-term" -> "compares the possible gain with the amount you risk ..." (PM text)
--   SESSION_COUNTDOWN_NO_WINDOW         "No high-probability window active" -> "No active trading window"
--   CHART_SETUP_PRIME_LONG_TIP / _SHORT_TIP  NEW keys: the setup-chip tooltips were hard-coded English in KLineProChart.tsx; "High-probability long/short zone" -> "Possible long/short zone"
-- WHAT IS NOT HERE and why: the Win Rate / Profit Factor / Signal Accuracy / Recent record panels are hidden on a default build (NEXT_PUBLIC_SHOW_PERFORMANCE_STATS off,
-- #1574) and /backtest and /live-tracking redirect to /dashboard (#264), so renaming or captioning them is only needed if the owner turns that flag on. The Risk/Reward
-- calculator's Win Rate input and the Trade Journal's statistics are the user's own numbers.
--
-- These rows OVERWRITE whatever is live for these keys in every locale (the label table, not this repo, is the record, and some live rows were never in a migration),
-- so that is the intent: the new wording replaces the old. ar/ko/ru/zh are Dev machine translations, NOT native-reviewed.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','en','Example Outcome'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ar','نتيجة توضيحية'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ko','예시 결과'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ru','Пример результата'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','zh','示例结果'),
('CALC_PNL_BANNER_PROFIT','en','▲ GAIN (example) - {pct}'),
('CALC_PNL_BANNER_PROFIT','ar','▲ مكسب (مثال) - {pct}'),
('CALC_PNL_BANNER_PROFIT','ko','▲ 증가 (예시) - {pct}'),
('CALC_PNL_BANNER_PROFIT','ru','▲ ПРИРОСТ (пример) - {pct}'),
('CALC_PNL_BANNER_PROFIT','zh','▲ 增幅（示例）- {pct}'),
('CALC_PNL_BANNER_LOSS','en','▼ LOSS (example) - {pct}'),
('CALC_PNL_BANNER_LOSS','ar','▼ خسارة (مثال) - {pct}'),
('CALC_PNL_BANNER_LOSS','ko','▼ 손실 (예시) - {pct}'),
('CALC_PNL_BANNER_LOSS','ru','▼ УБЫТОК (пример) - {pct}'),
('CALC_PNL_BANNER_LOSS','zh','▼ 亏损（示例）- {pct}'),
('JOURNAL_HINT_BODY','en','Log every trade you take, then review your win rate, streak, and patterns over time. The more you log, the clearer your patterns become.'),
('JOURNAL_HINT_BODY','ar','سجّل كل صفقة تنفذها، ثم راجع معدل ربحك وسلسلة نتائجك وأنماطك بمرور الوقت. كلما زاد تسجيلك، ازدادت أنماطك وضوحاً.'),
('JOURNAL_HINT_BODY','ko','거래할 때마다 기록하고, 시간이 지나면서 승률, 연승, 패턴을 확인하세요. 기록이 쌓일수록 패턴이 더 명확해집니다.'),
('JOURNAL_HINT_BODY','ru','Записывайте каждую сделку, затем со временем анализируйте свой процент побед, серию и паттерны. Чем больше вы записываете, тем яснее проявляются ваши паттерны.'),
('JOURNAL_HINT_BODY','zh','记录你做的每一笔交易，随时间回顾胜率、连续走势和交易模式。记录得越多，你的交易模式就越清晰。'),
('CALC_SIZER_RR_TIP','en','Risk:Reward compares the possible gain with the amount you risk. 2R means a win is twice the size of the loss. Below 1.5R, a strategy has to win more often just to cover its losses.'),
('CALC_SIZER_RR_TIP','ar','المخاطرة:العائد تقارن الربح المحتمل بالمبلغ الذي تخاطر به. 2R تعني أن الصفقة الرابحة بحجم ضعف الخسارة. وتحت 1.5R تحتاج الاستراتيجية إلى الفوز بشكل أكثر تكراراً فقط لتغطية خسائرها.'),
('CALC_SIZER_RR_TIP','ko','리스크:리워드는 가능한 수익을 감수하는 금액과 비교합니다. 2R은 이긴 거래가 손실의 두 배 크기라는 뜻입니다. 1.5R 미만에서는 손실을 메우는 것만으로도 더 자주 이겨야 합니다.'),
('CALC_SIZER_RR_TIP','ru','Риск:прибыль сравнивает возможную прибыль с суммой, которую вы рискуете. 2R означает, что выигрыш вдвое больше убытка. Ниже 1.5R стратегии нужно чаще выигрывать, чтобы просто покрыть свои убытки.'),
('CALC_SIZER_RR_TIP','zh','风险回报比将可能的收益与你承担的风险金额进行比较。2R 表示盈利是亏损的两倍。低于 1.5R 时，策略需要更高的胜率才能弥补亏损。'),
('SESSION_COUNTDOWN_NO_WINDOW','en','No active trading window'),
('SESSION_COUNTDOWN_NO_WINDOW','ar','لا توجد نافذة تداول نشطة'),
('SESSION_COUNTDOWN_NO_WINDOW','ko','활성화된 거래 시간대 없음'),
('SESSION_COUNTDOWN_NO_WINDOW','ru','Нет активного торгового окна'),
('SESSION_COUNTDOWN_NO_WINDOW','zh','当前无活跃交易时段'),
('CHART_SETUP_PRIME_LONG_TIP','en','Squeeze + support confluence (separate from the chart''s own Buy/Sell signal). Price is sitting on a tested support level while shorts are being squeezed out. Possible long zone - watch for a confirmation candle before entering.'),
('CHART_SETUP_PRIME_LONG_TIP','ar','تقاطع الضغط + الدعم (منفصل عن إشارة الشراء/البيع الخاصة بالرسم). السعر يقف عند مستوى دعم مُختبر بينما يُجبر البائعون على المكشوف على الإغلاق. منطقة شراء محتملة - انتظر شمعة تأكيد قبل الدخول.'),
('CHART_SETUP_PRIME_LONG_TIP','ko','압축 + 지지선 합류(차트 자체의 매수/매도 신호와는 별개). 가격이 검증된 지지 수준에 있고 숏 포지션이 청산되고 있습니다. 롱 가능 구간 - 진입 전에 확인 캔들을 기다리세요.'),
('CHART_SETUP_PRIME_LONG_TIP','ru','Сжатие + совпадение с поддержкой (отдельно от собственного сигнала Buy/Sell на графике). Цена находится на проверенном уровне поддержки, пока шорты вытесняются. Возможная зона лонга - дождитесь подтверждающей свечи перед входом.'),
('CHART_SETUP_PRIME_LONG_TIP','zh','挤压 + 支撑汇合（与图表自身的买/卖信号无关）。价格位于经过检验的支撑位，同时空头正被挤出。可能的做多区域 - 入场前请等待确认K线。'),
('CHART_SETUP_PRIME_SHORT_TIP','en','Squeeze + resistance confluence (separate from the chart''s own Buy/Sell signal). Price is pressing against tested resistance while longs are getting flushed. Possible short zone - watch for a rejection candle before entering.'),
('CHART_SETUP_PRIME_SHORT_TIP','ar','تقاطع الضغط + المقاومة (منفصل عن إشارة الشراء/البيع الخاصة بالرسم). السعر يضغط على مقاومة مُختبرة بينما تُصفّى مراكز الشراء. منطقة بيع محتملة - انتظر شمعة رفض قبل الدخول.'),
('CHART_SETUP_PRIME_SHORT_TIP','ko','압축 + 저항선 합류(차트 자체의 매수/매도 신호와는 별개). 가격이 검증된 저항선을 누르고 있고 롱 포지션이 청산되고 있습니다. 숏 가능 구간 - 진입 전에 거부 캔들을 기다리세요.'),
('CHART_SETUP_PRIME_SHORT_TIP','ru','Сжатие + совпадение с сопротивлением (отдельно от собственного сигнала Buy/Sell на графике). Цена давит на проверенное сопротивление, пока лонги вымываются. Возможная зона шорта - дождитесь свечи отказа перед входом.'),
('CHART_SETUP_PRIME_SHORT_TIP','zh','挤压 + 阻力汇合（与图表自身的买/卖信号无关）。价格正在冲击经过检验的阻力位，同时多头正被清洗。可能的做空区域 - 入场前请等待拒绝K线。'),
('CALC_RR_RATIO_TIP','en','Risk:Reward compares the possible gain with the amount you risk. 2R means a win is twice the size of the loss. Below 1.5R, a strategy has to win more often just to cover its losses.'),
('CALC_RR_RATIO_TIP','ar','المخاطرة:العائد تقارن الربح المحتمل بالمبلغ الذي تخاطر به. 2R تعني أن الصفقة الرابحة بحجم ضعف الخسارة. وتحت 1.5R تحتاج الاستراتيجية إلى الفوز بشكل أكثر تكراراً فقط لتغطية خسائرها.'),
('CALC_RR_RATIO_TIP','ko','리스크:리워드는 가능한 수익을 감수하는 금액과 비교합니다. 2R은 이긴 거래가 손실의 두 배 크기라는 뜻입니다. 1.5R 미만에서는 손실을 메우는 것만으로도 더 자주 이겨야 합니다.'),
('CALC_RR_RATIO_TIP','ru','Риск:прибыль сравнивает возможную прибыль с суммой, которую вы рискуете. 2R означает, что выигрыш вдвое больше убытка. Ниже 1.5R стратегии нужно чаще выигрывать, чтобы просто покрыть свои убытки.'),
('CALC_RR_RATIO_TIP','zh','风险回报比将可能的收益与你承担的风险金额进行比较。2R 表示盈利是亏损的两倍。低于 1.5R 时，策略需要更高的胜率才能弥补亏损。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','en','Example Outcome'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ar','نتيجة توضيحية'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ko','예시 결과'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ru','Пример результата'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','zh','示例结果'),
-- ('CALC_PNL_BANNER_PROFIT','en','▲ GAIN (example) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','ar','▲ مكسب (مثال) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','ko','▲ 증가 (예시) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','ru','▲ ПРИРОСТ (пример) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','zh','▲ 增幅（示例）- {pct}'),
-- ('CALC_PNL_BANNER_LOSS','en','▼ LOSS (example) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','ar','▼ خسارة (مثال) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','ko','▼ 손실 (예시) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','ru','▼ УБЫТОК (пример) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','zh','▼ 亏损（示例）- {pct}'),
-- ('JOURNAL_HINT_BODY','en','Log every trade you take, then review your win rate, streak, and patterns over time. The more you log, the clearer your patterns become.'),
-- ('JOURNAL_HINT_BODY','ar','سجّل كل صفقة تنفذها، ثم راجع معدل ربحك وسلسلة نتائجك وأنماطك بمرور الوقت. كلما زاد تسجيلك، ازدادت أنماطك وضوحاً.'),
-- ('JOURNAL_HINT_BODY','ko','거래할 때마다 기록하고, 시간이 지나면서 승률, 연승, 패턴을 확인하세요. 기록이 쌓일수록 패턴이 더 명확해집니다.'),
-- ('JOURNAL_HINT_BODY','ru','Записывайте каждую сделку, затем со временем анализируйте свой процент побед, серию и паттерны. Чем больше вы записываете, тем яснее проявляются ваши паттерны.'),
-- ('JOURNAL_HINT_BODY','zh','记录你做的每一笔交易，随时间回顾胜率、连续走势和交易模式。记录得越多，你的交易模式就越清晰。'),
-- ('CALC_SIZER_RR_TIP','en','Risk:Reward compares the possible gain with the amount you risk. 2R means a win is twice the size of the loss. Below 1.5R, a strategy has to win more often just to cover its losses.'),
-- ('CALC_SIZER_RR_TIP','ar','المخاطرة:العائد تقارن الربح المحتمل بالمبلغ الذي تخاطر به. 2R تعني أن الصفقة الرابحة بحجم ضعف الخسارة. وتحت 1.5R تحتاج الاستراتيجية إلى الفوز بشكل أكثر تكراراً فقط لتغطية خسائرها.'),
-- ('CALC_SIZER_RR_TIP','ko','리스크:리워드는 가능한 수익을 감수하는 금액과 비교합니다. 2R은 이긴 거래가 손실의 두 배 크기라는 뜻입니다. 1.5R 미만에서는 손실을 메우는 것만으로도 더 자주 이겨야 합니다.'),
-- ('CALC_SIZER_RR_TIP','ru','Риск:прибыль сравнивает возможную прибыль с суммой, которую вы рискуете. 2R означает, что выигрыш вдвое больше убытка. Ниже 1.5R стратегии нужно чаще выигрывать, чтобы просто покрыть свои убытки.'),
-- ('CALC_SIZER_RR_TIP','zh','风险回报比将可能的收益与你承担的风险金额进行比较。2R 表示盈利是亏损的两倍。低于 1.5R 时，策略需要更高的胜率才能弥补亏损。'),
-- ('SESSION_COUNTDOWN_NO_WINDOW','en','No active trading window'),
-- ('SESSION_COUNTDOWN_NO_WINDOW','ar','لا توجد نافذة تداول نشطة'),
-- ('SESSION_COUNTDOWN_NO_WINDOW','ko','활성화된 거래 시간대 없음'),
-- ('SESSION_COUNTDOWN_NO_WINDOW','ru','Нет активного торгового окна'),
-- ('SESSION_COUNTDOWN_NO_WINDOW','zh','当前无活跃交易时段'),
-- ('CHART_SETUP_PRIME_LONG_TIP','en','Squeeze + support confluence (separate from the chart''s own Buy/Sell signal). Price is sitting on a tested support level while shorts are being squeezed out. Possible long zone - watch for a confirmation candle before entering.'),
-- ('CHART_SETUP_PRIME_LONG_TIP','ar','تقاطع الضغط + الدعم (منفصل عن إشارة الشراء/البيع الخاصة بالرسم). السعر يقف عند مستوى دعم مُختبر بينما يُجبر البائعون على المكشوف على الإغلاق. منطقة شراء محتملة - انتظر شمعة تأكيد قبل الدخول.'),
-- ('CHART_SETUP_PRIME_LONG_TIP','ko','압축 + 지지선 합류(차트 자체의 매수/매도 신호와는 별개). 가격이 검증된 지지 수준에 있고 숏 포지션이 청산되고 있습니다. 롱 가능 구간 - 진입 전에 확인 캔들을 기다리세요.'),
-- ('CHART_SETUP_PRIME_LONG_TIP','ru','Сжатие + совпадение с поддержкой (отдельно от собственного сигнала Buy/Sell на графике). Цена находится на проверенном уровне поддержки, пока шорты вытесняются. Возможная зона лонга - дождитесь подтверждающей свечи перед входом.'),
-- ('CHART_SETUP_PRIME_LONG_TIP','zh','挤压 + 支撑汇合（与图表自身的买/卖信号无关）。价格位于经过检验的支撑位，同时空头正被挤出。可能的做多区域 - 入场前请等待确认K线。'),
-- ('CHART_SETUP_PRIME_SHORT_TIP','en','Squeeze + resistance confluence (separate from the chart''s own Buy/Sell signal). Price is pressing against tested resistance while longs are getting flushed. Possible short zone - watch for a rejection candle before entering.'),
-- ('CHART_SETUP_PRIME_SHORT_TIP','ar','تقاطع الضغط + المقاومة (منفصل عن إشارة الشراء/البيع الخاصة بالرسم). السعر يضغط على مقاومة مُختبرة بينما تُصفّى مراكز الشراء. منطقة بيع محتملة - انتظر شمعة رفض قبل الدخول.'),
-- ('CHART_SETUP_PRIME_SHORT_TIP','ko','압축 + 저항선 합류(차트 자체의 매수/매도 신호와는 별개). 가격이 검증된 저항선을 누르고 있고 롱 포지션이 청산되고 있습니다. 숏 가능 구간 - 진입 전에 거부 캔들을 기다리세요.'),
-- ('CHART_SETUP_PRIME_SHORT_TIP','ru','Сжатие + совпадение с сопротивлением (отдельно от собственного сигнала Buy/Sell на графике). Цена давит на проверенное сопротивление, пока лонги вымываются. Возможная зона шорта - дождитесь свечи отказа перед входом.'),
-- ('CHART_SETUP_PRIME_SHORT_TIP','zh','挤压 + 阻力汇合（与图表自身的买/卖信号无关）。价格正在冲击经过检验的阻力位，同时多头正被清洗。可能的做空区域 - 入场前请等待拒绝K线。'),
-- ('CALC_RR_RATIO_TIP','en','Risk:Reward compares the possible gain with the amount you risk. 2R means a win is twice the size of the loss. Below 1.5R, a strategy has to win more often just to cover its losses.'),
-- ('CALC_RR_RATIO_TIP','ar','المخاطرة:العائد تقارن الربح المحتمل بالمبلغ الذي تخاطر به. 2R تعني أن الصفقة الرابحة بحجم ضعف الخسارة. وتحت 1.5R تحتاج الاستراتيجية إلى الفوز بشكل أكثر تكراراً فقط لتغطية خسائرها.'),
-- ('CALC_RR_RATIO_TIP','ko','리스크:리워드는 가능한 수익을 감수하는 금액과 비교합니다. 2R은 이긴 거래가 손실의 두 배 크기라는 뜻입니다. 1.5R 미만에서는 손실을 메우는 것만으로도 더 자주 이겨야 합니다.'),
-- ('CALC_RR_RATIO_TIP','ru','Риск:прибыль сравнивает возможную прибыль с суммой, которую вы рискуете. 2R означает, что выигрыш вдвое больше убытка. Ниже 1.5R стратегии нужно чаще выигрывать, чтобы просто покрыть свои убытки.'),
-- ('CALC_RR_RATIO_TIP','zh','风险回报比将可能的收益与你承担的风险金额进行比较。2R 表示盈利是亏损的两倍。低于 1.5R 时，策略需要更高的胜率才能弥补亏损。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
