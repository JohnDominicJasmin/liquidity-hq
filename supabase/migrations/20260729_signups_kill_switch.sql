-- Extends the existing hook_restrict_signup_velocity Auth Hook (Before User
-- Created - see 20260725p_signup_ip_velocity_hook.sql) to also check
-- app_config's 'signups' feature flag first. This is deliberately in the
-- SAME hook function, not a new one - Supabase's dashboard wires exactly one
-- function per hook event, and this one is already wired on both projects
-- (see that migration's own comment), so extending it is the only way to add
-- enforcement without a second manual dashboard step.
--
-- Real enforcement, not cosmetic: this runs inside Supabase itself, so it
-- blocks account creation no matter how it's attempted - through the
-- website, or a direct call to the signup API - not just a hidden button.
--
-- Fails OPEN on a missing/unreadable app_config row (coalesce(..., true)),
-- matching every other feature-flag read in this app - a broken config read
-- must never silently block real signups.
--
-- Run the PROD block in qdpwhnvmhqgzijuwopso, the DEV block (commented) in
-- wdtjhrilakoitfcezxpx. Table name inside each (lhq_app_config vs
-- lhq_dev_app_config) is the only thing that differs - the hook function
-- ITSELF stays named hook_restrict_signup_velocity, unprefixed, on both
-- projects, since that's what the dashboard's hook wiring points at.

-- ── PROD ─────────────────────────────────────────────────────────────────
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
  signups_on   boolean;
begin
  select coalesce((value->>'signups')::boolean, true) into signups_on
    from lhq_app_config where key = 'feature_flags';
  if not coalesce(signups_on, true) then
    return jsonb_build_object(
      'error', jsonb_build_object(
        'http_code', 403,
        'message', 'New signups are temporarily paused. Please try again later.'
      )
    );
  end if;

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

-- ── DEV - run separately against the dev project ────────────────────────────
-- create or replace function public.hook_restrict_signup_velocity(event jsonb)
-- returns jsonb language plpgsql security definer set search_path = public as $$
-- declare
--   ip           inet;
--   cnt          int;
--   max_per_day  constant int := 5;
--   signups_on   boolean;
-- begin
--   select coalesce((value->>'signups')::boolean, true) into signups_on
--     from lhq_dev_app_config where key = 'feature_flags';
--   if not coalesce(signups_on, true) then
--     return jsonb_build_object(
--       'error', jsonb_build_object(
--         'http_code', 403,
--         'message', 'New signups are temporarily paused. Please try again later.'
--       )
--     );
--   end if;
--
--   begin
--     ip := (event->'metadata'->>'ip_address')::inet;
--   exception when others then
--     return '{}'::jsonb;
--   end;
--
--   if ip is null then
--     return '{}'::jsonb;
--   end if;
--
--   select count(*) into cnt
--   from public.lhq_signup_ip_log
--   where ip_addr = ip and created_at > now() - interval '24 hours';
--
--   if cnt >= max_per_day then
--     return jsonb_build_object(
--       'error', jsonb_build_object(
--         'http_code', 429,
--         'message', 'Too many accounts created from this network today. Please try again later.'
--       )
--     );
--   end if;
--
--   insert into public.lhq_signup_ip_log (ip_addr) values (ip);
--
--   return '{}'::jsonb;
-- end;
-- $$;
