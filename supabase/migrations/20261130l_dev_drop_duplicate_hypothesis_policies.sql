-- NOT YET APPLIED. DEV ONLY (project wdtjhrilakoitfcezxpx). There is no prod block: do not run this on prod.
--
-- lhq_dev_hypotheses and lhq_dev_hypothesis_evidence each carry two overlapping ALL policies (noted in 20261023d). Permissive policies
-- OR together, so changing one and not the other would leave the old rule in force. This keeps `owner_all_hypotheses` /
-- `owner_all_evidence` (20260907b: the same names as prod, with both USING and WITH CHECK) and drops the `owner_all_dev_*` copies
-- (20260911a: USING only, which on an ALL policy also covers writes, so nothing is allowed or refused differently afterwards).
--
-- Each drop happens only if the policy being kept is there; otherwise the script stops and nothing changes.
begin;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_hypotheses' and policyname = 'owner_all_hypotheses') then
    raise exception 'owner_all_hypotheses is missing on lhq_dev_hypotheses; nothing dropped';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_hypothesis_evidence' and policyname = 'owner_all_evidence') then
    raise exception 'owner_all_evidence is missing on lhq_dev_hypothesis_evidence; nothing dropped';
  end if;
end $$;

drop policy if exists "owner_all_dev_hypotheses" on public.lhq_dev_hypotheses;
drop policy if exists "owner_all_dev_evidence" on public.lhq_dev_hypothesis_evidence;

commit;

-- Check afterwards: exactly one row per table.
-- select tablename, policyname, cmd, qual, with_check from pg_policies
--  where tablename in ('lhq_dev_hypotheses', 'lhq_dev_hypothesis_evidence') order by 1, 2;
