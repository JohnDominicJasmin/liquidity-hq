-- Lets app/api/auth/ban-reason/route.ts resolve email -> user_id server-side
-- without scanning every user via listUsers() (supabase-js's admin API has
-- no getUserByEmail, and the auth schema isn't reachable through the normal
-- PostgREST client even with the service-role key). Same security-definer +
-- revoke-from-public hardening as lhq_grant_signup_trial() - only reachable
-- via a service-role RPC call, never as an anon/authenticated endpoint.
--
-- Run the PROD block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx.

-- ── PROD ─────────────────────────────────────────────────────────────────
create or replace function lhq_user_id_by_email(p_email text)
returns uuid
language sql
security definer
set search_path = public
as $$ select id from auth.users where email = p_email limit 1; $$;

revoke execute on function lhq_user_id_by_email(text) from public;
grant execute on function lhq_user_id_by_email(text) to service_role;

-- ── DEV - run separately against the dev project ────────────────────────────
-- create or replace function lhq_dev_user_id_by_email(p_email text)
-- returns uuid language sql security definer set search_path = public as $$
--   select id from auth.users where email = p_email limit 1;
-- $$;
-- revoke execute on function lhq_dev_user_id_by_email(text) from public;
-- grant execute on function lhq_dev_user_id_by_email(text) to service_role;
