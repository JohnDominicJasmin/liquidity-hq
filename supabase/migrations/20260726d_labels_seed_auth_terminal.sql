-- New AUTH_TERMINAL_LIVE_TAG label - the "LIVE" status tag in the terminal
-- window chrome shared by /login, /forgot-password, /reset-password.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('AUTH_TERMINAL_LIVE_TAG', 'en', 'LIVE'),
('AUTH_TERMINAL_LIVE_TAG', 'ko', '실시간'),
('AUTH_TERMINAL_LIVE_TAG', 'zh', '实时'),
('AUTH_TERMINAL_LIVE_TAG', 'ar', 'مباشر'),
('AUTH_TERMINAL_LIVE_TAG', 'ru', 'ОНЛАЙН')
on conflict (key, locale) do update set value = excluded.value;
