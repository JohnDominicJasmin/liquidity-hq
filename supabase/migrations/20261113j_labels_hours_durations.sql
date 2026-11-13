-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- 4 new keys for /hours (#1185, PM): the countdown unit letters (DURATION_UNIT_H/M/S: English h/m/s) and the "{time} away" line (HOURS_COUNTDOWN_AWAY; {time} must survive translation unchanged).
-- The English wording ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru/ar rows are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling (see 20261113b); Arabic is not offered in any picker, so its rows are harmless.
-- Upserts by (key, locale): re-running is safe, and no row for any other key is touched.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('DURATION_UNIT_H','ko','시간'),
('DURATION_UNIT_H','zh','小时'),
('DURATION_UNIT_H','ru','ч'),
('DURATION_UNIT_H','ar','س'),
('DURATION_UNIT_M','ko','분'),
('DURATION_UNIT_M','zh','分'),
('DURATION_UNIT_M','ru','мин'),
('DURATION_UNIT_M','ar','د'),
('DURATION_UNIT_S','ko','초'),
('DURATION_UNIT_S','zh','秒'),
('DURATION_UNIT_S','ru','с'),
('DURATION_UNIT_S','ar','ث'),
('HOURS_COUNTDOWN_AWAY','ko','{time} 후'),
('HOURS_COUNTDOWN_AWAY','zh','{time}后'),
('HOURS_COUNTDOWN_AWAY','ru','через {time}'),
('HOURS_COUNTDOWN_AWAY','ar','بعد {time}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('DURATION_UNIT_H','ko','시간'),
('DURATION_UNIT_H','zh','小时'),
('DURATION_UNIT_H','ru','ч'),
('DURATION_UNIT_H','ar','س'),
('DURATION_UNIT_M','ko','분'),
('DURATION_UNIT_M','zh','分'),
('DURATION_UNIT_M','ru','мин'),
('DURATION_UNIT_M','ar','د'),
('DURATION_UNIT_S','ko','초'),
('DURATION_UNIT_S','zh','秒'),
('DURATION_UNIT_S','ru','с'),
('DURATION_UNIT_S','ar','ث'),
('HOURS_COUNTDOWN_AWAY','ko','{time} 후'),
('HOURS_COUNTDOWN_AWAY','zh','{time}后'),
('HOURS_COUNTDOWN_AWAY','ru','через {time}'),
('HOURS_COUNTDOWN_AWAY','ar','بعد {time}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
