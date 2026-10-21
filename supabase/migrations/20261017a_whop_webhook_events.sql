-- #1567 Phase 1: what the Whop webhook recording shell needs from the database.
--
-- NOT APPLIED BY MERGING. Applying is a write to the shared database: the owner's word each time, and QA's ok on the timing, because any
-- DDL fires a PostgREST schema reload (#1025) and must not land during a QA pass.
--
-- ADDITIVE ONLY. One new table and one index. Nothing existing is altered, renamed or dropped, so the running app is unaffected before and
-- after, and there is nothing to roll back. (The webhook route answers 500 until the table exists, which keeps every delivery retryable on
-- Whop's side: nothing is lost, and nothing is granted either way.)
--
-- lhq_whop_webhook_events - every verified delivery, stored whole.
--
--   Two jobs, the same as lhq_boomfi_webhook_events (20260930a). It is the REPLAY GUARD: a retry of one message carries the same bytes, so a
--   SHA-256 of the raw body is the primary key. And it is the EVIDENCE: no real Whop payload has been seen, so the code that decides who is
--   Pro will be written from the bodies recorded here, not from an inferred shape (#1422).
--
--   `webhook_id` is the Standard Webhooks `webhook-id` header, which is stable across retries of one message. It is NOT unique: a repeated
--   id with different bytes is still recorded (the evidence is kept) and is findable through the index.
--
--   `body` holds what Whop sent, which includes the payer's name and email. Service-role only: RLS on with no policy, and the grants
--   revoked, so anon and authenticated can neither read nor write it - the same shape as lhq_boomfi_webhook_events.
--
--   `event` and `resource_id` are searchable hints lifted out of the body. They are nullable on purpose: if the real shape differs they
--   stay null and `body` still has the truth.
--
-- Registered in lib/tables.ts as T.whop_webhook_events (prefix-aware: lhq_ prod / lhq_dev_ dev). Run against BOTH projects, ONE SECTION AT A
-- TIME: the prod block below is live, the dev block is commented (the 20260930a convention, so running this file against prod can never
-- create a dev object there).

create table if not exists lhq_whop_webhook_events (
  payload_hash  text        primary key,          -- sha256 of the raw request body
  webhook_id    text,                             -- the `webhook-id` header; null if absent
  event         text,                             -- the body's event type; null = not where expected
  resource_id   text,                             -- the body's resource id; null = not where expected
  body          jsonb       not null,             -- the verified delivery, whole
  received_at   timestamptz not null default now()
);

alter table lhq_whop_webhook_events enable row level security;

revoke all on lhq_whop_webhook_events from anon, authenticated;

create index if not exists lhq_whop_webhook_events_received_at_idx
  on lhq_whop_webhook_events (received_at desc);

create index if not exists lhq_whop_webhook_events_webhook_id_idx
  on lhq_whop_webhook_events (webhook_id);

-- DEV: the same objects under the lhq_dev_ prefix - apply separately.
--
-- create table if not exists lhq_dev_whop_webhook_events (
--   payload_hash  text        primary key,
--   webhook_id    text,
--   event         text,
--   resource_id   text,
--   body          jsonb       not null,
--   received_at   timestamptz not null default now()
-- );
--
-- alter table lhq_dev_whop_webhook_events enable row level security;
--
-- revoke all on lhq_dev_whop_webhook_events from anon, authenticated;
--
-- create index if not exists lhq_dev_whop_webhook_events_received_at_idx
--   on lhq_dev_whop_webhook_events (received_at desc);
--
-- create index if not exists lhq_dev_whop_webhook_events_webhook_id_idx
--   on lhq_dev_whop_webhook_events (webhook_id);
