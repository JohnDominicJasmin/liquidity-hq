-- Per-field write timestamps for user_settings, so two devices' writes to the
-- SAME field can finally be arbitrated (#1202). The existing `updated_at` is
-- whole-row and server-stamped on every PATCH (app/api/settings/route.ts) -
-- correct for "was this row touched", useless for "was THIS field touched",
-- since it moves on any field's write regardless of which one.
--
-- Keyed by UserSettings field name -> ISO timestamp of the last write the
-- SERVER accepted for that field, e.g. {"account_size": "2026-09-12T08:00:00Z"}.
-- Server clock only, same as the existing `updated_at` column already uses -
-- client clocks aren't mutually trustworthy across two independent devices.
--
-- Used for optimistic concurrency on PATCH: a client's write for a field is
-- accepted only if this column has no entry for that field yet (nothing to
-- conflict with) or the client's own last-known timestamp for that field is
-- >= what's stored here. Otherwise the write is rejected and the client
-- reconciles to the row's actual current value - see app/api/settings/route.ts
-- and components/SettingsProvider.tsx.
--
-- Additive only: new column, not-null, defaults to an empty object so every
-- existing row is unaffected until its first write under the new logic.
--
-- Apply to both projects when ready:
--   prod qdpwhnvmhqgzijuwopso -> lhq_user_settings
--   dev  wdtjhrilakoitfcezxpx -> lhq_dev_user_settings (ALREADY APPLIED
--     directly by PM/DevOps, owner-approved, 2026-09-12 - not through this
--     file, since the dev/prod split predates this migration's existence.
--     Kept here anyway so the shape is recorded and reproducible.)
-- NOT YET APPLIED to prod - shared production database write, owner gate.
-- PM/DevOps applies this immediately before the release that carries the
-- code depending on it deploys - see that release's Risk section.

alter table lhq_user_settings
  add column if not exists field_updated_at jsonb not null default '{}';

comment on column lhq_user_settings.field_updated_at is
  'Per-field last-write timestamp (server clock), keyed by UserSettings field name. Used for optimistic-concurrency arbitration between two devices writing the same field - see #1202.';

-- dev equivalent (recorded for reproducibility - already applied directly):
-- alter table lhq_dev_user_settings
--   add column if not exists field_updated_at jsonb not null default '{}';
-- comment on column lhq_dev_user_settings.field_updated_at is
--   'Per-field last-write timestamp (server clock), keyed by UserSettings field name. Used for optimistic-concurrency arbitration between two devices writing the same field - see #1202.';
