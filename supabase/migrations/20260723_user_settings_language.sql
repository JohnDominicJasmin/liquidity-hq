-- Per-user language preference for the i18n labels system (signed-in users
-- only - guests keep their choice in localStorage, see lib/labels.ts). Lives
-- on user_settings alongside the other profile fields rather than a new
-- table, same as display_name/country. Nullable: null means no explicit
-- choice was ever saved server-side, so the client falls back to whatever
-- it already has in localStorage.
--
-- Run once in the Supabase SQL Editor (both prefixed tables).

alter table lhq_user_settings add column if not exists language text;
alter table lhq_dev_user_settings add column if not exists language text;
