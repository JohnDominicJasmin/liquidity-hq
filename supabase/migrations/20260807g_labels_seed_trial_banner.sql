-- TrialBanner shipped with hardcoded English, so it was the one always-visible
-- surface that never translated - a Korean or Arabic user saw English on every
-- page for the whole 14-day trial, right where the product is trying to
-- convince them to pay.
--
-- TRIAL_BANNER_FULL_ACCESS carries no trailing separator: the component renders
-- it, a space, then the bolded day count, so translators are not forced to
-- reproduce punctuation. The arrow on the CTA stays in JSX for the same reason.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('TRIAL_BANNER_LABEL','en','Pro trial'),
('TRIAL_BANNER_FULL_ACCESS','en','Full access -'),
('TRIAL_BANNER_DAYS_LEFT','en','{days} days left'),
('TRIAL_BANNER_LAST_DAY','en','last day'),
('TRIAL_BANNER_CTA','en','Keep Pro')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
