-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Label for the Arena strategy call box's unavailable state (components/StrategyCallBox.tsx): one caption under "Strategy read unavailable right now." English ships in lib/labelDefaults.en.json and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling (see 20261113b). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_UNAVAILABLE_DETAIL','ko','이 코인과 시간대의 가격 데이터를 불러오지 못했습니다. 추측 대신 아무것도 표시하지 않습니다.'),
('STRAT_UNAVAILABLE_DETAIL','zh','此币种和周期的价格数据未能加载。不显示任何内容，也不做猜测。'),
('STRAT_UNAVAILABLE_DETAIL','ru','Ценовые данные для этой монеты и таймфрейма не загрузились. Лучше ничего не показывать, чем гадать.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_UNAVAILABLE_DETAIL','ko','이 코인과 시간대의 가격 데이터를 불러오지 못했습니다. 추측 대신 아무것도 표시하지 않습니다.'),
('STRAT_UNAVAILABLE_DETAIL','zh','此币种和周期的价格数据未能加载。不显示任何内容，也不做猜测。'),
('STRAT_UNAVAILABLE_DETAIL','ru','Ценовые данные для этой монеты и таймфрейма не загрузились. Лучше ничего не показывать, чем гадать.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
