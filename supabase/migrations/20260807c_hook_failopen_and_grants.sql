-- 1. hook_restrict_signup_velocity: the feature-flag read was the ONE statement
--    in the function not wrapped in an exception block. `(value->>'signups')
--    ::boolean` raises on any non-boolean ("yes", 1), the Before-User-Created
--    hook errors, and Supabase Auth then rejects the signup - so a single
--    malformed config value silently stops ALL account creation until someone
--    thinks to look at that row. Reachable from /ops/config, which validated
--    only `typeof value === 'object'`.
--    Now hardened at both ends: the route rejects non-boolean flags
--    (app/api/ops/config/route.ts), and this read falls back to "signups on"
--    if the row is missing, malformed, or unreadable. Matches the fail-open
--    posture of every other feature-flag read in the app - a broken config
--    must never take signups down.
--
-- 2. lhq_signup_ip_log: RLS was never enabled. Not currently exploitable -
--    verified live that anon has no table grant, so a direct read is refused -
--    but that is the *only* thing protecting it, and Supabase's default
--    privileges hand out grants on new objects, so one stray grant reopens
--    the signup IP list (personal data) and lets an attacker DELETE rows to
--    reset the 5-per-IP-per-day velocity cap on demand. RLS with zero policies
--    denies anon/authenticated outright while the hook, which runs SECURITY
--    DEFINER as the table owner, is unaffected.
--    Also adds retention: the hook only ever looks back 24 hours, so anything
--    older is personal data kept for no reason.
--
-- 3. Remaining EXECUTE grants revoked from anon/authenticated, not just PUBLIC.
--    20260729c established with a live curl test that revoking from PUBLIC
--    alone does NOT remove Supabase's direct anon/authenticated grants, but
--    that lesson was only applied to one function at the time. These are the
--    stragglers still carrying a PUBLIC-only revoke.
--
-- 4. TRUNCATE revoked schema-wide. 20260804h did this for two tables with the
--    right reasoning - "TRUNCATE isn't a row-level operation, so RLS never
--    guarded it at all" - and it applies to every table. Not reachable over
--    PostgREST (no HTTP verb maps to TRUNCATE), so this is hygiene against a
--    leaked direct connection string, not a live hole.
--
-- PROD block. Dev differs only in the lhq_dev_ table names inside the hook.

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
  begin
    select coalesce((value->>'signups')::boolean, true) into signups_on
      from lhq_app_config where key = 'feature_flags';
  exception when others then
    signups_on := true;
  end;

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
    raise warning 'hook_restrict_signup_velocity: signup with no ip_address in event metadata - velocity cap skipped';
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

-- ── 2. signup IP log: RLS backstop + retention ──────────────────────────────
alter table public.lhq_signup_ip_log enable row level security;
delete from public.lhq_signup_ip_log where created_at < now() - interval '7 days';

-- ── 3. function grants ──────────────────────────────────────────────────────
revoke execute on function increment_global_ai_usage(date, integer) from anon, authenticated, public;
revoke execute on function lhq_normalize_trial_email(text)          from anon, authenticated, public;

-- ── 4. TRUNCATE hygiene ─────────────────────────────────────────────────────
revoke truncate on all tables in schema public from anon, authenticated;
