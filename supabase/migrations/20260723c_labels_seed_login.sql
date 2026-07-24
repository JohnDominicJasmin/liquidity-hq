-- LOGIN_* rows. Run once against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('LOGIN_ERROR_SUPABASE_NOT_CONFIGURED','en','Supabase not configured'),
('LOGIN_SUBTITLE_SIGNUP','en','Create your account'),
('LOGIN_SUBTITLE_SIGNIN','en','Sign in to your account'),
('LOGIN_SUCCESS_TITLE','en','Check your inbox'),
('LOGIN_SUCCESS_DESC_PRE','en','Magic link sent to'),
('LOGIN_SUCCESS_DESC_POST','en','Click the link in your email to sign in.'),
('LOGIN_USE_DIFFERENT_EMAIL_BUTTON','en','Use a different email'),
('LOGIN_GOOGLE_SIGNING_IN','en','Signing in…'),
('LOGIN_GOOGLE_CONTINUE_BUTTON','en','Continue with Google'),
('LOGIN_DIVIDER_OR','en','or'),
('LOGIN_EMAIL_INPUT_PLACEHOLDER','en','your@email.com'),
('LOGIN_SEND_MAGIC_LINK_BUTTON','en','Send Magic Link'),
('LOGIN_SKIP_LINK','en','Continue without signing in →'),
('LOGIN_LOADING','en','Loading…')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
