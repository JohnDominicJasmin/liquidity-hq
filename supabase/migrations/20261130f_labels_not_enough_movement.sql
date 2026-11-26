-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- The strategy card on a series that did not move (#1651).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','ar','الحركة غير كافية للحكم'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','en','Not enough movement to judge'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','ko','판단하기에 움직임이 부족합니다'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','ru','Слишком мало движения для оценки'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','zh','波动不足，无法判断')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','ar','الحركة غير كافية للحكم'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','en','Not enough movement to judge'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','ko','판단하기에 움직임이 부족합니다'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','ru','Слишком мало движения для оценки'),
('EMA_PHASE_NOT_ENOUGH_MOVEMENT','zh','波动不足，无法判断')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
