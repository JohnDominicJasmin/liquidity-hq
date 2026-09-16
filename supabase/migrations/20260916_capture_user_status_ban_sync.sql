-- #1157: lhq_user_status / lhq_sync_user_status (and their dev equivalents)
-- exist and run live on BOTH projects - the trigger that keeps a row's
-- `banned` flag in sync whenever `auth.users.banned_until` changes - but had
-- ZERO presence anywhere in supabase/migrations. Found while auditing
-- search_path hardening for #1157: the function's search_path was already
-- correct live, so there was nothing to ALTER, but a repo that cannot
-- reconstruct its own ban-sync path is a gap worth closing on its own.
--
-- This file REPRODUCES what is already live - it does not change any
-- behavior. Read directly off both projects via pg_get_functiondef /
-- pg_get_triggerdef / information_schema, byte-for-byte on prod, and
-- confirmed dev's `lhq_dev_` prefixed equivalents are structurally identical
-- (same columns, same PK/FK, same RLS policy text and USING clause, same
-- trigger condition).
--
-- Idempotent and additive only, safe to run against either project even
-- though it never needs to be: `create table if not exists`,
-- `create or replace function` (exact live body/settings), and a DO block
-- that creates the trigger only when missing. No DROP anywhere.
--
-- Not applied anywhere by this commit - both projects already run this live.

-- ── PROD (project qdpwhnvmhqgzijuwopso) ─────────────────────────────────────

create table if not exists lhq_user_status (
  user_id    uuid not null primary key references auth.users(id) on delete cascade,
  banned     boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table lhq_user_status enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy where polrelid = 'lhq_user_status'::regclass and polname = 'user can read own status'
  ) then
    create policy "user can read own status" on lhq_user_status
      for select using ((select auth.uid()) = user_id);
  end if;
end $$;

create or replace function lhq_sync_user_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into lhq_user_status (user_id, banned, updated_at)
  values (new.id, (new.banned_until is not null and new.banned_until > now()), now())
  on conflict (user_id) do update set banned = excluded.banned, updated_at = excluded.updated_at;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'lhq_user_status_sync'
  ) then
    create trigger lhq_user_status_sync
      after update of banned_until on auth.users
      for each row
      when (old.banned_until is distinct from new.banned_until)
      execute function lhq_sync_user_status();
  end if;
end $$;

-- ── DEV (project wdtjhrilakoitfcezxpx) ──────────────────────────────────────
-- Same shape, lhq_dev_ prefixed, per this project's own naming convention.

create table if not exists lhq_dev_user_status (
  user_id    uuid not null primary key references auth.users(id) on delete cascade,
  banned     boolean not null default false,
  updated_at timestamptz not null default now()
);

alter table lhq_dev_user_status enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policy where polrelid = 'lhq_dev_user_status'::regclass and polname = 'user can read own status'
  ) then
    create policy "user can read own status" on lhq_dev_user_status
      for select using ((select auth.uid()) = user_id);
  end if;
end $$;

create or replace function lhq_dev_sync_user_status()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into lhq_dev_user_status (user_id, banned, updated_at)
  values (new.id, (new.banned_until is not null and new.banned_until > now()), now())
  on conflict (user_id) do update
    set banned = excluded.banned, updated_at = excluded.updated_at;
  return new;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgrelid = 'auth.users'::regclass and tgname = 'lhq_dev_user_status_sync'
  ) then
    create trigger lhq_dev_user_status_sync
      after update of banned_until on auth.users
      for each row
      when (old.banned_until is distinct from new.banned_until)
      execute function lhq_dev_sync_user_status();
  end if;
end $$;
