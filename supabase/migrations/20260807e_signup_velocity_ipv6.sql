-- The signup velocity cap counted with exact address equality
-- (`where ip_addr = ip`), which is fine for IPv4 but nearly meaningless for
-- IPv6: a residential IPv6 client is a single /128 inside a /64 (or larger)
-- delegated prefix, so the attacker just rotates the low bits and every
-- attempt looks like a brand-new address. The count never leaves zero, and
-- the "5 accounts per network per day" cap does nothing - each account
-- carrying its own fresh 14-day Pro trial and its own daily AI quota.
--
-- Now normalises to the /64 before both the count and the insert, so all
-- addresses inside one delegated prefix share a bucket. network() zeroes the
-- host bits, so the stored value is the prefix itself and plain equality
-- keeps working. IPv4 is left as the exact address - a /32 is already the
-- host, and widening it would start grouping unrelated customers of the same
-- ISP together.
--
-- Existing rows are full /128s that will not match the new /64 keys. That is
-- harmless: the check only looks back 24 hours and the table is purged at 7
-- days, so it self-corrects within a day.
--
-- Run against BOTH projects; only the app_config table name differs, so the
-- dev copy is applied separately with lhq_dev_app_config.

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
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 403,
      'message', 'New signups are temporarily paused. Please try again later.'));
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

  if family(ip) = 6 then
    ip := network(set_masklen(ip, 64));
  end if;

  select count(*) into cnt from public.lhq_signup_ip_log
  where ip_addr = ip and created_at > now() - interval '24 hours';

  if cnt >= max_per_day then
    return jsonb_build_object('error', jsonb_build_object(
      'http_code', 429,
      'message', 'Too many accounts created from this network today. Please try again later.'));
  end if;

  insert into public.lhq_signup_ip_log (ip_addr) values (ip);
  return '{}'::jsonb;
end;
$$;
