-- #1113 (owner option 4): the per-page PageHint is now replayable - once
-- dismissed it collapses to a "How this page works" affordance that reopens it.
-- That control needs one user-visible string.
--
-- The en value here MUST match lib/labelDefaults.en.json exactly - the JSON is
-- the build-time fallback, so English renders it before this migration is
-- applied. ar/ko/ru/zh fall back to en until translated. WORDING PENDING OWNER
-- SIGN-OFF (it's user-visible and part of a visual the owner approves, condition
-- 5), routed via the batch like every other label add.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention) - shared-database write, owner-gated at
-- release time.

insert into lhq_labels (key, locale, value) values
('PAGE_HINT_REPLAY_LABEL','en','How this page works')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same row against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('PAGE_HINT_REPLAY_LABEL','en','How this page works')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
