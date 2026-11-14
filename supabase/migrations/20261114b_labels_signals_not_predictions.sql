-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- One new key (#1651, owner option A, 2026-11-14): ALERTS_SIGNALS_NOT_PREDICTIONS, the plain line on the alerts page that says alerts are signals, not predictions. English ships in lib/labelDefaults.en.json and needs no row. The "about half" is the production measurement (#1651 comment 6873369526).
-- ko/zh/ru/ar are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling (see 20261113b); Arabic is not offered in any picker, so its row is harmless. Upserts by (key, locale). The Telegram footer is English-only (not a label).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_SIGNALS_NOT_PREDICTIONS','ko','신호일 뿐 예측이 아닙니다. 지난 알림은 24시간 뒤 알림 방향으로 움직인 경우가 약 절반이었습니다.'),
('ALERTS_SIGNALS_NOT_PREDICTIONS','zh','信号不是预测。过去的提醒在24小时后朝提醒方向运行的情况约占一半。'),
('ALERTS_SIGNALS_NOT_PREDICTIONS','ru','Сигналы, а не прогнозы. Прошлые оповещения через 24 часа двигались в сторону оповещения примерно в половине случаев.'),
('ALERTS_SIGNALS_NOT_PREDICTIONS','ar','إشارات وليست تنبؤات. تحركت التنبيهات السابقة في اتجاه التنبيه بعد 24 ساعة في نحو نصف الحالات.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_SIGNALS_NOT_PREDICTIONS','ko','신호일 뿐 예측이 아닙니다. 지난 알림은 24시간 뒤 알림 방향으로 움직인 경우가 약 절반이었습니다.'),
('ALERTS_SIGNALS_NOT_PREDICTIONS','zh','信号不是预测。过去的提醒在24小时后朝提醒方向运行的情况约占一半。'),
('ALERTS_SIGNALS_NOT_PREDICTIONS','ru','Сигналы, а не прогнозы. Прошлые оповещения через 24 часа двигались в сторону оповещения примерно в половине случаев.'),
('ALERTS_SIGNALS_NOT_PREDICTIONS','ar','إشارات وليست تنبؤات. تحركت التنبيهات السابقة في اتجاه التنبيه بعد 24 ساعة في نحو نصف الحالات.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
