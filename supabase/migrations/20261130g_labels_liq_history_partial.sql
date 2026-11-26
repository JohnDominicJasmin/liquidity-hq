-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- Liquidation clusters say their history is incomplete (#1651).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('LIQ_HISTORY_PARTIAL','ar','سجل 24 ساعة غير مكتمل'),
('LIQ_HISTORY_PARTIAL','en','24 h history incomplete'),
('LIQ_HISTORY_PARTIAL','ko','24시간 기록이 불완전합니다'),
('LIQ_HISTORY_PARTIAL','ru','История за 24 ч неполная'),
('LIQ_HISTORY_PARTIAL','zh','24 小时记录不完整')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('LIQ_HISTORY_PARTIAL','ar','سجل 24 ساعة غير مكتمل'),
('LIQ_HISTORY_PARTIAL','en','24 h history incomplete'),
('LIQ_HISTORY_PARTIAL','ko','24시간 기록이 불완전합니다'),
('LIQ_HISTORY_PARTIAL','ru','История за 24 ч неполная'),
('LIQ_HISTORY_PARTIAL','zh','24 小时记录不完整')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
