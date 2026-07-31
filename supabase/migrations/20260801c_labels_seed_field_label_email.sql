-- The auth forms were placeholder-only: every field lost its accessible name
-- the moment the user typed into it. They now carry real <label for> elements.
--
-- Only ONE new key is needed. The three password fields reuse the existing
-- LOGIN_PASSWORD_NEW_PLACEHOLDER / LOGIN_PASSWORD_PLACEHOLDER /
-- LOGIN_PASSWORD_CONFIRM_PLACEHOLDER, whose values ("New password",
-- "Password", "Confirm password") already read as labels and are already
-- translated across five locales - minting duplicates would mean re-doing that
-- work for identical strings. The key names now under-describe their use; that
-- is the deliberate trade, and it is recorded here so the next person does not
-- "fix" the naming by adding parallel keys.
--
-- Email is the exception: its placeholder is "your@email.com", a genuine format
-- hint that stays a placeholder, so the label needs its own key.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('LOGIN_FIELD_LABEL_EMAIL','en','Email')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
