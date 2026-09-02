-- #589. The current design's dashboard rendered <SOTD /> under
-- DASH_BEST_SETUP_TODAY_HEADER ("Best Setup Today"). SOTD serves a rotating
-- entry from the fixed SECRETS library, and its own labels already say so:
-- SOTD_BADGE_LABEL is "Playbook", SOTD_NEW_PLAY_BUTTON is "new play", and
-- SOTD_FOOTER opens "Educational reference, not a live signal." The header
-- promised a computed daily setup over a static teaching card.
--
-- "Playbook" rather than a new coinage: it is the word that component already
-- shows on its own badge, so the header and the body now agree instead of the
-- header inventing a third name for the same thing.
--
-- DASH_BEST_SETUP_TODAY_HEADER is NOT removed or changed. The terminal design
-- still uses it, over <TBestSetupToday />, where it is accurate.
--
-- Not urgent to apply: components/LabelsProvider.tsx merges the DB payload
-- OVER lib/labelDefaults.en.json, so the English string already resolves from
-- the shipped default with no row present. This row is what gives the key a
-- translation target and an entry in the label editor.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('DASH_PLAYBOOK_HEADER','en','Playbook')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
