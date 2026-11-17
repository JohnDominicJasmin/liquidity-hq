-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The Correlation page's "Least Correlated Pairs" hint said "potential diversification" (advice-shaped). It now states the fact: the pairs nearest zero over the range. The en row is REQUIRED (a stored en row overrides the shipped
-- default); ko/zh REPLACE the stored translations of the old wording; ru/ar are new. ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('CORRELATION_WEAKEST_PAIRS_HINT','en','- nearest zero over this range'),
('CORRELATION_WEAKEST_PAIRS_HINT','ko','- 이 기간에 0에 가장 가까운 쌍'),
('CORRELATION_WEAKEST_PAIRS_HINT','zh','- 该区间内最接近 0 的组合'),
('CORRELATION_WEAKEST_PAIRS_HINT','ru','- ближе всего к нулю за этот период'),
('CORRELATION_WEAKEST_PAIRS_HINT','ar','- الأقرب إلى الصفر خلال هذه الفترة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('CORRELATION_WEAKEST_PAIRS_HINT','en','- nearest zero over this range'),
('CORRELATION_WEAKEST_PAIRS_HINT','ko','- 이 기간에 0에 가장 가까운 쌍'),
('CORRELATION_WEAKEST_PAIRS_HINT','zh','- 该区间内最接近 0 的组合'),
('CORRELATION_WEAKEST_PAIRS_HINT','ru','- ближе всего к нулю за этот период'),
('CORRELATION_WEAKEST_PAIRS_HINT','ar','- الأقرب إلى الصفر خلال هذه الفترة')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
