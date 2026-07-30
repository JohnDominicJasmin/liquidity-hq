-- Server-owned news ingestion + push delivery.
--
-- Before this, every open tab polled four routes on its own timers
-- (NewsProvider.tsx: Finnhub news 2min, RSS 1min, Finnhub geo 3min, econ
-- calendar 1h), so upstream load scaled with concurrent viewers and a
-- breaking headline still took up to a full interval to appear. Neither
-- Finnhub nor the RSS feeds push, so polling has to happen somewhere - this
-- moves it to ONE scheduled server job (see docs/INFRASTRUCTURE.md §2) that
-- writes here, and clients subscribe via Realtime instead of fetching.
--
-- Two tables because the two feeds have genuinely different shapes: news is
-- an append-only stream where each row is an event worth pushing, while the
-- economic calendar is a forward-looking snapshot that gets wholly replaced
-- (and whose past rows mutate as actual values are released).
--
-- Run against BOTH projects - prod qdpwhnvmhqgzijuwopso (lhq_news,
-- lhq_econ_snapshot), dev wdtjhrilakoitfcezxpx (lhq_dev_news,
-- lhq_dev_econ_snapshot). The table-name prefix is the only difference.

-- ── News stream ────────────────────────────────────────────────────────────
-- dedup_key is the primary key rather than a surrogate id so the ingest job's
-- `on conflict do nothing` IS the dedup - no read-then-write race between
-- overlapping cron runs. It carries the same value NewsProvider's in-memory
-- seenRef already used (lowercased 60-char headline prefix), so behaviour
-- matches what shipped before, just enforced by the database.
create table if not exists lhq_news (
  dedup_key    text primary key,
  headline     text not null,
  source       text not null,
  published_at timestamptz not null,
  -- Nullable on purpose: an item can reach this table by matching a
  -- GEO_KEYWORDS entry while classifyNews() returns null for it. The client
  -- falls back to 'amber' for those, matching the old geo-events behaviour.
  severity     text,
  cat          text not null,
  link         text,
  image        text,
  created_at   timestamptz not null default now()
);

-- Hydration query is "recent items, newest first" - the client reads this once
-- on mount and then receives everything after it via Realtime.
create index if not exists lhq_news_published_at_idx
  on lhq_news (published_at desc);

-- ── Economic calendar snapshot ─────────────────────────────────────────────
-- One row, replaced in full on each run. Keyed by text rather than a bare
-- singleton so a second calendar scope (non-US, medium-impact) can be added
-- later without a schema change.
create table if not exists lhq_econ_snapshot (
  key        text primary key,
  events     jsonb not null,
  source     text,
  updated_at timestamptz not null default now()
);

-- ── Access ─────────────────────────────────────────────────────────────────
-- Unlike most tables here, these are world-readable. The news ticker and
-- calendar render for signed-out visitors (that is why /api/news/finnhub and
-- /api/econ-calendar were deliberately left unauthenticated), so anon needs
-- SELECT or Realtime delivers nothing to a logged-out tab.
--
-- Grants are a separate layer from RLS - a permissive policy alone is not
-- enough if the role lacks the table grant, so both are set explicitly.
-- Writes are service-role only: no INSERT/UPDATE policy exists, and
-- service_role bypasses RLS, so the ingest route is the sole writer.
alter table lhq_news          enable row level security;
alter table lhq_econ_snapshot enable row level security;

revoke all on lhq_news          from anon, authenticated;
revoke all on lhq_econ_snapshot from anon, authenticated;
grant select on lhq_news          to anon, authenticated;
grant select on lhq_econ_snapshot to anon, authenticated;

drop policy if exists lhq_news_read on lhq_news;
create policy lhq_news_read on lhq_news for select to anon, authenticated using (true);

drop policy if exists lhq_econ_snapshot_read on lhq_econ_snapshot;
create policy lhq_econ_snapshot_read on lhq_econ_snapshot for select to anon, authenticated using (true);

-- ── Realtime ───────────────────────────────────────────────────────────────
-- Done in SQL rather than the dashboard toggle used for lhq_user_status, so
-- the second project (and any future restore) doesn't depend on someone
-- remembering to flip a checkbox. Guarded because adding a table twice errors.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lhq_news'
  ) then
    alter publication supabase_realtime add table lhq_news;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'lhq_econ_snapshot'
  ) then
    alter publication supabase_realtime add table lhq_econ_snapshot;
  end if;
end $$;
