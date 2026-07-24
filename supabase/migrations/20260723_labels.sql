-- Runtime i18n label store: key + locale -> translated text, so switching
-- language just refetches this table instead of a rebuild (see
-- app/api/labels/route.ts). Public content (translated UI copy), not
-- sensitive - readable directly by anon/authenticated; writes are
-- service-role only (no insert/update policy, same pattern as admin_users).
--
-- Run once in the Supabase SQL Editor (both prefixed tables).

create table if not exists lhq_labels (
  key        text        not null,
  locale     text        not null,
  value      text        not null,
  updated_at timestamptz not null default now(),
  primary key (key, locale)
);
alter table lhq_labels enable row level security;
create policy "labels_public_read" on lhq_labels for select to anon, authenticated using (true);

-- Dev variant
create table if not exists lhq_dev_labels (
  key        text        not null,
  locale     text        not null,
  value      text        not null,
  updated_at timestamptz not null default now(),
  primary key (key, locale)
);
alter table lhq_dev_labels enable row level security;
create policy "labels_public_read" on lhq_dev_labels for select to anon, authenticated using (true);

-- After creating tables via the SQL editor, refresh PostgREST's schema cache:
--   notify pgrst, 'reload schema';
