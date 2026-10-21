-- #1632 (security audit) - ONE DDL window, as PM asked (2026-10-21): item 1 + H1 + M9. Nothing here deletes or rewrites a row.
--
--   1. item 1  a signed-in user could write their own telegram_chat_id straight to the table (own-row UPDATE with no column restriction) and point
--              the official bot's alerts at someone else's Telegram. Now: table-wide INSERT/UPDATE revoked from anon/authenticated; INSERT/UPDATE
--              granted back on the columns /api/settings writes, telegram_chat_id excluded (the link-code flow writes it with the service role).
--   2. H1      length limits (CHECK ... NOT VALID) on the own-row tables, so one account cannot fill the database (the free plan turns read-only at
--              500 MB). Limits are generous for real use; see the PR for the numbers.
--   3. H1      a per-account row cap trigger: trades 3000, hypotheses 200, evidence 2000, muted alert keys 500, price alerts 1000 in total.
--   4. M9      at most 50 ACTIVE price alerts per account (the route says so first; the trigger is the backstop for direct writes).
--   5. H1      INSERT/UPDATE/DELETE on signals revoked from the browser roles (the Arena page's insert is removed in the same PR).
--   NOT HERE (PM): the liq_events insert revoke waits until liquidations are collected server-side.
--
-- PROD GRANTS ARE UNVERIFIED (#1632): every step is written to work whatever the live grants are (revoke-then-grant, if-exists, column lookups).
-- All-or-nothing: one transaction per block.
--
-- NOT APPLIED. Dev: only in a window QA gives (not mid-regression), then watch the logs for 5 minutes (PM). Prod: the owner's word for the release.
-- Apply ONE block per project: the live block on prod (qdpwhnvmhqgzijuwopso), the commented dev block on dev (wdtjhrilakoitfcezxpx).
--
-- ROLLBACK (if a real write is refused that should not be):
--   grant insert, update on public.<p>user_settings to authenticated;              -- restores the old table-wide grant
--   alter table public.<p>... drop constraint <name>;                               -- any single length limit
--   drop trigger lhq_row_cap on public.<p><table>; drop trigger lhq_active_alert_cap on public.<p>price_alerts;
--   grant insert on public.<p>signals to authenticated;                            -- only if the browser insert is put back

begin;

-- 1. #1632 item 1: lhq_user_settings is written only through /api/settings (and the server's own service-role routes).
--    Table-wide INSERT/UPDATE from the browser roles goes; INSERT/UPDATE comes back for the allowlisted columns only, which is exactly
--    /api/settings' ALLOWED list plus user_id / updated_at / field_updated_at (PostgREST's upsert needs UPDATE on every column it sends).
--    telegram_chat_id is NOT in it: only the Telegram link-code flow (service role) can set it. Columns missing on this database are skipped.
do $$
declare cols text;
begin
  select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
  from information_schema.columns
  where table_schema = 'public' and table_name = 'lhq_user_settings'
    and column_name = any (array['user_id', 'account_size', 'risk_pct', 'default_coin', 'default_tf', 'fr_threshold', 'fng_fear', 'fng_greed', 'rsi_ob', 'rsi_os', 'squeeze_threshold', 'anti_chop_enabled', 'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist', 'display_name', 'country', 'trading_challenge', 'language', 'timezone', 'strategy_selection', 'strategy_params', 'updated_at', 'field_updated_at']);
  if cols is null then raise exception 'lhq_user_settings: no allowlisted column found, refusing to revoke'; end if;
  execute 'revoke insert, update on public.lhq_user_settings from anon, authenticated';
  execute format('grant insert (%s), update (%s) on public.lhq_user_settings to authenticated', cols, cols);
end $$;

-- 2. H1: text and json length limits on the own-row tables. NOT VALID: existing rows are not re-checked (nothing is rejected or rewritten
--    by this migration); every NEW write and every update of a row must fit. A column missing on this database is skipped.
do $$
declare r record; cname text;
begin
  for r in select * from (values
    ('lhq_user_settings', 'default_coin', 20),
    ('lhq_user_settings', 'default_tf', 8),
    ('lhq_user_settings', 'trading_experience', 200),
    ('lhq_user_settings', 'trading_style', 200),
    ('lhq_user_settings', 'how_heard', 200),
    ('lhq_user_settings', 'language', 16),
    ('lhq_user_settings', 'timezone', 64),
    ('lhq_user_settings', 'display_name', 64),
    ('lhq_user_settings', 'country', 64),
    ('lhq_user_settings', 'trading_challenge', 500),
    ('lhq_user_settings', 'watchlist', 4000),
    ('lhq_user_settings', 'strategy_selection', 4000),
    ('lhq_user_settings', 'strategy_params', 20000),
    ('lhq_user_settings', 'field_updated_at', 8000),
    ('lhq_trades', 'coin', 20),
    ('lhq_trades', 'direction', 10),
    ('lhq_trades', 'setup_type', 100),
    ('lhq_trades', 'result', 20),
    ('lhq_trades', 'notes', 2000),
    ('lhq_trades', 'session', 64),
    ('lhq_hypotheses', 'title', 300),
    ('lhq_hypotheses', 'hypothesis', 4000),
    ('lhq_hypotheses', 'acceptance_criteria', 8000),
    ('lhq_hypotheses', 'status', 32),
    ('lhq_hypotheses', 'grok_verdict', 64),
    ('lhq_hypotheses', 'grok_confidence', 64),
    ('lhq_hypotheses', 'grok_reasoning', 20000),
    ('lhq_hypotheses', 'grok_evidence_assessment', 20000),
    ('lhq_hypotheses', 'grok_next_check', 4000),
    ('lhq_hypothesis_evidence', 'type', 32),
    ('lhq_hypothesis_evidence', 'content', 4000),
    ('lhq_hypothesis_evidence', 'source', 2000),
    ('lhq_muted_alerts', 'key', 100),
    ('lhq_price_alerts', 'coin', 20),
    ('lhq_price_alerts', 'direction', 10),
    ('lhq_price_alerts', 'label', 200)
  ) as v(tbl, col, maxlen) loop
    cname := left(r.tbl || '_' || r.col || '_len', 63);
    if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = r.col)
       and not exists (select 1 from pg_constraint where conname = cname) then
      execute format('alter table public.%I add constraint %I check (length(coalesce(%I::text, %L)) <= %s) not valid', r.tbl, cname, r.col, '', r.maxlen);
    end if;
  end loop;
end $$;

-- 3. H1: a per-account row cap on the own-row tables. A direct REST insert past the cap is refused with SQLSTATE P0001, hint LHQ_ROW_CAP.
--    The advisory lock makes two simultaneous inserts by one account count one after the other. A NULL user_id (legacy rows) is not capped.
create or replace function public.lhq_enforce_row_cap() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare cap int := tg_argv[0]::int; n int;
begin
  if new.user_id is null then return new; end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.user_id::text));
  execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name) into n using new.user_id;
  if n >= cap then
    raise exception 'row limit reached for this account (% rows in %)', cap, tg_table_name using errcode = 'P0001', hint = 'LHQ_ROW_CAP';
  end if;
  return new;
end $fn$;
revoke all on function public.lhq_enforce_row_cap() from public, anon, authenticated;
drop trigger if exists lhq_row_cap on public.lhq_trades;
create trigger lhq_row_cap before insert on public.lhq_trades for each row execute function public.lhq_enforce_row_cap('3000');
drop trigger if exists lhq_row_cap on public.lhq_hypotheses;
create trigger lhq_row_cap before insert on public.lhq_hypotheses for each row execute function public.lhq_enforce_row_cap('200');
drop trigger if exists lhq_row_cap on public.lhq_hypothesis_evidence;
create trigger lhq_row_cap before insert on public.lhq_hypothesis_evidence for each row execute function public.lhq_enforce_row_cap('2000');
drop trigger if exists lhq_row_cap on public.lhq_muted_alerts;
create trigger lhq_row_cap before insert on public.lhq_muted_alerts for each row execute function public.lhq_enforce_row_cap('500');
drop trigger if exists lhq_row_cap on public.lhq_price_alerts;
create trigger lhq_row_cap before insert on public.lhq_price_alerts for each row execute function public.lhq_enforce_row_cap('1000');

-- 4. M9: at most 50 ACTIVE price alerts per account (the cron reads active alerts only, and a flood of them can push other users'
--    past its read limit). Counted on insert and when an alert is switched back on; an already-active row being edited is not counted again.
create or replace function public.lhq_enforce_active_alert_cap() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare cap int := tg_argv[0]::int; n int;
begin
  if new.user_id is null or coalesce(new.active, true) = false then return new; end if;
  if tg_op = 'UPDATE' and coalesce(old.active, true) = true then return new; end if;
  perform pg_advisory_xact_lock(hashtext(tg_table_name || ':active:' || new.user_id::text));
  execute format('select count(*) from %I.%I where user_id = $1 and coalesce(active, true) = true', tg_table_schema, tg_table_name) into n using new.user_id;
  if n >= cap then
    raise exception 'active price alert limit reached (%)', cap using errcode = 'P0001', hint = 'LHQ_ALERT_CAP';
  end if;
  return new;
end $fn$;
revoke all on function public.lhq_enforce_active_alert_cap() from public, anon, authenticated;
drop trigger if exists lhq_active_alert_cap on public.lhq_price_alerts;
create trigger lhq_active_alert_cap before insert or update of active on public.lhq_price_alerts for each row execute function public.lhq_enforce_active_alert_cap('50');

-- 5. H1: the browser no longer writes lhq_signals (nothing in the app reads it; it was an anonymous-ish write-only log, now removed from
--    app/arena/page.tsx). SELECT is untouched.
revoke insert, update, delete on public.lhq_signals from anon, authenticated;
drop policy if exists signals_insert_bounded on public.lhq_signals;

commit;

-- ════ DEV: the same block against the lhq_dev_ tables. ════
--
-- begin;
--
-- -- 1. #1632 item 1: lhq_dev_user_settings is written only through /api/settings (and the server's own service-role routes).
-- --    Table-wide INSERT/UPDATE from the browser roles goes; INSERT/UPDATE comes back for the allowlisted columns only, which is exactly
-- --    /api/settings' ALLOWED list plus user_id / updated_at / field_updated_at (PostgREST's upsert needs UPDATE on every column it sends).
-- --    telegram_chat_id is NOT in it: only the Telegram link-code flow (service role) can set it. Columns missing on this database are skipped.
-- do $$
-- declare cols text;
-- begin
--   select string_agg(quote_ident(column_name), ', ' order by ordinal_position) into cols
--   from information_schema.columns
--   where table_schema = 'public' and table_name = 'lhq_dev_user_settings'
--     and column_name = any (array['user_id', 'account_size', 'risk_pct', 'default_coin', 'default_tf', 'fr_threshold', 'fng_fear', 'fng_greed', 'rsi_ob', 'rsi_os', 'squeeze_threshold', 'anti_chop_enabled', 'beginner_mode', 'trading_experience', 'trading_style', 'how_heard', 'watchlist', 'display_name', 'country', 'trading_challenge', 'language', 'timezone', 'strategy_selection', 'strategy_params', 'updated_at', 'field_updated_at']);
--   if cols is null then raise exception 'lhq_dev_user_settings: no allowlisted column found, refusing to revoke'; end if;
--   execute 'revoke insert, update on public.lhq_dev_user_settings from anon, authenticated';
--   execute format('grant insert (%s), update (%s) on public.lhq_dev_user_settings to authenticated', cols, cols);
-- end $$;
--
-- -- 2. H1: text and json length limits on the own-row tables. NOT VALID: existing rows are not re-checked (nothing is rejected or rewritten
-- --    by this migration); every NEW write and every update of a row must fit. A column missing on this database is skipped.
-- do $$
-- declare r record; cname text;
-- begin
--   for r in select * from (values
--     ('lhq_dev_user_settings', 'default_coin', 20),
--     ('lhq_dev_user_settings', 'default_tf', 8),
--     ('lhq_dev_user_settings', 'trading_experience', 200),
--     ('lhq_dev_user_settings', 'trading_style', 200),
--     ('lhq_dev_user_settings', 'how_heard', 200),
--     ('lhq_dev_user_settings', 'language', 16),
--     ('lhq_dev_user_settings', 'timezone', 64),
--     ('lhq_dev_user_settings', 'display_name', 64),
--     ('lhq_dev_user_settings', 'country', 64),
--     ('lhq_dev_user_settings', 'trading_challenge', 500),
--     ('lhq_dev_user_settings', 'watchlist', 4000),
--     ('lhq_dev_user_settings', 'strategy_selection', 4000),
--     ('lhq_dev_user_settings', 'strategy_params', 20000),
--     ('lhq_dev_user_settings', 'field_updated_at', 8000),
--     ('lhq_dev_trades', 'coin', 20),
--     ('lhq_dev_trades', 'direction', 10),
--     ('lhq_dev_trades', 'setup_type', 100),
--     ('lhq_dev_trades', 'result', 20),
--     ('lhq_dev_trades', 'notes', 2000),
--     ('lhq_dev_trades', 'session', 64),
--     ('lhq_dev_hypotheses', 'title', 300),
--     ('lhq_dev_hypotheses', 'hypothesis', 4000),
--     ('lhq_dev_hypotheses', 'acceptance_criteria', 8000),
--     ('lhq_dev_hypotheses', 'status', 32),
--     ('lhq_dev_hypotheses', 'grok_verdict', 64),
--     ('lhq_dev_hypotheses', 'grok_confidence', 64),
--     ('lhq_dev_hypotheses', 'grok_reasoning', 20000),
--     ('lhq_dev_hypotheses', 'grok_evidence_assessment', 20000),
--     ('lhq_dev_hypotheses', 'grok_next_check', 4000),
--     ('lhq_dev_hypothesis_evidence', 'type', 32),
--     ('lhq_dev_hypothesis_evidence', 'content', 4000),
--     ('lhq_dev_hypothesis_evidence', 'source', 2000),
--     ('lhq_dev_muted_alerts', 'key', 100),
--     ('lhq_dev_price_alerts', 'coin', 20),
--     ('lhq_dev_price_alerts', 'direction', 10),
--     ('lhq_dev_price_alerts', 'label', 200)
--   ) as v(tbl, col, maxlen) loop
--     cname := left(r.tbl || '_' || r.col || '_len', 63);
--     if exists (select 1 from information_schema.columns where table_schema = 'public' and table_name = r.tbl and column_name = r.col)
--        and not exists (select 1 from pg_constraint where conname = cname) then
--       execute format('alter table public.%I add constraint %I check (length(coalesce(%I::text, %L)) <= %s) not valid', r.tbl, cname, r.col, '', r.maxlen);
--     end if;
--   end loop;
-- end $$;
--
-- -- 3. H1: a per-account row cap on the own-row tables. A direct REST insert past the cap is refused with SQLSTATE P0001, hint LHQ_ROW_CAP.
-- --    The advisory lock makes two simultaneous inserts by one account count one after the other. A NULL user_id (legacy rows) is not capped.
-- create or replace function public.lhq_enforce_row_cap() returns trigger
-- language plpgsql security definer set search_path = public as $fn$
-- declare cap int := tg_argv[0]::int; n int;
-- begin
--   if new.user_id is null then return new; end if;
--   perform pg_advisory_xact_lock(hashtext(tg_table_name || ':' || new.user_id::text));
--   execute format('select count(*) from %I.%I where user_id = $1', tg_table_schema, tg_table_name) into n using new.user_id;
--   if n >= cap then
--     raise exception 'row limit reached for this account (% rows in %)', cap, tg_table_name using errcode = 'P0001', hint = 'LHQ_ROW_CAP';
--   end if;
--   return new;
-- end $fn$;
-- revoke all on function public.lhq_enforce_row_cap() from public, anon, authenticated;
-- drop trigger if exists lhq_row_cap on public.lhq_dev_trades;
-- create trigger lhq_row_cap before insert on public.lhq_dev_trades for each row execute function public.lhq_enforce_row_cap('3000');
-- drop trigger if exists lhq_row_cap on public.lhq_dev_hypotheses;
-- create trigger lhq_row_cap before insert on public.lhq_dev_hypotheses for each row execute function public.lhq_enforce_row_cap('200');
-- drop trigger if exists lhq_row_cap on public.lhq_dev_hypothesis_evidence;
-- create trigger lhq_row_cap before insert on public.lhq_dev_hypothesis_evidence for each row execute function public.lhq_enforce_row_cap('2000');
-- drop trigger if exists lhq_row_cap on public.lhq_dev_muted_alerts;
-- create trigger lhq_row_cap before insert on public.lhq_dev_muted_alerts for each row execute function public.lhq_enforce_row_cap('500');
-- drop trigger if exists lhq_row_cap on public.lhq_dev_price_alerts;
-- create trigger lhq_row_cap before insert on public.lhq_dev_price_alerts for each row execute function public.lhq_enforce_row_cap('1000');
--
-- -- 4. M9: at most 50 ACTIVE price alerts per account (the cron reads active alerts only, and a flood of them can push other users'
-- --    past its read limit). Counted on insert and when an alert is switched back on; an already-active row being edited is not counted again.
-- create or replace function public.lhq_enforce_active_alert_cap() returns trigger
-- language plpgsql security definer set search_path = public as $fn$
-- declare cap int := tg_argv[0]::int; n int;
-- begin
--   if new.user_id is null or coalesce(new.active, true) = false then return new; end if;
--   if tg_op = 'UPDATE' and coalesce(old.active, true) = true then return new; end if;
--   perform pg_advisory_xact_lock(hashtext(tg_table_name || ':active:' || new.user_id::text));
--   execute format('select count(*) from %I.%I where user_id = $1 and coalesce(active, true) = true', tg_table_schema, tg_table_name) into n using new.user_id;
--   if n >= cap then
--     raise exception 'active price alert limit reached (%)', cap using errcode = 'P0001', hint = 'LHQ_ALERT_CAP';
--   end if;
--   return new;
-- end $fn$;
-- revoke all on function public.lhq_enforce_active_alert_cap() from public, anon, authenticated;
-- drop trigger if exists lhq_active_alert_cap on public.lhq_dev_price_alerts;
-- create trigger lhq_active_alert_cap before insert or update of active on public.lhq_dev_price_alerts for each row execute function public.lhq_enforce_active_alert_cap('50');
--
-- -- 5. H1: the browser no longer writes lhq_dev_signals (nothing in the app reads it; it was an anonymous-ish write-only log, now removed from
-- --    app/arena/page.tsx). SELECT is untouched.
-- revoke insert, update, delete on public.lhq_dev_signals from anon, authenticated;
-- drop policy if exists signals_insert_bounded on public.lhq_dev_signals;
--
-- commit;
