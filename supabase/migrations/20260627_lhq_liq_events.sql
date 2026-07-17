-- lhq_liq_events: stores significant liquidation events (>$10K) for cross-session cluster history.
-- RLS disabled - this is shared global market data, not user-specific.
-- Events are retained for 7 days; old rows are purged by the LiqFeed save routine.

create table if not exists lhq_liq_events (
  id         bigserial   primary key,
  coin       text        not null,
  side       text        not null,   -- 'LONG' | 'SHORT'
  usd        numeric     not null,
  price      numeric     not null,
  source     text        not null,   -- 'BN' | 'BB'
  ts         bigint      not null,   -- Unix milliseconds
  created_at timestamptz not null default now()
);

alter table lhq_liq_events disable row level security;
create index if not exists lhq_liq_events_ts_idx on lhq_liq_events (ts desc);

-- Dev variant
create table if not exists lhq_dev_liq_events (
  id         bigserial   primary key,
  coin       text        not null,
  side       text        not null,
  usd        numeric     not null,
  price      numeric     not null,
  source     text        not null,
  ts         bigint      not null,
  created_at timestamptz not null default now()
);

alter table lhq_dev_liq_events disable row level security;
create index if not exists lhq_dev_liq_events_ts_idx on lhq_dev_liq_events (ts desc);
