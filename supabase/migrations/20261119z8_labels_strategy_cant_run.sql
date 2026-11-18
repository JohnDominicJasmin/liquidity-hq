-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Strategies that cannot run here say so (owner, 2026-11-19). 4 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   STRAT_NA_TF_MAX / STRAT_NA_TF_MIN   new: 'Works on {tf} or lower / higher.' (NY open, VWAP reclaim, session sweep, funding + OI squeeze).
--   STRAT_NA_NO_FUTURES / STRAT_NA_NO_TRADES   new: the strategy needs a coin's futures funding + open interest / futures trade data.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_NA_TF_MAX','en','Works on {tf} or lower.'),
('STRAT_NA_TF_MAX','ko','{tf} 이하에서 작동합니다.'),
('STRAT_NA_TF_MAX','zh','适用于 {tf} 及以下周期。'),
('STRAT_NA_TF_MAX','ru','Работает на {tf} и ниже.'),
('STRAT_NA_TF_MAX','ar','تعمل على {tf} أو أقل.'),
('STRAT_NA_TF_MIN','en','Works on {tf} or higher.'),
('STRAT_NA_TF_MIN','ko','{tf} 이상에서 작동합니다.'),
('STRAT_NA_TF_MIN','zh','适用于 {tf} 及以上周期。'),
('STRAT_NA_TF_MIN','ru','Работает на {tf} и выше.'),
('STRAT_NA_TF_MIN','ar','تعمل على {tf} أو أعلى.'),
('STRAT_NA_NO_FUTURES','en','Needs futures funding and open interest, not available for {coin}.'),
('STRAT_NA_NO_FUTURES','ko','선물 펀딩과 미결제약정이 필요하며 {coin}에는 제공되지 않습니다.'),
('STRAT_NA_NO_FUTURES','zh','需要期货资金费率和持仓量，{coin} 暂无此数据。'),
('STRAT_NA_NO_FUTURES','ru','Нужны фьючерсные фандинг и открытый интерес, для {coin} недоступны.'),
('STRAT_NA_NO_FUTURES','ar','يتطلب تمويل العقود الآجلة والفائدة المفتوحة، وهما غير متاحين لـ {coin}.'),
('STRAT_NA_NO_TRADES','en','Needs futures trade data, not available for {coin}.'),
('STRAT_NA_NO_TRADES','ko','선물 체결 데이터가 필요하며 {coin}에는 제공되지 않습니다.'),
('STRAT_NA_NO_TRADES','zh','需要期货成交数据，{coin} 暂无此数据。'),
('STRAT_NA_NO_TRADES','ru','Нужны данные о сделках на фьючерсах, для {coin} недоступны.'),
('STRAT_NA_NO_TRADES','ar','يتطلب بيانات صفقات العقود الآجلة، وهي غير متاحة لـ {coin}.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_NA_TF_MAX','en','Works on {tf} or lower.'),
('STRAT_NA_TF_MAX','ko','{tf} 이하에서 작동합니다.'),
('STRAT_NA_TF_MAX','zh','适用于 {tf} 及以下周期。'),
('STRAT_NA_TF_MAX','ru','Работает на {tf} и ниже.'),
('STRAT_NA_TF_MAX','ar','تعمل على {tf} أو أقل.'),
('STRAT_NA_TF_MIN','en','Works on {tf} or higher.'),
('STRAT_NA_TF_MIN','ko','{tf} 이상에서 작동합니다.'),
('STRAT_NA_TF_MIN','zh','适用于 {tf} 及以上周期。'),
('STRAT_NA_TF_MIN','ru','Работает на {tf} и выше.'),
('STRAT_NA_TF_MIN','ar','تعمل على {tf} أو أعلى.'),
('STRAT_NA_NO_FUTURES','en','Needs futures funding and open interest, not available for {coin}.'),
('STRAT_NA_NO_FUTURES','ko','선물 펀딩과 미결제약정이 필요하며 {coin}에는 제공되지 않습니다.'),
('STRAT_NA_NO_FUTURES','zh','需要期货资金费率和持仓量，{coin} 暂无此数据。'),
('STRAT_NA_NO_FUTURES','ru','Нужны фьючерсные фандинг и открытый интерес, для {coin} недоступны.'),
('STRAT_NA_NO_FUTURES','ar','يتطلب تمويل العقود الآجلة والفائدة المفتوحة، وهما غير متاحين لـ {coin}.'),
('STRAT_NA_NO_TRADES','en','Needs futures trade data, not available for {coin}.'),
('STRAT_NA_NO_TRADES','ko','선물 체결 데이터가 필요하며 {coin}에는 제공되지 않습니다.'),
('STRAT_NA_NO_TRADES','zh','需要期货成交数据，{coin} 暂无此数据。'),
('STRAT_NA_NO_TRADES','ru','Нужны данные о сделках на фьючерсах, для {coin} недоступны.'),
('STRAT_NA_NO_TRADES','ar','يتطلب بيانات صفقات العقود الآجلة، وهي غير متاحة لـ {coin}.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
