-- Documents the RLS policies already applied live to lhq_hypotheses and
-- lhq_hypothesis_evidence in prod (verified via pg_policies) - no migration
-- file existed for these two even though lhq_trades got one
-- (20260804a_trades_user_scoping.sql). Idempotent - safe to run even though
-- the policies already exist on both live projects.

alter table lhq_hypotheses enable row level security;
drop policy if exists owner_all_hypotheses on lhq_hypotheses;
create policy owner_all_hypotheses on lhq_hypotheses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table lhq_hypothesis_evidence enable row level security;
drop policy if exists owner_all_evidence on lhq_hypothesis_evidence;
create policy owner_all_evidence on lhq_hypothesis_evidence
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Dev tables - same policies
alter table lhq_dev_hypotheses enable row level security;
drop policy if exists owner_all_hypotheses on lhq_dev_hypotheses;
create policy owner_all_hypotheses on lhq_dev_hypotheses
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

alter table lhq_dev_hypothesis_evidence enable row level security;
drop policy if exists owner_all_evidence on lhq_dev_hypothesis_evidence;
create policy owner_all_evidence on lhq_dev_hypothesis_evidence
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
