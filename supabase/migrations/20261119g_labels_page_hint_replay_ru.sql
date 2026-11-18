-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The Arena header help link in Russian ("? Как работает эта страница") ran 1 px past the 390 px viewport (right edge 391; QA, since #2514). Shorter wording; ru only, the English default is unchanged. AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('PAGE_HINT_REPLAY_LABEL','ru','Как это работает')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('PAGE_HINT_REPLAY_LABEL','ru','Как это работает')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
