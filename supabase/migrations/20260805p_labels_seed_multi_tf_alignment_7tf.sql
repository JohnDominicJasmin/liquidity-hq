-- MULTI_TF_ALIGNMENT_SUBTITLE / MULTI_TF_ALIGNMENT_TOOLTIP - the Multi-Timeframe
-- Alignment card on Arena grew from 3 rows (15m/1h/4h) to 7 (5m/15m/1h/4h/1D/1W/1M).
-- Updates the copy in every locale that already had this key to match, and adds
-- the ru row that was missing (this key was added in an earlier wave than the ru
-- translation pass and never got one).
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('MULTI_TF_ALIGNMENT_SUBTITLE', 'en', '{coin} RSI direction - 5m · 15m · 1h · 4h · 1D · 1W · 1M'),
('MULTI_TF_ALIGNMENT_TOOLTIP', 'en', 'Checks RSI(14) across seven timeframes (5m/15m = short-term momentum, 1h/4h = medium, 1D/1W/1M = long-term trend). When a majority agree, the bias is meaningful. RSI above 57 = bullish zone, below 43 = bearish zone.'),

('MULTI_TF_ALIGNMENT_SUBTITLE', 'ko', '{coin} RSI 방향 - 5m · 15m · 1h · 4h · 1D · 1W · 1M'),
('MULTI_TF_ALIGNMENT_TOOLTIP', 'ko', '일곱 가지 타임프레임에서 RSI(14)를 확인합니다 (5m/15m = 단기 모멘텀, 1h/4h = 중기, 1D/1W/1M = 장기 추세). 과반수가 일치하면 방향성이 의미 있습니다. RSI 57 이상은 강세 구간, 43 이하는 약세 구간입니다.'),

('MULTI_TF_ALIGNMENT_SUBTITLE', 'zh', '{coin} RSI 方向 - 5m · 15m · 1h · 4h · 1D · 1W · 1M'),
('MULTI_TF_ALIGNMENT_TOOLTIP', 'zh', '同时检查七个周期的 RSI(14)(5m/15m 反映短线动能,1h/4h 为中线,1D/1W/1M 为长期趋势)。当多数周期方向一致时,信号才具备参考意义。RSI 高于 57 为看涨区间,低于 43 为看跌区间。'),

('MULTI_TF_ALIGNMENT_SUBTITLE', 'ar', 'اتجاه RSI لعملة {coin} - 5 دقائق · 15 دقيقة · ساعة · 4 ساعات · يوم · أسبوع · شهر'),
('MULTI_TF_ALIGNMENT_TOOLTIP', 'ar', 'يفحص مؤشر RSI(14) عبر سبعة أطر زمنية (5 و15 دقيقة = زخم قصير المدى، ساعة و4 ساعات = متوسط، يوم وأسبوع وشهر = اتجاه طويل المدى). عندما تتفق الأغلبية، يصبح الانحياز ذا دلالة حقيقية. RSI فوق 57 يعني منطقة صعودية، وتحت 43 يعني منطقة هبوطية.'),

('MULTI_TF_ALIGNMENT_SUBTITLE', 'ru', '{coin} направление RSI - 5m · 15m · 1h · 4h · 1D · 1W · 1M'),
('MULTI_TF_ALIGNMENT_TOOLTIP', 'ru', 'Проверяет RSI(14) по семи таймфреймам (5m/15m = краткосрочный импульс, 1h/4h = среднесрочный, 1D/1W/1M = долгосрочный тренд). Когда большинство совпадает, смещение имеет значение. RSI выше 57 = бычья зона, ниже 43 = медвежья зона.')
on conflict (key, locale) do update set value = excluded.value;
