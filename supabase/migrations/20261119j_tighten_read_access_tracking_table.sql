-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso by PM/DevOps; DEV on wdtjhrilakoitfcezxpx (shared by dev/qa/staging).
--
-- Tighten read access on one tracking table: no reachable page reads it from the browser (the only client reader is a route the edge
-- redirects away), and the server reads it with the service key. Drops the table's SELECT policies for the public/anon roles by
-- looking them up, so a policy name that differs between projects is not silently skipped. Same shape as 20261118e.
--
-- ===================== PROD (qdpwhnvmhqgzijuwopso) =====================
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'lhq_live_signals' and cmd = 'SELECT'
      and (roles && array['public', 'anon']::name[])
  loop
    execute format('drop policy %I on public.lhq_live_signals', r.policyname);
  end loop;
end $$;

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
do $$
declare r record;
begin
  for r in
    select policyname from pg_policies
    where schemaname = 'public' and tablename = 'lhq_dev_live_signals' and cmd = 'SELECT'
      and (roles && array['public', 'anon']::name[])
  loop
    execute format('drop policy %I on public.lhq_dev_live_signals', r.policyname);
  end loop;
end $$;
