-- Per-user IANA timezone, so Telegram alerts can be stamped in each
-- subscriber's own clock instead of one global timezone.
--
-- History: these alerts stamped Philippine time for everyone, because the app
-- was built there. That was corrected to UTC in the same pass that fixed the
-- rest of the app's PHT assumptions - honest, but still nobody's actual wall
-- clock, so a trader in Chicago still had to convert every alert by hand.
--
-- Captured automatically from the browser (Intl.DateTimeFormat().
-- resolvedOptions().timeZone) on app load rather than asked for in a settings
-- form - a timezone picker is a chore, and the browser already knows. It also
-- self-corrects when a user travels or changes machine.
--
-- Null = unknown (account has never opened the web app, or an older row).
-- app/api/telegram/alert/route.ts falls back to UTC in that case and labels it
-- as such, so a message is never stamped with a timezone we only guessed at.
--
-- Applied to both projects 2026-07-27:
--   prod qdpwhnvmhqgzijuwopso -> lhq_user_settings
--   dev  wdtjhrilakoitfcezxpx -> lhq_dev_user_settings

alter table lhq_user_settings
  add column if not exists timezone text;

comment on column lhq_user_settings.timezone is
  'IANA timezone name from Intl.DateTimeFormat().resolvedOptions().timeZone. Null = unknown, alerts fall back to UTC.';

-- dev equivalent:
-- alter table lhq_dev_user_settings add column if not exists timezone text;
