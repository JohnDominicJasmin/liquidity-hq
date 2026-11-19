-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The notice shown when the connection drops mid-session (#1185, QA staging run 44074316335). 1 key x 5 locales; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   OFFLINE_NOTICE  new: 'You are offline. Figures may be out of date.'
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('OFFLINE_NOTICE','en','You are offline. Figures may be out of date.'),
('OFFLINE_NOTICE','ko','오프라인 상태입니다. 수치가 최신이 아닐 수 있습니다.'),
('OFFLINE_NOTICE','zh','你已离线，数据可能不是最新的。'),
('OFFLINE_NOTICE','ru','Нет соединения. Данные могут быть устаревшими.'),
('OFFLINE_NOTICE','ar','أنت غير متصل بالإنترنت. قد تكون الأرقام قديمة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('OFFLINE_NOTICE','en','You are offline. Figures may be out of date.'),
('OFFLINE_NOTICE','ko','오프라인 상태입니다. 수치가 최신이 아닐 수 있습니다.'),
('OFFLINE_NOTICE','zh','你已离线，数据可能不是最新的。'),
('OFFLINE_NOTICE','ru','Нет соединения. Данные могут быть устаревшими.'),
('OFFLINE_NOTICE','ar','أنت غير متصل بالإنترنت. قد تكون الأرقام قديمة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
