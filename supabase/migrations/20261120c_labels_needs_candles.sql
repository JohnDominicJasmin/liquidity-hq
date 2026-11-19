-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- A strategy that has too few candles says how many it needs (PM 2026-11-19). 1 key x 5 locales; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   STRAT_NA_TOO_FEW  new: 'Needs {need} {tf} candles; {coin} has {have}.'
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_NA_TOO_FEW','en','Needs {need} {tf} candles; {coin} has {have}.'),
('STRAT_NA_TOO_FEW','ko','{tf} 캔들 {need}개가 필요합니다. {coin}은(는) {have}개입니다.'),
('STRAT_NA_TOO_FEW','zh','需要 {need} 根 {tf} K 线；{coin} 目前只有 {have} 根。'),
('STRAT_NA_TOO_FEW','ru','Нужно {need} свечей {tf}; у {coin} их {have}.'),
('STRAT_NA_TOO_FEW','ar','يتطلب {need} شمعة {tf}؛ لدى {coin} {have} فقط.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_NA_TOO_FEW','en','Needs {need} {tf} candles; {coin} has {have}.'),
('STRAT_NA_TOO_FEW','ko','{tf} 캔들 {need}개가 필요합니다. {coin}은(는) {have}개입니다.'),
('STRAT_NA_TOO_FEW','zh','需要 {need} 根 {tf} K 线；{coin} 目前只有 {have} 根。'),
('STRAT_NA_TOO_FEW','ru','Нужно {need} свечей {tf}; у {coin} их {have}.'),
('STRAT_NA_TOO_FEW','ar','يتطلب {need} شمعة {tf}؛ لدى {coin} {have} فقط.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
