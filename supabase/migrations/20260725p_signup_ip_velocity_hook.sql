-- IP-velocity signup Auth Hook - SECURITY_AUDIT.md's last open item (optional,
-- was never a real gap since Turnstile CAPTCHA + disposable-domain blocklist
-- already cover the higher-value abuse cases). Rejects signup when the same
-- IP has already created more than MAX_PER_DAY accounts in the last 24h.
--
-- Run against BOTH projects - prod (qdpwhnvmhqgzijuwopso) and dev
-- (wdtjhrilakoitfcezxpx) - identical on both, no dev/prod table split needed
-- since this only ever runs server-side inside the Auth Hook, no app code
-- reads or writes this table.
--
-- After applying: this function does nothing until it's wired up in
-- Supabase Dashboard -> Authentication -> Hooks -> "Before User Created" ->
-- select `public.hook_restrict_signup_velocity` as a Postgres hook. That
-- toggle isn't reachable via SQL/migration - must be done manually per
-- project, once, in the dashboard.

create table if not exists public.lhq_signup_ip_log (
  id         bigint generated always as identity primary key,
  ip_addr    inet not null,
  created_at timestamptz not null default now()
);

create index if not exists lhq_signup_ip_log_ip_created_idx
  on public.lhq_signup_ip_log (ip_addr, created_at);

-- Only supabase_auth_admin (the role that invokes auth hooks) may touch this
-- table - it's an internal abuse-tracking log, not app data.
grant all on table public.lhq_signup_ip_log to supabase_auth_admin;
revoke all on table public.lhq_signup_ip_log from authenticated, anon, public;

create or replace function public.hook_restrict_signup_velocity(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  ip           inet;
  cnt          int;
  max_per_day  constant int := 5;
begin
  -- event->'metadata'->>'ip_address' is always present per Supabase's
  -- before-user-created contract, but fail open (allow signup) rather than
  -- block real users if it's ever missing/malformed - this hook is a
  -- velocity cap, not the primary abuse defense (Turnstile + disposable-
  -- domain blocklist are).
  begin
    ip := (event->'metadata'->>'ip_address')::inet;
  exception when others then
    return '{}'::jsonb;
  end;

  if ip is null then
    return '{}'::jsonb;
  end if;

  select count(*) into cnt
  from public.lhq_signup_ip_log
  where ip_addr = ip and created_at > now() - interval '24 hours';

  if cnt >= max_per_day then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 429,
        'message', 'Too many accounts created from this network today. Please try again later.'
      )
    );
  end if;

  insert into public.lhq_signup_ip_log (ip_addr) values (ip);

  return '{}'::jsonb;
end;
$$;

grant execute on function public.hook_restrict_signup_velocity(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_restrict_signup_velocity(jsonb) from authenticated, anon, public;
