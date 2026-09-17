-- #1342: two new label keys for HypothesisTracker's evidence fetch, added
-- alongside the fix that gives loading/error their own render instead of
-- collapsing into the same empty-list output as "confirmed empty" (see
-- components/HypothesisTracker.tsx, lib/fetchState.ts).
--
-- en only for now - short technical status strings, not marketing copy, so
-- no owner wording sign-off needed before this can ship; ar/ru/ko/zh fall
-- back to the English default via the existing labelDefaults fallback until
-- translated, same as any other untranslated key.
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
--
-- ('HYPOTHESIS_TRACKER_EVIDENCE_LOADING','en','Loading evidence…'),
-- ('HYPOTHESIS_TRACKER_EVIDENCE_ERROR','en','Couldn''t load evidence.')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
