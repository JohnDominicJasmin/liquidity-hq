-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The macro strip says "{day} close" under a DXY / SPX / gold quote whose own time is old (a weekend or the night), so Friday's close is not shown as if it were now. New key; the en row equals the shipped default; {day} is the viewer's short weekday.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('MACRO_STRIP_CLOSE_STAMP','en','{day} close'),
('MACRO_STRIP_CLOSE_STAMP','ko','{day} 종가'),
('MACRO_STRIP_CLOSE_STAMP','zh','{day}收盘'),
('MACRO_STRIP_CLOSE_STAMP','ru','закрытие {day}'),
('MACRO_STRIP_CLOSE_STAMP','ar','إغلاق {day}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('MACRO_STRIP_CLOSE_STAMP','en','{day} close'),
('MACRO_STRIP_CLOSE_STAMP','ko','{day} 종가'),
('MACRO_STRIP_CLOSE_STAMP','zh','{day}收盘'),
('MACRO_STRIP_CLOSE_STAMP','ru','закрытие {day}'),
('MACRO_STRIP_CLOSE_STAMP','ar','إغلاق {day}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
