-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps AFTER the release deploy (the app reads this table through the server from that build on; applying it first leaves the panel with no data); the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Tighten read access on one history table: the browser no longer reads it directly, so its public read policy is removed. The server keeps reading it with the service key.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
drop policy if exists "Public read access" on lhq_alert_fires;

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
drop policy if exists "Public read access" on lhq_dev_alert_fires;
