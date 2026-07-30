-- Per-source health for every external API this app depends on.
--
-- Written after three dependencies were each found silently dead in a single
-- day: five RSS feeds whose hostnames no longer resolve, TruthSocial answering
-- 200 OK with an HTML app shell and zero <item> elements, and both Coinglass v2
-- endpoints returning 500. Every one of them failed soft behind a `catch {}`,
-- so nothing surfaced and the features just quietly stopped working.
--
-- The TruthSocial case is why health here is SEMANTIC, not a status code: a
-- 200 that carries no usable rows is a failure, and any check built on HTTP
-- status alone would have called that source healthy indefinitely. Callers
-- decide `ok` from whether they got data they can use.
--
-- Run against BOTH projects - prod qdpwhnvmhqgzijuwopso (lhq_api_health), dev
-- wdtjhrilakoitfcezxpx (lhq_dev_api_health). Only the table name differs.

create table if not exists lhq_api_health (
  source               text primary key,   -- 'rss:BBC World', 'finnhub:crypto'
  category             text not null,      -- groups the /ops display
  ok                   boolean not null,   -- outcome of the most recent check
  detail               text,               -- '26 items' / 'HTTP 500' / 'no items'
  items                integer,            -- payload size when the call succeeded
  last_ok_at           timestamptz,
  last_fail_at         timestamptz,
  consecutive_failures integer not null default 0,
  -- Rolling outcome window, oldest first, capped at 50 by the function below.
  -- Kept as raw outcomes rather than a precomputed rate so the display can
  -- change its mind about the window without a migration.
  recent               boolean[] not null default '{}',
  updated_at           timestamptz not null default now()
);

create index if not exists lhq_api_health_category_idx on lhq_api_health (category);

-- Service-role only: the ingest crons write it, the /ops admin route reads it.
-- No policies, so RLS denies anon and authenticated outright - matching
-- lhq_ls_webhook_events and the other system tables.
alter table lhq_api_health enable row level security;
revoke all on lhq_api_health from anon, authenticated;

-- Records a batch of outcomes in one round trip.
--
-- The append-and-trim of `recent`, and the consecutive-failure counter, are
-- read-modify-write. Doing that in application code would race whenever two
-- crons report the same source at once (the news and econ ingests overlap on
-- the minute), so it happens here instead, where the row update is atomic.
--
-- Takes jsonb rather than arrays because one call reports ~15 sources with
-- mixed types, and jsonb keeps that a single statement.
create or replace function lhq_record_api_health(p_rows jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  r jsonb;
begin
  for r in select * from jsonb_array_elements(p_rows)
  loop
    insert into lhq_api_health as h (
      source, category, ok, detail, items,
      last_ok_at, last_fail_at, consecutive_failures, recent, updated_at
    )
    values (
      r->>'source',
      coalesce(r->>'category', 'other'),
      (r->>'ok')::boolean,
      r->>'detail',
      nullif(r->>'items', '')::integer,
      case when (r->>'ok')::boolean then now() end,
      case when (r->>'ok')::boolean then null else now() end,
      case when (r->>'ok')::boolean then 0 else 1 end,
      array[(r->>'ok')::boolean],
      now()
    )
    on conflict (source) do update set
      category   = excluded.category,
      ok         = excluded.ok,
      detail     = excluded.detail,
      items      = excluded.items,
      -- Keep the previous timestamp on the branch that did not happen, so
      -- "last succeeded 3 days ago" survives a run of failures. That gap is
      -- the whole point: it is what makes a dead source obvious.
      last_ok_at   = case when excluded.ok then now() else h.last_ok_at end,
      last_fail_at = case when excluded.ok then h.last_fail_at else now() end,
      consecutive_failures =
        case when excluded.ok then 0 else h.consecutive_failures + 1 end,
      recent = (
        select array_agg(v order by i)
        from (
          select v, i
          from unnest(h.recent || excluded.ok) with ordinality as t(v, i)
          order by i desc
          limit 50
        ) s
      ),
      updated_at = now();
  end loop;
end;
$$;

-- Same hardening as the other security-definer helpers here: reachable only
-- through a service-role RPC call, never as an anon/authenticated PostgREST
-- endpoint.
revoke execute on function lhq_record_api_health(jsonb) from public, anon, authenticated;
grant execute on function lhq_record_api_health(jsonb) to service_role;
