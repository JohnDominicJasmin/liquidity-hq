-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project BEFORE the deploy that uses it: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx (qa and staging use it).
--
-- The Arena sound picker (owner, PM-approved spec 2026-11-18): which of 8 sounds, its volume, and which triggers play
-- ({ sound, volume, on: { signal, move, volume } }). One nullable jsonb column beside the master switch arena_sound; null = the defaults
-- (lib/arenaSoundPrefs.ts), which play what the Arena played before the picker. ADDITIVE.
--
-- THE GRANT IS PART OF THIS FILE (same as 20261114d): the client can write only allowlisted columns of user_settings, so a new column needs its
-- own insert/update grant or the settings PATCH fails on it. Idempotent.
--
-- Without the column the PATCH that carries arena_sound_prefs fails (the save toast says so); reading settings is unaffected and the
-- defaults play.
--
-- Roll back: alter table lhq_user_settings drop column arena_sound_prefs;  (dev: lhq_dev_user_settings)

-- ===================== PROD (qdpwhnvmhqgzijuwopso) =====================
alter table lhq_user_settings add column if not exists arena_sound_prefs jsonb;
comment on column lhq_user_settings.arena_sound_prefs is 'Arena sound picker: { sound, volume 0-1, on: { signal, move, volume } }; null = defaults.';
grant insert (arena_sound_prefs), update (arena_sound_prefs) on public.lhq_user_settings to authenticated;

-- ===================== DEV (wdtjhrilakoitfcezxpx) =====================
alter table lhq_dev_user_settings add column if not exists arena_sound_prefs jsonb;
comment on column lhq_dev_user_settings.arena_sound_prefs is 'Arena sound picker: { sound, volume 0-1, on: { signal, move, volume } }; null = defaults.';
grant insert (arena_sound_prefs), update (arena_sound_prefs) on public.lhq_dev_user_settings to authenticated;
