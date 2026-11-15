-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The standing line on /playbook and on the daily Playbook card (owner, 2026-11-15: "Fix worst 5 + label rest"). English ships in lib/labelDefaults.en.json and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Label rows only, no DDL. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('PLAYBOOK_FOLKLORE_NOTE','ko','트레이딩 속설이며, 검증된 결과가 아닙니다.'),
('PLAYBOOK_FOLKLORE_NOTE','zh','交易经验之谈，并非经过检验的结果。'),
('PLAYBOOK_FOLKLORE_NOTE','ru','Торговый фольклор, а не измеренные результаты.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('PLAYBOOK_FOLKLORE_NOTE','ko','트레이딩 속설이며, 검증된 결과가 아닙니다.'),
('PLAYBOOK_FOLKLORE_NOTE','zh','交易经验之谈，并非经过检验的结果。'),
('PLAYBOOK_FOLKLORE_NOTE','ru','Торговый фольклор, а не измеренные результаты.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
