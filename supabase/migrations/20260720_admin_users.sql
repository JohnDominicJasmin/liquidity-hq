-- Admin panel membership + roles. Replaces the ADMIN_EMAILS env allowlist as the
-- source of truth for who can access /ops. Each row maps a Supabase auth user to
-- an admin role, so staff can be added/removed from the panel (no redeploy).
-- ADMIN_EMAILS stays only as an emergency bootstrap owner (see lib/admin-auth.ts).
--
-- Service-role only: RLS enabled, no policies, so anon/authenticated clients get
-- nothing; only the service-role client (inside /api/ops/* route handlers) reads
-- or writes it. Passwords are NOT stored here - they live in Supabase Auth
-- (auth.users); this table only holds role/active membership.
--
-- Run once in the Supabase SQL Editor (both prefixed tables).

create table if not exists lhq_admin_users (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  role        text        not null default 'staff',   -- 'owner' | 'staff'
  active      boolean     not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table lhq_admin_users enable row level security;
create index if not exists lhq_admin_users_email_idx on lhq_admin_users (email);

-- Dev variant
create table if not exists lhq_dev_admin_users (
  user_id     uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  role        text        not null default 'staff',
  active      boolean     not null default true,
  created_by  uuid,
  created_at  timestamptz not null default now()
);
alter table lhq_dev_admin_users enable row level security;
create index if not exists lhq_dev_admin_users_email_idx on lhq_dev_admin_users (email);

-- After creating tables via the SQL editor, refresh PostgREST's schema cache:
--   notify pgrst, 'reload schema';