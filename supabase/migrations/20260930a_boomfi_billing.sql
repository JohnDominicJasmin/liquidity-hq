-- #861 Phase 1b: what the BoomFi webhook needs from the database.
--
-- NOT APPLIED BY MERGING. Applying is a write to the shared database: the
-- owner's word each time, and QA's ok on the timing, because any DDL fires a
-- PostgREST schema reload (#1025) and must not land during a QA pass.
--
-- ADDITIVE ONLY. One new table, three new nullable columns with no default.
-- Nothing existing is altered, renamed or dropped, so the running app is
-- unaffected before and after, and there is nothing to roll back.
--
-- 1. lhq_boomfi_webhook_events - every verified delivery, stored whole.
--
--    Two jobs. It is the REPLAY GUARD: BoomFi re-signs a retry with a new
--    timestamp, and documents no event id in the body, so a SHA-256 of the raw
--    body is the only thing a repeated delivery shares (the same choice
--    lhq_ls_webhook_events made, for the same reason). And it is the EVIDENCE:
--    BoomFi publishes no example payload, so the code that decides who is Pro
--    will be written from the bodies recorded here, not from an inferred shape.
--
--    `body` holds what BoomFi sent, which includes the payer's name, email and
--    wallet address. Service-role only: RLS on with no policy, and the grants
--    revoked, so anon and authenticated can neither read nor write it - the
--    same shape as lhq_ls_webhook_events and lhq_ai_call_log.
--
--    `event`, `resource_id` and `resource_status` are the three fields BoomFi
--    documents as strings on every event, lifted out for searching. They are
--    nullable on purpose: if the real shape differs they stay null and `body`
--    still has the truth.
--
-- 2. Three columns on lhq_user_subscriptions.
--
--    The row's existing ls_subscription_id / ls_customer_id / ls_status are
--    read by the Lemon Squeezy cancel route and the one-active-plan guard
--    (lib/lemonsqueezy.ts). Writing BoomFi's ids into them would send a BoomFi
--    id to Lemon Squeezy's API and let the guard compare ids from two
--    processors as if they were one. So BoomFi gets its own columns, and
--    `billing_provider` says which processor the row's subscription belongs to
--    (null = written before this column existed, i.e. Lemon Squeezy or an
--    admin grant).
--
--    The existing "users can read their own row" policy covers the new
--    columns: an account can see its own provider and ids, nobody else's.
--
-- Registered in lib/tables.ts as T.boomfi_webhook_events (prefix-aware: lhq_
-- prod / lhq_dev_ dev). Run against BOTH projects, ONE SECTION AT A TIME: the
-- prod block below is live, the dev block is commented (20260912b's
-- convention, so running this file against prod can never create a dev object
-- there).

create table if not exists lhq_boomfi_webhook_events (
  payload_hash    text        primary key,          -- sha256 of the raw request body
  event           text,                             -- e.g. 'Payment.Updated'; null = not where the docs say
  resource_id     text,                             -- the body's `id`
  resource_status text,                             -- the body's `status`
  body            jsonb       not null,             -- the verified delivery, whole
  received_at     timestamptz not null default now()
);

alter table lhq_boomfi_webhook_events enable row level security;

revoke all on lhq_boomfi_webhook_events from anon, authenticated;

create index if not exists lhq_boomfi_webhook_events_received_at_idx
  on lhq_boomfi_webhook_events (received_at desc);

alter table lhq_user_subscriptions
  add column if not exists billing_provider       text,   -- 'boomfi' | 'lemonsqueezy' | null (pre-dates this column)
  add column if not exists boomfi_subscription_id text,   -- BoomFi's sub_... id
  add column if not exists boomfi_customer_id     text;   -- BoomFi's cus_... id

-- DEV: the same objects under the lhq_dev_ prefix - apply separately.
--
-- create table if not exists lhq_dev_boomfi_webhook_events (
--   payload_hash    text        primary key,
--   event           text,
--   resource_id     text,
--   resource_status text,
--   body            jsonb       not null,
--   received_at     timestamptz not null default now()
-- );
--
-- alter table lhq_dev_boomfi_webhook_events enable row level security;
--
-- revoke all on lhq_dev_boomfi_webhook_events from anon, authenticated;
--
-- create index if not exists lhq_dev_boomfi_webhook_events_received_at_idx
--   on lhq_dev_boomfi_webhook_events (received_at desc);
--
-- alter table lhq_dev_user_subscriptions
--   add column if not exists billing_provider       text,
--   add column if not exists boomfi_subscription_id text,
--   add column if not exists boomfi_customer_id     text;
