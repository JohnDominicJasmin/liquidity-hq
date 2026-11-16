-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- A gated timeframe click while the plan is still being read shows Checking your plan instead of the Upgrade modal. English ships in lib/labelDefaults.en.json and needs no row. ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_PLAN_CHECKING','ko','요금제를 확인하는 중…'),
('ARENA_PLAN_CHECKING','zh','正在确认您的套餐…'),
('ARENA_PLAN_CHECKING','ru','Проверяем ваш тариф…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ARENA_PLAN_CHECKING','ko','요금제를 확인하는 중…'),
('ARENA_PLAN_CHECKING','zh','正在确认您的套餐…'),
('ARENA_PLAN_CHECKING','ru','Проверяем ваш тариф…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
