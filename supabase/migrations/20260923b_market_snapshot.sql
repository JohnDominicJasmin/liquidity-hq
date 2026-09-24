-- Server-owned market data: one scheduled job calls the exchanges, every
-- visitor reads what it wrote. #1404 (owner), tracker #1397.
--
-- WHY, measured rather than assumed. 100 page loads of a local production build
-- (50 /scanner, 50 /dashboard) made 1347 calls to exchange and market hosts -
-- api.binance.com 589, api.bybit.com 440, fapi.binance.com 195. Those routes are
-- already cached in memory (lib/apiCache, TTLs 5 s to 5 min), so this is not a
-- missing cache: it is that a cache measured in seconds still scales with
-- visitors, and an in-memory one is per instance and dies on every deploy. The
-- owner's requirement is stronger than "fewer calls" - no visitor request should
-- reach an exchange at all. That needs a writer on a clock and a reader that
-- never writes, which is what this table is for.
--
-- This is the SAME SHAPE as lhq_econ_snapshot (20260730_news_realtime.sql),
-- deliberately. That table already proved the pattern here: one hourly job
-- writes, clients read, and NewsProvider carries the row's age so the UI can say
-- "stale" instead of quietly showing an old number as a current one (#298).
-- Nothing below invents a new mechanism; it widens a working one to the
-- exchange data, which is the part that actually costs money and rate limit.
--
-- FRESHNESS IS DATA, NOT AN ASSUMPTION. `updated_at` is written on every run and
-- read on every request, so a consumer can always answer "how old is this?".
-- A reader that cannot answer that has to either pretend the row is current or
-- show nothing, and both were explicitly ruled out.
--
-- ONE SECTION PER PROJECT, one uncommented at a time, per 20260912b. Apply the
-- prod block to qdpwhnvmhqgzijuwopso and the dev block to wdtjhrilakoitfcezxpx.
-- The table-name prefix is the only difference between them (lib/tables.ts
-- switches on NEXT_PUBLIC_APP_ENV). Additive only: it creates one table and
-- grants read on it. Nothing is dropped, nothing existing is altered, so the
-- rollback is `drop table` and no deployed code depends on it until the reader
-- ships.

-- ── PROD: qdpwhnvmhqgzijuwopso ─────────────────────────────────────────────

-- One row per (feed, scope), replaced in full on each run. Keyed by text rather
-- than one row per column so a new feed is a new key, not a schema change - the
-- same reason lhq_econ_snapshot is keyed.
create table if not exists lhq_market_snapshot (
  key        text primary key,
  payload    jsonb not null,
  -- Which upstream actually answered ('binance', 'bybit', 'bybit-fallback'),
  -- so a silent failover is visible in the data rather than only in logs.
  source     text,
  -- Set by the writer on every successful run. The reader subtracts it from now()
  -- to get the age it displays; it is never defaulted on read.
  updated_at timestamptz not null default now()
);

-- ── Access ────────────────────────────────────────────────────────────────
-- World-readable, exactly like lhq_econ_snapshot and for the same reason: the
-- scanner and dashboard render for signed-out visitors. Writes are service-role
-- only - no INSERT/UPDATE policy exists and service_role bypasses RLS, so the
-- scheduled job is the sole writer. That is the "page requests never write"
-- rule enforced by the database rather than by everyone remembering it.
--
-- Grants are a separate layer from RLS: a permissive policy alone is not enough
-- if the role lacks the table grant, so both are set.
alter table lhq_market_snapshot enable row level security;

revoke all    on lhq_market_snapshot from anon, authenticated;
grant  select on lhq_market_snapshot to   anon, authenticated;

drop policy if exists lhq_market_snapshot_read on lhq_market_snapshot;
create policy lhq_market_snapshot_read on lhq_market_snapshot
  for select to anon, authenticated using (true);

-- Realtime is deliberately NOT enabled here, unlike lhq_news. News is an
-- append-only stream where a new row is an event worth pushing to an open tab;
-- this is a snapshot the page reads when it renders. Adding it to the
-- publication would push every refresh of every key to every connected client
-- for no gain, on a plan with a connection budget. If a live-updating consumer
-- appears later, that is the moment to add it - guarded, as the news migration
-- does it.


-- ── DEV: wdtjhrilakoitfcezxpx (uncomment this block, comment the one above) ──
--
-- create table if not exists lhq_dev_market_snapshot (
--   key        text primary key,
--   payload    jsonb not null,
--   source     text,
--   updated_at timestamptz not null default now()
-- );
--
-- alter table lhq_dev_market_snapshot enable row level security;
--
-- revoke all    on lhq_dev_market_snapshot from anon, authenticated;
-- grant  select on lhq_dev_market_snapshot to   anon, authenticated;
--
-- drop policy if exists lhq_dev_market_snapshot_read on lhq_dev_market_snapshot;
-- create policy lhq_dev_market_snapshot_read on lhq_dev_market_snapshot
--   for select to anon, authenticated using (true);
