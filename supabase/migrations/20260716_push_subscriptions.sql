-- Web Push subscription storage. One row per browser/device per user.
-- endpoint is unique globally (each browser generates its own push endpoint URL).

create table if not exists lhq_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);

create index if not exists lhq_push_subscriptions_user_id_idx on lhq_push_subscriptions(user_id);

alter table lhq_push_subscriptions enable row level security;

create policy "users manage own push subscriptions"
  on lhq_push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Dev variant
create table if not exists lhq_dev_push_subscriptions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  endpoint   text not null unique,
  p256dh     text not null,
  auth       text not null,
  created_at timestamptz default now()
);

create index if not exists lhq_dev_push_subscriptions_user_id_idx on lhq_dev_push_subscriptions(user_id);

alter table lhq_dev_push_subscriptions enable row level security;

create policy "users manage own push subscriptions"
  on lhq_dev_push_subscriptions
  for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);
