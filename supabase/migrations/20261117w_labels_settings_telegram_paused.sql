-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Settings > Telegram status for an account whose Pro lapsed: the chat is still linked but nothing is sent, so it reads "Paused · Pro needed" instead of "Configured". New key; the en row equals the shipped default.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('SETTINGS_TG_PAUSED_PRO','en','Paused · Pro needed'),
('SETTINGS_TG_PAUSED_PRO','ko','일시 중지 · Pro 필요'),
('SETTINGS_TG_PAUSED_PRO','zh','已暂停 · 需要 Pro'),
('SETTINGS_TG_PAUSED_PRO','ru','Приостановлено · нужен Pro'),
('SETTINGS_TG_PAUSED_PRO','ar','متوقف مؤقتًا · يتطلب Pro')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('SETTINGS_TG_PAUSED_PRO','en','Paused · Pro needed'),
('SETTINGS_TG_PAUSED_PRO','ko','일시 중지 · Pro 필요'),
('SETTINGS_TG_PAUSED_PRO','zh','已暂停 · 需要 Pro'),
('SETTINGS_TG_PAUSED_PRO','ru','Приостановлено · нужен Pro'),
('SETTINGS_TG_PAUSED_PRO','ar','متوقف مؤقتًا · يتطلب Pro')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
