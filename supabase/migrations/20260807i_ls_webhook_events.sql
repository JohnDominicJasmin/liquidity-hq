-- Replay guard for the LemonSqueezy webhook.
--
-- LemonSqueezy retries delivery on any non-2xx, and a retry carries a byte-
-- identical body. Without a guard the same subscription event is processed
-- again on every retry. Today each handler is an idempotent upsert so a replay
-- is merely wasteful, but the moment anything non-idempotent is added there
-- (crediting a referral, sending a receipt, extending a period) a retry storm
-- becomes a real billing bug. Cheaper to make replays impossible now than to
-- remember this later.
--
-- Keyed on a SHA-256 of the raw request body rather than an event id, because
-- LemonSqueezy's payload carries no per-event identifier - meta.webhook_id
-- identifies the webhook CONFIG, not the delivery. Hashing the exact bytes is
-- what actually matches "this same delivery again".
--
-- Service-role only: the webhook route is the sole reader and writer, and it
-- uses getSupabaseAdmin(). No policies, so RLS denies anon/authenticated
-- outright - matching lhq_trial_claims and the other system tables.
--
-- Run against BOTH projects (prod lhq_ls_webhook_events,
-- dev lhq_dev_ls_webhook_events).

create table if not exists lhq_ls_webhook_events (
  payload_hash text primary key,
  event_name   text not null,
  received_at  timestamptz not null default now()
);

alter table lhq_ls_webhook_events enable row level security;

revoke all on lhq_ls_webhook_events from anon, authenticated;

-- The table only exists to answer "seen this exact delivery before", and that
-- question is meaningless once LemonSqueezy has stopped retrying, so old rows
-- are pure noise. Index supports the periodic prune.
create index if not exists lhq_ls_webhook_events_received_at_idx
  on lhq_ls_webhook_events (received_at);
