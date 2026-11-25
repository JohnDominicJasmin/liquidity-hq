-- Every price alert has an owner (#1632).
--
-- A price alert is one person's. The app has set user_id on every insert since 20260617; the column stayed nullable only for rows older than that. The alert job now sends a
-- row without an owner to nobody (same release), and this makes the database refuse such a row.
--
-- Run ONE block per project: the prod block on prod (qdpwhnvmhqgzijuwopso), the dev block on dev (wdtjhrilakoitfcezxpx). Order against the deploy: either side first is safe
-- (the old code never inserts a row without an owner, and the new code does not depend on the constraint).
--
-- BEFORE: count the rows this removes, and keep a copy if there are any:
--   select count(*) from public.lhq_price_alerts where user_id is null;
--   select * from public.lhq_price_alerts where user_id is null;
-- Dev read 2026-11-25: 99 rows, 0 without an owner. Prod was not read by the author.
--
-- READ BACK (expected: is_nullable = NO):
--   select is_nullable from information_schema.columns where table_schema = 'public' and table_name = '<table>' and column_name = 'user_id';
--
-- Roll back: alter table public.<table> alter column user_id drop not null;   (removed rows come back only from the copy above)

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
delete from public.lhq_price_alerts where user_id is null;
alter table public.lhq_price_alerts alter column user_id set not null;

-- ── dev: wdtjhrilakoitfcezxpx ───────────────────────────────────────────────
delete from public.lhq_dev_price_alerts where user_id is null;
alter table public.lhq_dev_price_alerts alter column user_id set not null;
