-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- A new key for Arena's Deep read (#1631, PM 2026-11-13): when a Deep read gives price levels but no catalysts, the block reads "No catalysts cited in this read." instead of nothing.
--   ARENA_NO_CATALYSTS_CITED   en: No catalysts cited in this read.
-- The English wording ships in `lib/labelDefaults.en.json` and needs no row. The four non-English rows are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling to ship
-- AI-drafted translations for this release's Arena labels (20261113b, c, d); treat them as drafts until a native reader has been through them.
-- Upserts by (key, locale): re-running is safe, and no row for any other key is touched.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_NO_CATALYSTS_CITED','ko','이번 분석에서는 인용된 촉매가 없습니다.'),
('ARENA_NO_CATALYSTS_CITED','zh','本次分析未引用任何催化事件。'),
('ARENA_NO_CATALYSTS_CITED','ru','В этом анализе катализаторы не указаны.'),
('ARENA_NO_CATALYSTS_CITED','ar','لم تُذكر أي محفزات في هذه القراءة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ARENA_NO_CATALYSTS_CITED','ko','이번 분석에서는 인용된 촉매가 없습니다.'),
('ARENA_NO_CATALYSTS_CITED','zh','本次分析未引用任何催化事件。'),
('ARENA_NO_CATALYSTS_CITED','ru','В этом анализе катализаторы не указаны.'),
('ARENA_NO_CATALYSTS_CITED','ar','لم تُذكر أي محفزات في هذه القراءة.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
