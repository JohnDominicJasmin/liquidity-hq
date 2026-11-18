-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The sign-in screen offers "Resend confirmation email" when a password sign-in fails because the email was never confirmed. New keys LOGIN_RESEND_CONFIRM_BUTTON / _SENT / _FAILED. English ships in lib/labelDefaults.en.json
-- (new keys, nothing stored to override) and needs no row. ko/zh/ru are AI-drafted and not native-reviewed. (The explanatory sentence above the button is the existing English-only friendlyAuthError line, like the others there.)
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('LOGIN_RESEND_CONFIRM_BUTTON','ko','확인 이메일 다시 보내기'),
('LOGIN_RESEND_CONFIRM_SENT','ko','확인 이메일을 보냈습니다. 받은편지함을 확인하세요.'),
('LOGIN_RESEND_CONFIRM_FAILED','ko','보내지 못했습니다. 잠시 후 다시 시도하세요.'),
('LOGIN_RESEND_CONFIRM_BUTTON','zh','重新发送确认邮件'),
('LOGIN_RESEND_CONFIRM_SENT','zh','确认邮件已发送,请查看您的收件箱。'),
('LOGIN_RESEND_CONFIRM_FAILED','zh','发送失败,请一分钟后再试。'),
('LOGIN_RESEND_CONFIRM_BUTTON','ru','Отправить письмо с подтверждением ещё раз'),
('LOGIN_RESEND_CONFIRM_SENT','ru','Письмо отправлено. Проверьте почту.'),
('LOGIN_RESEND_CONFIRM_FAILED','ru','Не удалось отправить. Попробуйте через минуту.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('LOGIN_RESEND_CONFIRM_BUTTON','ko','확인 이메일 다시 보내기'),
('LOGIN_RESEND_CONFIRM_SENT','ko','확인 이메일을 보냈습니다. 받은편지함을 확인하세요.'),
('LOGIN_RESEND_CONFIRM_FAILED','ko','보내지 못했습니다. 잠시 후 다시 시도하세요.'),
('LOGIN_RESEND_CONFIRM_BUTTON','zh','重新发送确认邮件'),
('LOGIN_RESEND_CONFIRM_SENT','zh','确认邮件已发送,请查看您的收件箱。'),
('LOGIN_RESEND_CONFIRM_FAILED','zh','发送失败,请一分钟后再试。'),
('LOGIN_RESEND_CONFIRM_BUTTON','ru','Отправить письмо с подтверждением ещё раз'),
('LOGIN_RESEND_CONFIRM_SENT','ru','Письмо отправлено. Проверьте почту.'),
('LOGIN_RESEND_CONFIRM_FAILED','ru','Не удалось отправить. Попробуйте через минуту.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
