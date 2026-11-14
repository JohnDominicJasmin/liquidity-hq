-- A rate limit that survives a restart and is shared by every instance (#1413, owner-prioritised hardening of /api/telegram/send).
--
-- WHY: lib/rateLimit.ts keeps its buckets in process memory, so a deploy, a restart or a second instance resets the count to zero. For a route that anyone can call and that
-- posts to the owner's own Telegram chat, that is a spam path. This adds one small table and one atomic function: lhq_rate_limit_hit(key, limit, window_seconds) counts a hit and
-- says whether it is allowed, in ONE statement under the row lock (so concurrent callers cannot both squeeze under the limit).
--
-- ADDITIVE: a new table and a new function; nothing existing is touched. The table has RLS on and no policy, and every grant is revoked from public, anon and authenticated, so only the
-- service role (the server) can call the function. Keys are opaque strings chosen by the server (for example 'telegram-send:ip:<ip>'); old rows are swept on a small fraction of calls.
--
-- ORDER: APPLY BEFORE THE DEPLOY THAT USES IT, but nothing breaks if it is not: when the function is missing the app falls back to the in-memory limiter it uses today.
--
-- Run ONE block per project (per 20260912b): the prod block on prod qdpwhnvmhqgzijuwopso, the dev block (below, uncommented) on dev wdtjhrilakoitfcezxpx (qa and staging use it). The dev block was applied and exercised on dev by PM/DevOps; it must NOT be run on prod (it would create lhq_dev_* names there).
-- Roll back: drop function lhq_rate_limit_hit(text, int, int); drop table lhq_rate_limits;

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
create table if not exists public.lhq_rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);
alter table public.lhq_rate_limits enable row level security;
revoke all on public.lhq_rate_limits from public, anon, authenticated;

create or replace function public.lhq_rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_key is null or length(p_key) > 200 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'lhq_rate_limit_hit: bad arguments';
  end if;
  insert into lhq_rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when now() >= r.window_start + make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits         = case when now() >= r.window_start + make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning r.hits into v_hits;
  -- Sweep stale rows on about 1 call in 100; they are only counters.
  if random() < 0.01 then
    delete from lhq_rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.lhq_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.lhq_rate_limit_hit(text, integer, integer) to service_role;

-- ── dev: wdtjhrilakoitfcezxpx (byte-identical except the names; apply separately) ─────────
create table if not exists public.lhq_dev_rate_limits (
  key          text        primary key,
  window_start timestamptz not null default now(),
  hits         integer     not null default 0
);
alter table public.lhq_dev_rate_limits enable row level security;
revoke all on public.lhq_dev_rate_limits from public, anon, authenticated;

create or replace function public.lhq_dev_rate_limit_hit(p_key text, p_limit integer, p_window_seconds integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_hits integer;
begin
  if p_key is null or length(p_key) > 200 or p_limit < 1 or p_window_seconds < 1 then
    raise exception 'lhq_dev_rate_limit_hit: bad arguments';
  end if;
  insert into lhq_dev_rate_limits as r (key, window_start, hits)
  values (p_key, now(), 1)
  on conflict (key) do update set
    window_start = case when now() >= r.window_start + make_interval(secs => p_window_seconds) then now() else r.window_start end,
    hits         = case when now() >= r.window_start + make_interval(secs => p_window_seconds) then 1 else r.hits + 1 end
  returning r.hits into v_hits;
  if random() < 0.01 then
    delete from lhq_dev_rate_limits where window_start < now() - interval '1 day';
  end if;
  return v_hits <= p_limit;
end;
$$;
revoke all on function public.lhq_dev_rate_limit_hit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.lhq_dev_rate_limit_hit(text, integer, integer) to service_role;
