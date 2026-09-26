-- #1396: label rows for the settings "Subscription" panel and the cancel flow.
--
-- WORDING PENDING OWNER APPROVAL. These strings are user-visible; the owner
-- approves the copy (and the panel's look, condition 5) before this closes. The
-- en values here MUST match lib/labelDefaults.en.json exactly - the JSON is the
-- build-time fallback, so the panel renders these strings on qa even before this
-- migration is applied (same pattern as #1346). ar/ko/ru/zh fall back to en via
-- the labelDefaults fallback until translated.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention) - shared-database write, owner-gated at
-- release time. `{date}` in the CANCELLED_UNTIL string is a runtime placeholder
-- the client fills; it is stored literally.

insert into lhq_labels (key, locale, value) values
('SETTINGS_SECTION_SUBSCRIPTION','en','Subscription'),
('SETTINGS_SUB_PLAN_PRO','en','Pro plan'),
('SETTINGS_SUB_ACTIVE','en','Active'),
('SETTINGS_SUB_CANCEL_BUTTON','en','Cancel subscription'),
('SETTINGS_SUB_CANCEL_CONFIRM','en','Cancel Pro? You''ll keep access until the end of your current paid period.'),
('SETTINGS_SUB_CANCEL_CONFIRM_YES','en','Yes, cancel'),
('SETTINGS_SUB_CANCEL_CONFIRM_NO','en','Keep Pro'),
('SETTINGS_SUB_CANCELLING','en','Cancelling…'),
('SETTINGS_SUB_CANCELLED_UNTIL','en','Cancelled · access until {date}'),
('SETTINGS_SUB_CANCELLED_NO_DATE','en','Cancelled · access continues until your period ends'),
('SETTINGS_SUB_CANCEL_FAILED','en','Couldn''t cancel. Please try again or contact support.'),
('SETTINGS_SUB_MANAGED','en','Managed by support'),
('SETTINGS_SUB_LOAD_FAILED','en','Couldn''t load your subscription.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('SETTINGS_SECTION_SUBSCRIPTION','en','Subscription'),
-- ('SETTINGS_SUB_PLAN_PRO','en','Pro plan'),
-- ('SETTINGS_SUB_ACTIVE','en','Active'),
-- ('SETTINGS_SUB_CANCEL_BUTTON','en','Cancel subscription'),
-- ('SETTINGS_SUB_CANCEL_CONFIRM','en','Cancel Pro? You''ll keep access until the end of your current paid period.'),
-- ('SETTINGS_SUB_CANCEL_CONFIRM_YES','en','Yes, cancel'),
-- ('SETTINGS_SUB_CANCEL_CONFIRM_NO','en','Keep Pro'),
-- ('SETTINGS_SUB_CANCELLING','en','Cancelling…'),
-- ('SETTINGS_SUB_CANCELLED_UNTIL','en','Cancelled · access until {date}'),
-- ('SETTINGS_SUB_CANCELLED_NO_DATE','en','Cancelled · access continues until your period ends'),
-- ('SETTINGS_SUB_CANCEL_FAILED','en','Couldn''t cancel. Please try again or contact support.'),
-- ('SETTINGS_SUB_MANAGED','en','Managed by support'),
-- ('SETTINGS_SUB_LOAD_FAILED','en','Couldn''t load your subscription.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
