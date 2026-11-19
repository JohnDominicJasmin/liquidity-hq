-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- A call no user made (the daily dry-powder analysis, written by the scheduled ingest) is logged in the owner's spend ledger: user_id null, source 'system:dry-powder' (PM audit of #2628).
--   - user_id: DROP NOT NULL is a no-op where the column is already nullable (20260923_ai_call_log.sql defines it nullable, no FK) and a fix where an older definition made it required.
--   - source: new nullable text, null for every user call.
-- The per-user dollar cap (lhq_ai_spend_user_since: `where user_id = p_user`) never counts a null-user row; the site-wide sum (lhq_ai_spend_all_since) counts it, as it should.
-- Additive only.

-- ===================== PROD =====================
alter table lhq_ai_call_log alter column user_id drop not null;
alter table lhq_ai_call_log add column if not exists source text;

-- ===================== DEV =====================
alter table lhq_dev_ai_call_log alter column user_id drop not null;
alter table lhq_dev_ai_call_log add column if not exists source text;
