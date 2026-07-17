-- Creates lhq_grok_usage (prod) and lhq_dev_grok_usage (dev).
-- The app queries T.grok_usage which resolves to these prefixed table names.
-- Run once in the Supabase SQL Editor.

create table if not exists lhq_grok_usage (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  date              date        not null,
  deep_count        int         not null default 0,
  quick_count       int         not null default 0,
  chat_count        int         not null default 0,
  chat_search_count int         not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (user_id, date)
);

alter table lhq_grok_usage enable row level security;

create policy "users_own_usage" on lhq_grok_usage
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Dev table - same structure
create table if not exists lhq_dev_grok_usage (
  user_id           uuid        not null references auth.users(id) on delete cascade,
  date              date        not null,
  deep_count        int         not null default 0,
  quick_count       int         not null default 0,
  chat_count        int         not null default 0,
  chat_search_count int         not null default 0,
  updated_at        timestamptz not null default now(),
  primary key (user_id, date)
);

alter table lhq_dev_grok_usage enable row level security;

create policy "users_own_usage" on lhq_dev_grok_usage
  for all to authenticated
  using  (user_id = auth.uid())
  with check (user_id = auth.uid());
