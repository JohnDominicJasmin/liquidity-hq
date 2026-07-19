-- lhq_alert_fires: persists Telegram/push alert firings with price-at-fire, so
-- outcomes can be resolved later (Tier 2 #10 - alert outcome tracking).
-- Shared global signal-accuracy data, not user-specific. RLS enabled with a
-- public SELECT policy (so /alerts can read outcomes with the anon client,
-- same pattern as lhq_live_signals) - no INSERT/UPDATE policy, so writes only
-- ever happen through the service-role admin client, which bypasses RLS.
--
-- Only rule_keys with an unambiguous implied direction are written here
-- (squeeze, ema_cross, distribution, rsi, whales) - see lib/alertOutcomes.ts.
-- Non-directional alert types (news, fear_greed, cvd, oi_spike,
-- sentiment_extremes, daily_summary, price_alerts) are never scored, so
-- outcomes aren't fabricated for calls that don't actually imply a side.

create table if not exists lhq_alert_fires (
  id              bigserial   primary key,
  rule_key        text        not null,   -- 'squeeze' | 'ema_cross' | 'distribution' | 'rsi' | 'whales'
  coin            text        not null,
  dir             text        not null,   -- 'long' | 'short' - the implied favorable direction
  label           text        not null,   -- human-readable, e.g. "BTC short squeeze building (82/100)"
  price_at_fire   numeric     not null,
  fired_at        timestamptz not null default now(),

  price_24h          numeric,
  outcome_pct_24h     numeric,             -- signed by dir: positive = favorable, negative = miss
  resolved_24h        boolean not null default false,

  price_48h          numeric,
  outcome_pct_48h     numeric,
  resolved_48h        boolean not null default false
);

alter table lhq_alert_fires enable row level security;
create policy "Public read access" on lhq_alert_fires for select using (true);

create index if not exists lhq_alert_fires_fired_at_idx      on lhq_alert_fires (fired_at desc);
create index if not exists lhq_alert_fires_unresolved_24h_idx on lhq_alert_fires (fired_at) where not resolved_24h;
create index if not exists lhq_alert_fires_unresolved_48h_idx on lhq_alert_fires (fired_at) where not resolved_48h;
create index if not exists lhq_alert_fires_rule_key_idx      on lhq_alert_fires (rule_key);

-- Dev variant
create table if not exists lhq_dev_alert_fires (
  id              bigserial   primary key,
  rule_key        text        not null,
  coin            text        not null,
  dir             text        not null,
  label           text        not null,
  price_at_fire   numeric     not null,
  fired_at        timestamptz not null default now(),

  price_24h          numeric,
  outcome_pct_24h     numeric,
  resolved_24h        boolean not null default false,

  price_48h          numeric,
  outcome_pct_48h     numeric,
  resolved_48h        boolean not null default false
);

alter table lhq_dev_alert_fires enable row level security;
create policy "Public read access" on lhq_dev_alert_fires for select using (true);

create index if not exists lhq_dev_alert_fires_fired_at_idx      on lhq_dev_alert_fires (fired_at desc);
create index if not exists lhq_dev_alert_fires_unresolved_24h_idx on lhq_dev_alert_fires (fired_at) where not resolved_24h;
create index if not exists lhq_dev_alert_fires_unresolved_48h_idx on lhq_dev_alert_fires (fired_at) where not resolved_48h;
create index if not exists lhq_dev_alert_fires_rule_key_idx      on lhq_dev_alert_fires (rule_key);
