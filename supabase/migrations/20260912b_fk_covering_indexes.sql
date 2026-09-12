-- Five foreign keys with no covering index, flagged by Supabase's advisor
-- sweep on both projects (#1157). A foreign key does NOT get an index for
-- free in Postgres - only the referenced (parent) side is indexed
-- automatically via its primary key. Without one on the referencing side,
-- every delete/update on the PARENT row (auth.users, lhq_hypotheses) forces
-- a full scan of the CHILD table to check for rows that would be orphaned,
-- and any query filtering by the FK column does the same. #1157 names these
-- specifically because they are the tables that grow with usage - the cost
-- grows with the product, unlike a table that stays small by nature.
--
--   lhq_trades.user_id                    -> auth.users(id)
--   lhq_hypotheses.user_id                -> auth.users(id)
--   lhq_hypothesis_evidence.hypothesis_id -> lhq_hypotheses(id)
--   lhq_hypothesis_evidence.user_id       -> auth.users(id)
--   lhq_trial_claims.first_user_id        -> auth.users(id)
--
-- PLAIN CREATE INDEX, not CONCURRENTLY, and that is a deliberate choice
-- worth stating rather than defaulting silently. CREATE INDEX CONCURRENTLY
-- cannot run inside a transaction block, and this project's migration
-- tooling wraps each file in one - so CONCURRENTLY here would need a
-- separate, non-transactional apply step outside the normal migration
-- flow, carved out specially for this file. A plain CREATE INDEX takes a
-- brief SHARE lock that blocks writes (not reads) to the table for the
-- duration of the build. Checked against both projects before choosing
-- this: every one of these five tables has 0-4 rows in production and a
-- comparable count in dev (verified via Supabase's schema inspection,
-- 2026-09-12) - an index build over a handful of rows completes
-- effectively instantly, so the brief-lock trade this normally carries
-- does not apply yet. Revisit CONCURRENTLY if any of these five tables
-- grows large enough that the lock duration becomes real before this ships.
--
-- Apply to both projects when ready, dev first per #1157's own sequencing
-- (this batch lands after #1036 is proven, not before) - NOT YET APPLIED
-- to either. This is a schema write, so it goes to the owner like every
-- other one, even though the change itself is low-risk and mechanical.
--   prod qdpwhnvmhqgzijuwopso -> lhq_trades, lhq_hypotheses,
--        lhq_hypothesis_evidence, lhq_trial_claims
--   dev  wdtjhrilakoitfcezxpx -> lhq_dev_trades, lhq_dev_hypotheses,
--        lhq_dev_hypothesis_evidence, lhq_dev_trial_claims

create index if not exists lhq_trades_user_id_idx
  on lhq_trades (user_id);

create index if not exists lhq_hypotheses_user_id_idx
  on lhq_hypotheses (user_id);

create index if not exists lhq_hypothesis_evidence_hypothesis_id_idx
  on lhq_hypothesis_evidence (hypothesis_id);

create index if not exists lhq_hypothesis_evidence_user_id_idx
  on lhq_hypothesis_evidence (user_id);

create index if not exists lhq_trial_claims_first_user_id_idx
  on lhq_trial_claims (first_user_id);

-- dev equivalent (recorded for reproducibility - apply separately, see
-- table-name note above):
-- create index if not exists lhq_dev_trades_user_id_idx
--   on lhq_dev_trades (user_id);
-- create index if not exists lhq_dev_hypotheses_user_id_idx
--   on lhq_dev_hypotheses (user_id);
-- create index if not exists lhq_dev_hypothesis_evidence_hypothesis_id_idx
--   on lhq_dev_hypothesis_evidence (hypothesis_id);
-- create index if not exists lhq_dev_hypothesis_evidence_user_id_idx
--   on lhq_dev_hypothesis_evidence (user_id);
-- create index if not exists lhq_dev_trial_claims_first_user_id_idx
--   on lhq_dev_trial_claims (first_user_id);
