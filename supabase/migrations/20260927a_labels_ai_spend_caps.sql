-- #1399 part 2: label rows for the AI dollar-cap messages.
--
-- Owner-approved copy (PM drafts, owner batches with the cancel-panel copy). en
-- values MUST match lib/labelDefaults.en.json exactly - the JSON is the build-time
-- fallback, so the messages render even before this migration is applied (the
-- server also reads the en default for the 429 message). ar/ko/ru/zh fall back to
-- en until translated.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out per
-- 20260912b's convention) - shared-database write, owner-gated at release time.

insert into lhq_labels (key, locale, value) values
('AI_CAP_PRO_DAILY','en','You''ve reached today''s AI limit. It resets at midnight UTC.'),
('AI_CAP_PRO_MONTHLY','en','You''ve reached this month''s AI limit. It resets on the 1st.'),
('AI_CAP_FREE_DAILY','en','You''ve reached today''s free AI limit. Upgrade to Pro for more, or try again tomorrow.'),
('AI_CAP_FUSE','en','AI is paused for free accounts today. Please try again tomorrow, or upgrade to Pro.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (owner-gated at release).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('AI_CAP_PRO_DAILY','en','You''ve reached today''s AI limit. It resets at midnight UTC.'),
-- ('AI_CAP_PRO_MONTHLY','en','You''ve reached this month''s AI limit. It resets on the 1st.'),
-- ('AI_CAP_FREE_DAILY','en','You''ve reached today''s free AI limit. Upgrade to Pro for more, or try again tomorrow.'),
-- ('AI_CAP_FUSE','en','AI is paused for free accounts today. Please try again tomorrow, or upgrade to Pro.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
