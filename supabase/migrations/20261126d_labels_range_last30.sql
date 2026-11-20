-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Range bounce with no qualifying range draws the high and low of its last 30 candles, labelled as what they are (PM 2026-11-20, owner's order: a selected strategy always shows something on the chart).
-- en equals lib/labelDefaults.en.json; ko/zh/ru/ar are AI-drafted and not native-reviewed. Upserts by (key, locale).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_OV_LAST30_HIGH','en','30-candle high'),
('STRAT_OV_LAST30_HIGH','ko','30캔들 고점'),
('STRAT_OV_LAST30_HIGH','zh','30根K线最高价'),
('STRAT_OV_LAST30_HIGH','ru','Максимум 30 свечей'),
('STRAT_OV_LAST30_HIGH','ar','أعلى سعر في 30 شمعة'),
('STRAT_OV_LAST30_LOW','en','30-candle low'),
('STRAT_OV_LAST30_LOW','ko','30캔들 저점'),
('STRAT_OV_LAST30_LOW','zh','30根K线最低价'),
('STRAT_OV_LAST30_LOW','ru','Минимум 30 свечей'),
('STRAT_OV_LAST30_LOW','ar','أدنى سعر في 30 شمعة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_OV_LAST30_HIGH','en','30-candle high'),
('STRAT_OV_LAST30_HIGH','ko','30캔들 고점'),
('STRAT_OV_LAST30_HIGH','zh','30根K线最高价'),
('STRAT_OV_LAST30_HIGH','ru','Максимум 30 свечей'),
('STRAT_OV_LAST30_HIGH','ar','أعلى سعر في 30 شمعة'),
('STRAT_OV_LAST30_LOW','en','30-candle low'),
('STRAT_OV_LAST30_LOW','ko','30캔들 저점'),
('STRAT_OV_LAST30_LOW','zh','30根K线最低价'),
('STRAT_OV_LAST30_LOW','ru','Минимум 30 свечей'),
('STRAT_OV_LAST30_LOW','ar','أدنى سعر في 30 شمعة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
