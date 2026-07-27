-- LOGIN_EMAIL_ALREADY_REGISTERED - shown on the password sign-up form when
-- Supabase reports a repeat signup for an email that already has a
-- confirmed account. Supabase deliberately withholds a new confirmation
-- email in that case (anti-enumeration behavior: same response shape as a
-- real new signup), so the app used to show "check your inbox" for an email
-- that was never sent. The fix (app/login/page.tsx submitPassword) detects
-- this via `data.user.identities.length === 0` and shows this message
-- instead, switching the form to the sign-in tab.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('LOGIN_EMAIL_ALREADY_REGISTERED', 'en', 'This email already has an account. Sign in instead, or use Forgot password if you do not remember it.'),
('LOGIN_EMAIL_ALREADY_REGISTERED', 'ko', '이미 이 이메일로 가입된 계정이 있습니다. 로그인해 주세요. 비밀번호가 기억나지 않으면 비밀번호 찾기를 이용하세요.'),
('LOGIN_EMAIL_ALREADY_REGISTERED', 'zh', '该邮箱已注册账户。请直接登录；如忘记密码，请使用忘记密码功能。'),
('LOGIN_EMAIL_ALREADY_REGISTERED', 'ar', 'يوجد بالفعل حساب مرتبط بهذا البريد الإلكتروني. يرجى تسجيل الدخول بدلاً من ذلك، أو استخدام "نسيت كلمة المرور" إذا كنت لا تتذكرها.'),
('LOGIN_EMAIL_ALREADY_REGISTERED', 'ru', 'Аккаунт с этим email уже существует. Войдите в систему или используйте восстановление пароля, если не помните его.')
on conflict (key, locale) do update set value = excluded.value;
