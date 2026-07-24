-- Label for the new per-account call-count-by-type breakdown on
-- /ops/users/[id] (app/api/ops/users/[id]/route.ts's new `callsByType`).
-- Same shape as the app-wide version added in
-- 20260805m_labels_ops_calls_by_type.sql, just scoped to one account -
-- answers "which features has THIS user actually used," not just a total
-- call count. Fixes a real undercount bug in passing: the route's
-- USAGE_COLS previously hand-picked only 5 of the 13 real usage columns
-- (missing all 8 one-shot tools), now uses the full ALL_USAGE_COLUMNS set.
-- English-only, matching the wave-13 admin-surface convention.
-- Applied live against both lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx) via execute_sql.

insert into lhq_labels (key, locale, value) values
('OPS_USER_DETAIL_CALLS_BY_TYPE','en','Calls by type (14d)')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- Same row, run against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).
