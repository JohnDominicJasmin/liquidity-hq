-- Admin audit log: an append-only ledger of every privileged admin action
-- (grant/revoke Pro, ban, reset limit, feature-flag flip). Written ONLY by the
-- service-role client from inside /api/admin/* route handlers - there is no
-- user-facing policy, so RLS-enabled + no policy = no anon/authenticated access,
-- and service-role bypasses RLS.
--
-- The Monitor MVP is read-only and writes nothing here - this table exists so the
-- ledger is ready the moment Phase 2 (account actions) lands. Registered in
-- lib/tables.ts as T.admin_audit_log (prefix-aware: lhq_ prod / lhq_dev_ dev).
--
-- Run once in the Supabase SQL Editor (both tables, matching the repo's actual
-- prefix workflow).

create table if not exists lhq_admin_audit_log (
  id             bigserial   primary key,
  actor_email    text        not null,          -- allowlisted admin who acted
  action         text        not null,          -- 'grant_pro' | 'revoke_pro' | 'reset_limit' | 'flag_set' | ...
  target_user_id uuid,                           -- affected user, when applicable
  detail         jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table lhq_admin_audit_log enable row level security;
create index if not exists lhq_admin_audit_log_created_at_idx on lhq_admin_audit_log (created_at desc);

-- Dev variant
create table if not exists lhq_dev_admin_audit_log (
  id             bigserial   primary key,
  actor_email    text        not null,
  action         text        not null,
  target_user_id uuid,
  detail         jsonb       not null default '{}'::jsonb,
  created_at     timestamptz not null default now()
);

alter table lhq_dev_admin_audit_log enable row level security;
create index if not exists lhq_dev_admin_audit_log_created_at_idx on lhq_dev_admin_audit_log (created_at desc);
