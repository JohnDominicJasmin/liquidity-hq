-- THE FIVE PRODUCTION TABLES THAT HAD NO CREATE TABLE ANYWHERE IN THIS REPOSITORY (#1413, 2026-11-13).
--
--   lhq_app_config, lhq_hypotheses, lhq_hypothesis_evidence, lhq_muted_alerts, lhq_price_alerts
--
-- THE GAP: rows, constraints and policies for these exist in production that no migration in this tree created (lib/backupTables.ts
-- says so for four of them; a grep of supabase/ finds the fifth, muted_alerts, too). So a database rebuilt from this directory could not hold a
-- restore of the backup, and a replay of 20260617_price_alerts_user_id.sql and 20261021e_security_own_row_limits.sql would fail on a missing table.
--
-- WHERE IT IS WRITTEN FROM: PROD'S OWN CATALOG, read-only by PM on 2026-11-13 (columns, constraints, indexes, RLS switch, policies, grants,
-- triggers; no table data). Not typed from memory.
--
-- WHY THIS FILE IS NAMED 20260616a: it sorts BEFORE the first migration that touches any of these tables (20260617_price_alerts_user_id), so a replay in
-- file order finds the tables there. It deliberately holds ONLY the table, its primary key, foreign keys, enum CHECKs, indexes, RLS, policies and
-- grants. THE ROW-CAP / ACTIVE-ALERT-CAP TRIGGERS AND THE NOT VALID LENGTH CHECKS ARE NOT HERE: 20261021e_security_own_row_limits.sql already creates them
-- (and needs these tables to exist first, which this file now guarantees). Re-stating them here would only fork the definition.
--
-- A NO-OP WHERE THE TABLES EXIST (production): CREATE TABLE / CREATE INDEX IF NOT EXISTS, ENABLE ROW LEVEL SECURITY is idempotent, each policy is created only if
-- it is absent (DO block against pg_policies), and the grants already hold on prod.
-- THE ONE EFFECT ON AN EXISTING DATABASE is the grants, on DEV: dev's lhq_dev_price_alerts grants the browser role only SELECT and INSERT, so the route's soft-delete
-- UPDATE is refused (HTTP 500, QA 2026-11-13). The grant lines below restore prod parity there. Drop the dev block's grant lines if that is not wanted.
-- NOTE FOR A SECURITY READER: parity means anon holds table-wide INSERT/UPDATE/DELETE on four of these tables, held back only by RLS (the policies are
-- 'to public' on three of them). That is production's live state, recorded as found, not a recommendation.
--
-- NOT APPLIED. Apply ONE block per project: the live block on prod (qdpwhnvmhqgzijuwopso), the commented dev block on dev (wdtjhrilakoitfcezxpx).
-- Rollback: nothing to undo on an existing table (it is a no-op); a table this file created can be dropped.

begin;

-- 1. lhq_app_config: feature flags and kill switches. RLS on with NO policy: only the service role reads or writes it.
create table if not exists public.lhq_app_config (
  key        text        primary key,
  value      jsonb       not null default '{}'::jsonb,
  updated_by text,
  updated_at timestamptz not null default now()
);
alter table public.lhq_app_config enable row level security;
grant select, references, trigger on public.lhq_app_config to anon, authenticated;
grant all on public.lhq_app_config to service_role;

-- 2. lhq_hypotheses
create table if not exists public.lhq_hypotheses (
  id                       uuid        primary key default gen_random_uuid(),
  user_id                  uuid        not null references auth.users(id),
  title                    text        not null,
  hypothesis               text        not null,
  acceptance_criteria      jsonb       not null default '[]'::jsonb,
  status                   text        not null default 'active' check (status = any (array['active','confirmed','disconfirmed','expired'])),
  target_date              date,
  grok_verdict             text,
  grok_reasoning           text,
  grok_evidence_assessment text,
  grok_confidence          text,
  grok_next_check          text,
  grok_last_run            timestamptz,
  created_at               timestamptz not null default now(),
  updated_at               timestamptz not null default now()
);
create index if not exists lhq_hypotheses_user_id_idx on public.lhq_hypotheses (user_id);
alter table public.lhq_hypotheses enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_hypotheses' and policyname = 'owner_all_hypotheses') then
    create policy "owner_all_hypotheses" on public.lhq_hypotheses as permissive for all to public using ((select auth.uid()) = user_id);
  end if;
end $$;
grant insert, select, update, delete, references, trigger on public.lhq_hypotheses to anon, authenticated;
grant all on public.lhq_hypotheses to service_role;

-- 3. lhq_hypothesis_evidence
create table if not exists public.lhq_hypothesis_evidence (
  id            uuid        primary key default gen_random_uuid(),
  hypothesis_id uuid        not null references public.lhq_hypotheses(id),
  user_id       uuid        not null references auth.users(id),
  type          text        not null check (type = any (array['supporting','against','neutral'])),
  content       text        not null,
  source        text,
  created_at    timestamptz not null default now()
);
create index if not exists lhq_hypothesis_evidence_hypothesis_id_idx on public.lhq_hypothesis_evidence (hypothesis_id);
create index if not exists lhq_hypothesis_evidence_user_id_idx on public.lhq_hypothesis_evidence (user_id);
alter table public.lhq_hypothesis_evidence enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_hypothesis_evidence' and policyname = 'owner_all_evidence') then
    create policy "owner_all_evidence" on public.lhq_hypothesis_evidence as permissive for all to public using ((select auth.uid()) = user_id);
  end if;
end $$;
grant insert, select, update, delete, references, trigger on public.lhq_hypothesis_evidence to anon, authenticated;
grant all on public.lhq_hypothesis_evidence to service_role;

-- 4. lhq_muted_alerts: what each user has chosen NOT to be told about. Composite primary key (user_id, key).
create table if not exists public.lhq_muted_alerts (
  key        text        not null,
  created_at timestamptz default now(),
  user_id    uuid        not null references auth.users(id) on delete cascade,
  primary key (user_id, key)
);
create index if not exists lhq_muted_alerts_user_id_idx on public.lhq_muted_alerts (user_id);
alter table public.lhq_muted_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_muted_alerts' and policyname = 'users manage own muted alerts') then
    create policy "users manage own muted alerts" on public.lhq_muted_alerts as permissive for all to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
grant insert, select, update, delete, references, trigger on public.lhq_muted_alerts to anon, authenticated;
grant all on public.lhq_muted_alerts to service_role;

-- 5. lhq_price_alerts: alerts the user created by hand. id is GENERATED BY DEFAULT AS IDENTITY. user_id may be NULL (legacy rows).
create table if not exists public.lhq_price_alerts (
  id           bigint      generated by default as identity primary key,
  coin         text        not null,
  target_price numeric     not null,
  direction    text        not null,
  triggered_at timestamptz,
  user_id      uuid        references auth.users(id),
  label        text        default '',
  active       boolean     default true,
  created_at   timestamptz default now()
);
create index if not exists lhq_price_alerts_user_id_idx on public.lhq_price_alerts (user_id);
alter table public.lhq_price_alerts enable row level security;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_price_alerts' and policyname = 'price_alerts_select_own') then
    create policy "price_alerts_select_own" on public.lhq_price_alerts as permissive for select to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_price_alerts' and policyname = 'price_alerts_insert_own') then
    create policy "price_alerts_insert_own" on public.lhq_price_alerts as permissive for insert to authenticated with check ((select auth.uid()) = user_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_price_alerts' and policyname = 'price_alerts_update_own') then
    create policy "price_alerts_update_own" on public.lhq_price_alerts as permissive for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
  end if;
end $$;
do $$ begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_price_alerts' and policyname = 'price_alerts_delete_own') then
    create policy "price_alerts_delete_own" on public.lhq_price_alerts as permissive for delete to authenticated using ((select auth.uid()) = user_id);
  end if;
end $$;
grant insert, select, update, delete, references, trigger on public.lhq_price_alerts to anon, authenticated;
grant all on public.lhq_price_alerts to service_role;

commit;

-- ════ DEV: the same block against the lhq_dev_ tables. ════
-- begin;
--
-- -- 1. lhq_dev_app_config: feature flags and kill switches. RLS on with NO policy: only the service role reads or writes it.
-- create table if not exists public.lhq_dev_app_config (
--   key        text        primary key,
--   value      jsonb       not null default '{}'::jsonb,
--   updated_by text,
--   updated_at timestamptz not null default now()
-- );
-- alter table public.lhq_dev_app_config enable row level security;
-- grant select, references, trigger on public.lhq_dev_app_config to anon, authenticated;
-- grant all on public.lhq_dev_app_config to service_role;
--
-- -- 2. lhq_dev_hypotheses
-- create table if not exists public.lhq_dev_hypotheses (
--   id                       uuid        primary key default gen_random_uuid(),
--   user_id                  uuid        not null references auth.users(id),
--   title                    text        not null,
--   hypothesis               text        not null,
--   acceptance_criteria      jsonb       not null default '[]'::jsonb,
--   status                   text        not null default 'active' check (status = any (array['active','confirmed','disconfirmed','expired'])),
--   target_date              date,
--   grok_verdict             text,
--   grok_reasoning           text,
--   grok_evidence_assessment text,
--   grok_confidence          text,
--   grok_next_check          text,
--   grok_last_run            timestamptz,
--   created_at               timestamptz not null default now(),
--   updated_at               timestamptz not null default now()
-- );
-- create index if not exists lhq_dev_hypotheses_user_id_idx on public.lhq_dev_hypotheses (user_id);
-- alter table public.lhq_dev_hypotheses enable row level security;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_hypotheses' and policyname = 'owner_all_hypotheses') then
--     create policy "owner_all_hypotheses" on public.lhq_dev_hypotheses as permissive for all to public using ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- grant insert, select, update, delete, references, trigger on public.lhq_dev_hypotheses to anon, authenticated;
-- grant all on public.lhq_dev_hypotheses to service_role;
--
-- -- 3. lhq_dev_hypothesis_evidence
-- create table if not exists public.lhq_dev_hypothesis_evidence (
--   id            uuid        primary key default gen_random_uuid(),
--   hypothesis_id uuid        not null references public.lhq_dev_hypotheses(id),
--   user_id       uuid        not null references auth.users(id),
--   type          text        not null check (type = any (array['supporting','against','neutral'])),
--   content       text        not null,
--   source        text,
--   created_at    timestamptz not null default now()
-- );
-- create index if not exists lhq_dev_hypothesis_evidence_hypothesis_id_idx on public.lhq_dev_hypothesis_evidence (hypothesis_id);
-- create index if not exists lhq_dev_hypothesis_evidence_user_id_idx on public.lhq_dev_hypothesis_evidence (user_id);
-- alter table public.lhq_dev_hypothesis_evidence enable row level security;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_hypothesis_evidence' and policyname = 'owner_all_evidence') then
--     create policy "owner_all_evidence" on public.lhq_dev_hypothesis_evidence as permissive for all to public using ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- grant insert, select, update, delete, references, trigger on public.lhq_dev_hypothesis_evidence to anon, authenticated;
-- grant all on public.lhq_dev_hypothesis_evidence to service_role;
--
-- -- 4. lhq_dev_muted_alerts: what each user has chosen NOT to be told about. Composite primary key (user_id, key).
-- create table if not exists public.lhq_dev_muted_alerts (
--   key        text        not null,
--   created_at timestamptz default now(),
--   user_id    uuid        not null references auth.users(id) on delete cascade,
--   primary key (user_id, key)
-- );
-- create index if not exists lhq_dev_muted_alerts_user_id_idx on public.lhq_dev_muted_alerts (user_id);
-- alter table public.lhq_dev_muted_alerts enable row level security;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_muted_alerts' and policyname = 'users manage own muted alerts') then
--     create policy "users manage own muted alerts" on public.lhq_dev_muted_alerts as permissive for all to public using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- grant insert, select, update, delete, references, trigger on public.lhq_dev_muted_alerts to anon, authenticated;
-- grant all on public.lhq_dev_muted_alerts to service_role;
--
-- -- 5. lhq_dev_price_alerts: alerts the user created by hand. id is GENERATED BY DEFAULT AS IDENTITY. user_id may be NULL (legacy rows).
-- create table if not exists public.lhq_dev_price_alerts (
--   id           bigint      generated by default as identity primary key,
--   coin         text        not null,
--   target_price numeric     not null,
--   direction    text        not null,
--   triggered_at timestamptz,
--   user_id      uuid        references auth.users(id),
--   label        text        default '',
--   active       boolean     default true,
--   created_at   timestamptz default now()
-- );
-- create index if not exists lhq_dev_price_alerts_user_id_idx on public.lhq_dev_price_alerts (user_id);
-- alter table public.lhq_dev_price_alerts enable row level security;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_price_alerts' and policyname = 'price_alerts_select_own') then
--     create policy "price_alerts_select_own" on public.lhq_dev_price_alerts as permissive for select to authenticated using ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_price_alerts' and policyname = 'price_alerts_insert_own') then
--     create policy "price_alerts_insert_own" on public.lhq_dev_price_alerts as permissive for insert to authenticated with check ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_price_alerts' and policyname = 'price_alerts_update_own') then
--     create policy "price_alerts_update_own" on public.lhq_dev_price_alerts as permissive for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- do $$ begin
--   if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'lhq_dev_price_alerts' and policyname = 'price_alerts_delete_own') then
--     create policy "price_alerts_delete_own" on public.lhq_dev_price_alerts as permissive for delete to authenticated using ((select auth.uid()) = user_id);
--   end if;
-- end $$;
-- grant insert, select, update, delete, references, trigger on public.lhq_dev_price_alerts to anon, authenticated;
-- grant all on public.lhq_dev_price_alerts to service_role;
--
-- commit;
