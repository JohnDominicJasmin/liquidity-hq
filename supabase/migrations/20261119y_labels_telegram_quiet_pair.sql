-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Quiet hours on /alerts (QA review of #2567): the field error shown when only one of From / To is set (the settings API refuses one alone). One key x 5 locales; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed.
-- Separate from 20261119p so that file keeps its 13 pinned keys.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_QUIET_BOTH','en','Set both times, or both to Off.'),
('ALERTS_QUIET_BOTH','ko','두 시간을 모두 설정하거나 모두 끔으로 두세요.'),
('ALERTS_QUIET_BOTH','zh','请同时设置两个时间，或都设为关闭。'),
('ALERTS_QUIET_BOTH','ru','Укажите оба времени или выключите оба.'),
('ALERTS_QUIET_BOTH','ar','حدد الوقتين معاً أو أوقف كليهما.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_QUIET_BOTH','en','Set both times, or both to Off.'),
('ALERTS_QUIET_BOTH','ko','두 시간을 모두 설정하거나 모두 끔으로 두세요.'),
('ALERTS_QUIET_BOTH','zh','请同时设置两个时间，或都设为关闭。'),
('ALERTS_QUIET_BOTH','ru','Укажите оба времени или выключите оба.'),
('ALERTS_QUIET_BOTH','ar','حدد الوقتين معاً أو أوقف كليهما.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
