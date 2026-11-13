-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- One new key (#1651): ALERT_OUTCOMES_SUBTITLE_SINCE - the Alert Track Record subtitle now names the date of the oldest fire it read ({date} must survive translation unchanged). English ships in lib/labelDefaults.en.json and needs no row.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling (see 20261113b); Arabic is not offered in any picker, so its row is harmless. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ALERT_OUTCOMES_SUBTITLE_SINCE','ko','24시간 결과 · 실패 포함 · {date}부터'),
('ALERT_OUTCOMES_SUBTITLE_SINCE','zh','24小时结果 · 含未命中 · 自 {date} 起'),
('ALERT_OUTCOMES_SUBTITLE_SINCE','ru','Итог за 24 ч · с неудачными · с {date}'),
('ALERT_OUTCOMES_SUBTITLE_SINCE','ar','نتيجة 24 ساعة · تشمل الإخفاقات · منذ {date}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ALERT_OUTCOMES_SUBTITLE_SINCE','ko','24시간 결과 · 실패 포함 · {date}부터'),
('ALERT_OUTCOMES_SUBTITLE_SINCE','zh','24小时结果 · 含未命中 · 自 {date} 起'),
('ALERT_OUTCOMES_SUBTITLE_SINCE','ru','Итог за 24 ч · с неудачными · с {date}'),
('ALERT_OUTCOMES_SUBTITLE_SINCE','ar','نتيجة 24 ساعة · تشمل الإخفاقات · منذ {date}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
