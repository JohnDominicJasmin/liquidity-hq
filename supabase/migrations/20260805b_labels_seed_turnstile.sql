-- New copy for the Turnstile CAPTCHA check on the magic-link login form
-- (app/login/page.tsx) - shown if the user tries to submit before the
-- widget finishes verifying. Run once against BOTH lhq_labels (prod) and
-- lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('LOGIN_ERROR_COMPLETE_VERIFICATION','en','Please complete the verification check before continuing.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
