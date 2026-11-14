-- Arena sound alerts (owner-requested, 2026-11-14): the visitor's answer to the first-visit question, saved with the account's other settings so it follows the account across devices.
--
-- arena_sound is a TRI-STATE, nullable with no default: null = never asked (the Arena shows its one question), true = Allow / switched on, false = Not now / switched off.
-- Old rows stay null, which is exactly "not asked yet". ADDITIVE.
--
-- THE GRANT IS PART OF THIS FILE: 20261021e revoked table-wide insert/update on lhq_user_settings from authenticated and re-granted only an allowlist of columns, so a new column
-- is not writable by the client until it is granted too (the settings PATCH would fail on it). Idempotent.
--
-- ORDER: APPLY BEFORE THE DEPLOY THAT USES IT. Without the column the settings PATCH that carries arena_sound (only sent when the visitor answers or flips the switch) fails and the save toast says so;
-- reading settings is unaffected (select *), and with no value the visitor simply sees the question again.
--
-- Run ONE block per project (per 20260912b): prod block on prod qdpwhnvmhqgzijuwopso, the commented dev block on dev wdtjhrilakoitfcezxpx (qa and staging use it).
--
-- Roll back: alter table lhq_user_settings drop column arena_sound;

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
alter table lhq_user_settings add column if not exists arena_sound boolean;
comment on column lhq_user_settings.arena_sound is 'Arena sound alerts: null = never asked, true = on, false = off.';
grant insert (arena_sound), update (arena_sound) on public.lhq_user_settings to authenticated;

-- ── dev: wdtjhrilakoitfcezxpx (apply separately) ────────────────────────────
-- alter table lhq_dev_user_settings add column if not exists arena_sound boolean;
-- comment on column lhq_dev_user_settings.arena_sound is 'Arena sound alerts: null = never asked, true = on, false = off.';
-- grant insert (arena_sound), update (arena_sound) on public.lhq_dev_user_settings to authenticated;
