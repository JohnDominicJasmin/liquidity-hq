-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The Russian trial banner fits two lines at 360 and 390 px (#1185: three lines, 62 px high, run 43995863734). Two Russian rows get shorter; the English defaults are unchanged.
--   TRIAL_BANNER_LABEL      ru 'Пробный период Pro' -> 'Пробный Pro'
--   TRIAL_BANNER_DAYS_LEFT  ru 'осталось {days} дн.' -> 'ещё {days} дн.'   ({days} intact)
-- ru AI-drafted, not native-reviewed.

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('TRIAL_BANNER_LABEL','ru','Пробный Pro'),
('TRIAL_BANNER_DAYS_LEFT','ru','ещё {days} дн.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('TRIAL_BANNER_LABEL','ru','Пробный Pro'),
('TRIAL_BANNER_DAYS_LEFT','ru','ещё {days} дн.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
