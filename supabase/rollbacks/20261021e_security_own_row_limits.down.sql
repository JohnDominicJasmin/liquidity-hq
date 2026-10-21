-- DOWN-SCRIPT for supabase/migrations/20261021e_security_own_row_limits.sql (#1632, #1644). Prepared for release v2026.10.21 (#1654).
--
-- NOT APPLIED, and not a migration (this folder is never run automatically). It exists so production has a rollback path for the release's
-- only high-risk database change. Run it only on the owner's word (production needs the owner's approval each time), the same way the
-- migration was run: ONE block per project, the live block on prod (qdpwhnvmhqgzijuwopso), the commented dev block on dev (wdtjhrilakoitfcezxpx).
--
-- WHAT IT UNDOES, in the migration's order: (1) the user_settings column-only grant (re-opens the telegram_chat_id hole, #1632 item 1),
-- (2) the 36 length limits, (3) the per-account row caps and the 50-active-alert cap, (4) the signals write revoke.
-- WHAT IT CANNOT UNDO: nothing to undo for data. 20261021e deleted or rewrote no row, and NOT VALID checks never touched existing rows.
--
-- PARTIAL ROLLBACK is usually the better move. If one real write is refused that should not be, undo only the step that refused it:
--   a 23514 "violates check constraint <table>_<column>_len"  -> alter table public.<table> drop constraint <table>_<column>_len;
--   a P0001 with hint LHQ_ROW_CAP / LHQ_ALERT_CAP             -> drop trigger lhq_row_cap / lhq_active_alert_cap on public.<table>;
--   a 42501 on a settings save                                -> step 1 only.
-- Every statement is if-exists, so a block can be re-run, or run after a partial undo.
--
-- Rolling back the DEPLOY (Render: Rollback to b999f8c) does NOT need this script. The old build works with 20261021e in place: its settings
-- save sends only allowlisted columns, and its Arena signal insert is fire-and-forget.

-- ════ PROD (lhq_) ════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════
begin;

-- 1. lhq_user_settings: the browser roles get table-wide INSERT/UPDATE back (Supabase's default, which is what dev had before 20261021e; prod's
--    earlier grants were never read, #1632). The column grants 20261021e added become redundant and stay (harmless). This re-opens #1632 item 1.
grant insert, update on public.lhq_user_settings to anon, authenticated;

-- 2. The 36 length limits (CHECK ... NOT VALID). Names are the migration's: left(table || '_' || column || '_len', 63).
do $$
declare r record;
begin
  for r in select * from (values
    ('lhq_user_settings', 'default_coin'),
    ('lhq_user_settings', 'default_tf'),
    ('lhq_user_settings', 'trading_experience'),
    ('lhq_user_settings', 'trading_style'),
    ('lhq_user_settings', 'how_heard'),
    ('lhq_user_settings', 'language'),
    ('lhq_user_settings', 'timezone'),
    ('lhq_user_settings', 'display_name'),
    ('lhq_user_settings', 'country'),
    ('lhq_user_settings', 'trading_challenge'),
    ('lhq_user_settings', 'watchlist'),
    ('lhq_user_settings', 'strategy_selection'),
    ('lhq_user_settings', 'strategy_params'),
    ('lhq_user_settings', 'field_updated_at'),
    ('lhq_trades', 'coin'),
    ('lhq_trades', 'direction'),
    ('lhq_trades', 'setup_type'),
    ('lhq_trades', 'result'),
    ('lhq_trades', 'notes'),
    ('lhq_trades', 'session'),
    ('lhq_hypotheses', 'title'),
    ('lhq_hypotheses', 'hypothesis'),
    ('lhq_hypotheses', 'acceptance_criteria'),
    ('lhq_hypotheses', 'status'),
    ('lhq_hypotheses', 'grok_verdict'),
    ('lhq_hypotheses', 'grok_confidence'),
    ('lhq_hypotheses', 'grok_reasoning'),
    ('lhq_hypotheses', 'grok_evidence_assessment'),
    ('lhq_hypotheses', 'grok_next_check'),
    ('lhq_hypothesis_evidence', 'type'),
    ('lhq_hypothesis_evidence', 'content'),
    ('lhq_hypothesis_evidence', 'source'),
    ('lhq_muted_alerts', 'key'),
    ('lhq_price_alerts', 'coin'),
    ('lhq_price_alerts', 'direction'),
    ('lhq_price_alerts', 'label')
  ) as v(tbl, col) loop
    execute format('alter table if exists public.%I drop constraint if exists %I', r.tbl, left(r.tbl || '_' || r.col || '_len', 63));
  end loop;
end $$;

-- 3. The per-account caps: the triggers first, then the two functions (nothing else uses them).
drop trigger if exists lhq_row_cap on public.lhq_trades;
drop trigger if exists lhq_row_cap on public.lhq_hypotheses;
drop trigger if exists lhq_row_cap on public.lhq_hypothesis_evidence;
drop trigger if exists lhq_row_cap on public.lhq_muted_alerts;
drop trigger if exists lhq_row_cap on public.lhq_price_alerts;
drop trigger if exists lhq_active_alert_cap on public.lhq_price_alerts;
drop function if exists public.lhq_enforce_row_cap();
drop function if exists public.lhq_enforce_active_alert_cap();

-- 4. lhq_signals: browser writes back, and the bounded insert policy exactly as 20260807a_rls_grant_hardening.sql created it. Only needed if a
--    build that still writes signals from the browser (production before this release) should keep recording them; that write is
--    fire-and-forget, so without this step the old Arena page works the same and just records nothing.
grant insert, update, delete on public.lhq_signals to anon, authenticated;
drop policy if exists signals_insert_bounded on public.lhq_signals;
create policy signals_insert_bounded on public.lhq_signals
  for insert to authenticated
  with check (
        signal in ('LONG','SHORT','FLAT')
    and confidence between 0 and 100
    and length(coin) between 2 and 12
    and length(coalesce(entry_zone,'')) <= 200
    and length(coalesce(reasoning,''))  <= 4000
    and length(coalesce(session,''))    <= 64
  );

commit;

-- ════ DEV (lhq_dev_) - commented; uncomment to run on the dev project only ═══════════════════════════════════════════════════════════════════
-- begin;
--
-- -- 1. lhq_dev_user_settings: the browser roles get table-wide INSERT/UPDATE back (Supabase's default, which is what dev had before 20261021e; prod's
-- --    earlier grants were never read, #1632). The column grants 20261021e added become redundant and stay (harmless). This re-opens #1632 item 1.
-- grant insert, update on public.lhq_dev_user_settings to anon, authenticated;
--
-- -- 2. The 36 length limits (CHECK ... NOT VALID). Names are the migration's: left(table || '_' || column || '_len', 63).
-- do $$
-- declare r record;
-- begin
--   for r in select * from (values
--     ('lhq_dev_user_settings', 'default_coin'),
--     ('lhq_dev_user_settings', 'default_tf'),
--     ('lhq_dev_user_settings', 'trading_experience'),
--     ('lhq_dev_user_settings', 'trading_style'),
--     ('lhq_dev_user_settings', 'how_heard'),
--     ('lhq_dev_user_settings', 'language'),
--     ('lhq_dev_user_settings', 'timezone'),
--     ('lhq_dev_user_settings', 'display_name'),
--     ('lhq_dev_user_settings', 'country'),
--     ('lhq_dev_user_settings', 'trading_challenge'),
--     ('lhq_dev_user_settings', 'watchlist'),
--     ('lhq_dev_user_settings', 'strategy_selection'),
--     ('lhq_dev_user_settings', 'strategy_params'),
--     ('lhq_dev_user_settings', 'field_updated_at'),
--     ('lhq_dev_trades', 'coin'),
--     ('lhq_dev_trades', 'direction'),
--     ('lhq_dev_trades', 'setup_type'),
--     ('lhq_dev_trades', 'result'),
--     ('lhq_dev_trades', 'notes'),
--     ('lhq_dev_trades', 'session'),
--     ('lhq_dev_hypotheses', 'title'),
--     ('lhq_dev_hypotheses', 'hypothesis'),
--     ('lhq_dev_hypotheses', 'acceptance_criteria'),
--     ('lhq_dev_hypotheses', 'status'),
--     ('lhq_dev_hypotheses', 'grok_verdict'),
--     ('lhq_dev_hypotheses', 'grok_confidence'),
--     ('lhq_dev_hypotheses', 'grok_reasoning'),
--     ('lhq_dev_hypotheses', 'grok_evidence_assessment'),
--     ('lhq_dev_hypotheses', 'grok_next_check'),
--     ('lhq_dev_hypothesis_evidence', 'type'),
--     ('lhq_dev_hypothesis_evidence', 'content'),
--     ('lhq_dev_hypothesis_evidence', 'source'),
--     ('lhq_dev_muted_alerts', 'key'),
--     ('lhq_dev_price_alerts', 'coin'),
--     ('lhq_dev_price_alerts', 'direction'),
--     ('lhq_dev_price_alerts', 'label')
--   ) as v(tbl, col) loop
--     execute format('alter table if exists public.%I drop constraint if exists %I', r.tbl, left(r.tbl || '_' || r.col || '_len', 63));
--   end loop;
-- end $$;
--
-- -- 3. The per-account caps: the triggers first, then the two functions (nothing else uses them).
-- drop trigger if exists lhq_row_cap on public.lhq_dev_trades;
-- drop trigger if exists lhq_row_cap on public.lhq_dev_hypotheses;
-- drop trigger if exists lhq_row_cap on public.lhq_dev_hypothesis_evidence;
-- drop trigger if exists lhq_row_cap on public.lhq_dev_muted_alerts;
-- drop trigger if exists lhq_row_cap on public.lhq_dev_price_alerts;
-- drop trigger if exists lhq_active_alert_cap on public.lhq_dev_price_alerts;
-- drop function if exists public.lhq_enforce_row_cap();
-- drop function if exists public.lhq_enforce_active_alert_cap();
--
-- -- 4. lhq_dev_signals: browser writes back, and the bounded insert policy exactly as 20260807a_rls_grant_hardening.sql created it. Only needed if a
-- --    build that still writes signals from the browser (production before this release) should keep recording them; that write is
-- --    fire-and-forget, so without this step the old Arena page works the same and just records nothing.
-- grant insert, update, delete on public.lhq_dev_signals to anon, authenticated;
-- drop policy if exists signals_insert_bounded on public.lhq_dev_signals;
-- create policy signals_insert_bounded on public.lhq_dev_signals
--   for insert to authenticated
--   with check (
--         signal in ('LONG','SHORT','FLAT')
--     and confidence between 0 and 100
--     and length(coin) between 2 and 12
--     and length(coalesce(entry_zone,'')) <= 200
--     and length(coalesce(reasoning,''))  <= 4000
--     and length(coalesce(session,''))    <= 64
--   );
--
-- commit;
