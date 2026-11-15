-- NOT YET APPLIED TO ANY DATABASE. DDL, and it DELETES DUPLICATE ROWS: PM/DevOps applies it, the prod block only with the owner's OK. Daily backups to the private db-backups bucket have run since 2026-11-14 (restore drill passed); PM takes a fresh backup run immediately before this and reads the count first.
--
-- A unique key on the natural key of a liquidation, so the server collector's upsert-ignore (lib/liqCollector.ts) drops a row a second process wrote too (a restart overlap). The collector works
-- WITHOUT this index (it falls back to a plain insert), so the order of deploy and migration does not matter.
--
-- STEP 1, READ ONLY, run first on each project and look at the number:
--   select count(*) - count(distinct (source, coin, ts, side, usd)) as duplicate_rows from lhq_liq_events;      -- dev: from lhq_dev_liq_events
-- STEP 2 deletes ONLY the extra copies (keeps the lowest id of each identical group). Browsers wrote these duplicates before the collector existed (#1025 measured 97.8% on dev).
-- STEP 3 creates the index.
--
-- ===================== PROD (qdpwhnvmhqgzijuwopso) =====================
begin;
delete from lhq_liq_events a using lhq_liq_events b
  where a.id > b.id and a.source = b.source and a.coin = b.coin and a.ts = b.ts and a.side = b.side and a.usd = b.usd;
create unique index if not exists lhq_liq_events_natural_key on lhq_liq_events (source, coin, ts, side, usd);
commit;

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
begin;
delete from lhq_dev_liq_events a using lhq_dev_liq_events b
  where a.id > b.id and a.source = b.source and a.coin = b.coin and a.ts = b.ts and a.side = b.side and a.usd = b.usd;
create unique index if not exists lhq_dev_liq_events_natural_key on lhq_dev_liq_events (source, coin, ts, side, usd);
commit;
