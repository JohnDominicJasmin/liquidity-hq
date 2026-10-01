-- #1255 (tracked on #1114): in Russian the desktop nav overflows from 768px to about 1200px, and the
-- widest single item is the Dashboard label, "Панель управления" (195px measured, wider than four
-- English nav items combined). The owner chose, on 2026-09-19 (in chat, relayed by PM/DevOps),
-- to shorten that label in RUSSIAN ONLY, together with the CSS trims in this same PR:
--
--   NAV_DASHBOARD  ru   was: Панель управления   now: Панель
--
-- Measured effect (prototyped in the browser, ru, signed in and out): with the trims alone the bar
-- still overflows (+68 at 768, +36 at 800, +49 at 945 with a TRIAL badge); with the trims AND this
-- label the minimum slack is 22px (TRIAL) to 26px (PRO) at 768. See the comment on #1114.
--
-- SCOPE OF THE CHANGE: NAV_DASHBOARD is the one key behind the nav's Dashboard entry EVERYWHERE it is
-- named - the terminal nav bar (lib/navRoutes.ts) and the mobile drawer (components/NavDrawer.tsx)
-- - so the drawer's Russian Dashboard item reads "Панель" too. No other locale is touched, and no
-- other key.
--
-- The existing ru row shadows the shipped default (#675's class), so this UPDATES it; the
-- `on conflict ... do update` does that. One row, one locale. Nothing is deleted.
-- The English default in labelDefaults.en.json is untouched (this is not an English change).
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev,
-- wdtjhrilakoitfcezxpx). The dev section below is commented out per 20260912b's convention -
-- apply one section at a time. Shared-database write: owner-gated; PM/DevOps applies the row at
-- release time.

insert into lhq_labels (key, locale, value) values

('NAV_DASHBOARD','ru','Панель')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same row against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('NAV_DASHBOARD','ru','Панель')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
