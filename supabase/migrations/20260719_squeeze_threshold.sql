-- Tier 2 #13 - per-user squeeze/flush alert threshold, same pattern as the
-- existing rsi_ob/rsi_os/fr_threshold notification-threshold columns.
-- Default 70 matches the app-wide canonical squeeze threshold (see
-- DEFAULT_THRESHOLDS in app/api/telegram/alert/route.ts).

alter table lhq_user_settings add column if not exists squeeze_threshold numeric not null default 70;

-- lhq_dev_user_settings did not exist at all prior to this migration - the
-- dev environment (NEXT_PUBLIC_APP_ENV=dev) resolves T.user_settings to this
-- table name, so without it dev's settings persistence silently failed and
-- fell back to in-memory defaults on every request. Mirrors the live prod
-- lhq_user_settings schema (verified via information_schema) plus the new
-- squeeze_threshold column.
create table if not exists lhq_dev_user_settings (
  user_id             uuid        primary key references auth.users(id) on delete cascade,
  telegram_chat_id    text        not null default '',
  account_size        numeric     not null default 1000,
  risk_pct            numeric     not null default 1.5,
  default_coin        text        not null default 'btc',
  default_tf          text        not null default '15m',
  fr_threshold        numeric     not null default 0.05,
  fng_fear            int         not null default 15,
  fng_greed           int         not null default 85,
  rsi_ob              int         not null default 70,
  rsi_os              int         not null default 30,
  squeeze_threshold   numeric     not null default 70,
  hidden_sections     text[]      not null default '{}',
  updated_at          timestamptz not null default now(),
  trading_experience  text,
  trading_style       text,
  how_heard           text
);

alter table lhq_dev_user_settings enable row level security;

create policy "user_settings_select" on lhq_dev_user_settings
  for select using (auth.uid() = user_id);

create policy "user_settings_insert" on lhq_dev_user_settings
  for insert with check (auth.uid() = user_id);

create policy "user_settings_update" on lhq_dev_user_settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
