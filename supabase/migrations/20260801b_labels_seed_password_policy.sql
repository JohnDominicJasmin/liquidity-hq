-- The sign-up form checked `password.length < 8` client-side while Supabase
-- Auth enforces 12 characters plus one lowercase, one uppercase and one digit.
-- So the form accepted the password, the request went out, and GoTrue answered
-- with its own raw string - "Password should contain at least one character of
-- each: abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789." -
-- which is what landed on screen. Wrong threshold, and an error written for a
-- developer, on the first screen of the product.
--
-- These keys let the client state the real policy BEFORE submitting, in the
-- user's own language. The rules are deliberately separate keys rather than one
-- comma-joined sentence: gluing fragments together with ", " is an assumption
-- about English that does not survive translation into ko/zh/ar/ru.
--
-- LOGIN_PASSWORD_RULE_LENGTH interpolates {n} from PASSWORD_MIN_LENGTH rather
-- than hardcoding 12, so raising the policy does not silently leave five
-- locales claiming the old number.
--
-- LOGIN_PASSWORD_TOO_SHORT and SETTINGS_PASSWORD_TOO_SHORT are now unused (both
-- said "at least 8 characters", which was never true). Left in place rather
-- than deleted - they are seeded across five locales and removing them buys
-- nothing, but do not reuse them.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('LOGIN_PASSWORD_POLICY_ERROR','en','Password must be at least 12 characters and include an uppercase letter, a lowercase letter and a number.'),
('LOGIN_PASSWORD_RULE_LENGTH','en','At least {n} characters'),
('LOGIN_PASSWORD_RULE_LOWER','en','One lowercase letter'),
('LOGIN_PASSWORD_RULE_UPPER','en','One uppercase letter'),
('LOGIN_PASSWORD_RULE_NUMBER','en','One number'),
('LOGIN_PASSWORD_SHOW','en','Show password'),
('LOGIN_PASSWORD_HIDE','en','Hide password')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
