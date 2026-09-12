-- #1113. app/api/settings/route.ts's ALLOWED list (the fields the PATCH
-- endpoint will write) has never matched the actual columns on either
-- database. PostgREST rejects an upsert referencing an unknown column for
-- the WHOLE row, not just that field - so any settings save that happens to
-- include one of these silently loses every field in the same request, not
-- just the missing one. New users' onboarding answers (display_name,
-- country, trading_challenge, trading_experience/style/how_heard) have
-- never saved on production because of this.
--
-- Six columns, three different histories, same fix:
--
-- 1. display_name, country, trading_challenge - text, nullable. A migration
--    for exactly these three already exists (20260629_onboarding_profile_fields.sql)
--    but was never applied to either database. Restated here (IF NOT EXISTS
--    is idempotent) so this one file is what actually needs running, rather
--    than someone having to also track down and re-run a three-month-old file.
--
-- 2. beginner_mode - boolean, default true. No migration for this one ever
--    existed. Defaulted to true to match lib/settings.ts's DEFAULT_SETTINGS
--    and the client's own first-load behaviour - NOT the `?? false` fallback
--    in rowToSettings, which only matters for a row where the column is
--    explicitly null (shouldn't happen once every row backfills to true).
--
-- 3. watchlist - jsonb (a JSON array of coin ids, per lib/settings.ts's
--    `string[]`), default ["btc","eth","sol"] to match DEFAULT_SETTINGS
--    exactly. Missing on BOTH databases, and unlike the other five, no
--    migration - applied or not - has ever existed for it at all.
--
-- 4. squeeze_threshold - numeric, default 70. NOT the same story as the
--    other five: present on PROD already (schema drift from an untraced
--    migration), missing on DEV ONLY. Added here for dev alone so the two
--    databases agree - the `if not exists` on prod's statement is a no-op
--    there.
--
-- Confirmed via Supabase MCP (list_tables, read-only) against both live
-- databases before writing this - not assumed from the ALLOWED list alone.
--
-- Additive only. NOT APPLIED by this commit - PM/DevOps gets the owner's OK
-- for production; dev is PM/DevOps's call per the same instruction.
--
-- Apply to both projects:
--   prod qdpwhnvmhqgzijuwopso -> lhq_user_settings
--   dev  wdtjhrilakoitfcezxpx -> lhq_dev_user_settings

alter table lhq_user_settings
  add column if not exists display_name      text default null,
  add column if not exists country           text default null,
  add column if not exists trading_challenge text default null,
  add column if not exists beginner_mode     boolean not null default true,
  add column if not exists watchlist         jsonb default '["btc","eth","sol"]'::jsonb,
  add column if not exists squeeze_threshold numeric default 70;

comment on column lhq_user_settings.beginner_mode is
  'Whether the simplified UI mode is on. Defaults true to match lib/settings.ts DEFAULT_SETTINGS - #1113.';
comment on column lhq_user_settings.watchlist is
  'Personalized coin watchlist - JSON array of coin ids, e.g. ["btc","eth"]. Default matches DEFAULT_SETTINGS - #1113.';

alter table lhq_dev_user_settings
  add column if not exists display_name      text default null,
  add column if not exists country           text default null,
  add column if not exists trading_challenge text default null,
  add column if not exists beginner_mode     boolean not null default true,
  add column if not exists watchlist         jsonb default '["btc","eth","sol"]'::jsonb,
  add column if not exists squeeze_threshold numeric default 70;

comment on column lhq_dev_user_settings.beginner_mode is
  'Whether the simplified UI mode is on. Defaults true to match lib/settings.ts DEFAULT_SETTINGS - #1113.';
comment on column lhq_dev_user_settings.watchlist is
  'Personalized coin watchlist - JSON array of coin ids, e.g. ["btc","eth"]. Default matches DEFAULT_SETTINGS - #1113.';
