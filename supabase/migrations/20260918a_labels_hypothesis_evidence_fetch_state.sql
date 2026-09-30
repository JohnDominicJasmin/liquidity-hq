-- #1342: two new label keys for HypothesisTracker's evidence fetch, added
-- alongside the fix that gives loading/error their own render instead of
-- collapsing into the same empty-list output as "confirmed empty" (see
-- components/HypothesisTracker.tsx, lib/fetchState.ts).
--
-- OWNER WORDING SIGN-OFF: REQUIRED, and GRANTED. An earlier version of this
-- header claimed "short technical status strings, so no owner sign-off needed" -
-- that was wrong and was overruled on the #1346 PR: these are strings a user
-- reads on screen, so they sit inside the owner's visual gate regardless of how
-- short or technical they are. The owner approved both strings as written on
-- 2026-09-26 (#1428 item 6): "Loading evidence…" and "Couldn't load evidence."
--
-- The en values here MUST match lib/labelDefaults.en.json exactly - the JSON is
-- the build-time fallback, so English renders these before this migration is
-- applied. ar/ru/ko/zh fall back to the English default until translated.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention) - shared-database write, owner-gated at
-- release time.

insert into lhq_labels (key, locale, value) values
('HYPOTHESIS_TRACKER_EVIDENCE_LOADING','en','Loading evidence…'),
('HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Couldn''t load evidence.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('HYPOTHESIS_TRACKER_EVIDENCE_LOADING','en','Loading evidence…'),
-- ('HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Couldn''t load evidence.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
