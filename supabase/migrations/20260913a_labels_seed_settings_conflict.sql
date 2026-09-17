-- #1285. SettingsSaveToast gets a fourth state (`conflict`, alongside
-- saving/saved/error): shown when a save round trip succeeds but the server
-- rejected one or more fields in favour of a newer write from another
-- device. SettingsProvider already adopts the server's value for those
-- fields immediately - this label is the text the toast shows when that
-- happens, "Updated from another device", so the value change isn't silent.
--
-- Wording is not yet owner-approved - CLAUDE.md's closing rule reserves
-- user-visible copy for the owner. Not urgent to apply for that reason:
-- components/LabelsProvider.tsx merges the DB payload OVER
-- lib/labelDefaults.en.json, so the English string already resolves from the
-- shipped default with no row present here. Apply once the wording is
-- confirmed, and add the ar/zh/ko translations alongside it then - both
-- deliberately skipped in this migration rather than translating text that
-- may still change.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('SETTINGS_STATUS_CONFLICT','en','Updated from another device')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
