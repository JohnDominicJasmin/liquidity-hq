-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- The signed-out signal lock line and button in the reader's language (#1263).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ARENA_SIGNED_OUT_LOCK_LINE','ar','أنشئ حسابًا مجانيًا لرؤية الإشارات لعملات أكثر'),
('ARENA_SIGNED_OUT_LOCK_LINE','en','Sign up free to see signals on more coins'),
('ARENA_SIGNED_OUT_LOCK_LINE','ko','무료로 가입하면 더 많은 코인의 신호를 볼 수 있습니다'),
('ARENA_SIGNED_OUT_LOCK_LINE','ru','Зарегистрируйтесь бесплатно, чтобы видеть сигналы по большему числу монет'),
('ARENA_SIGNED_OUT_LOCK_LINE','zh','免费注册即可查看更多币种的信号'),
('ARENA_SIGNED_OUT_LOCK_CTA','ar','إنشاء حساب'),
('ARENA_SIGNED_OUT_LOCK_CTA','en','Sign up'),
('ARENA_SIGNED_OUT_LOCK_CTA','ko','가입하기'),
('ARENA_SIGNED_OUT_LOCK_CTA','ru','Регистрация'),
('ARENA_SIGNED_OUT_LOCK_CTA','zh','注册')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ARENA_SIGNED_OUT_LOCK_LINE','ar','أنشئ حسابًا مجانيًا لرؤية الإشارات لعملات أكثر'),
('ARENA_SIGNED_OUT_LOCK_LINE','en','Sign up free to see signals on more coins'),
('ARENA_SIGNED_OUT_LOCK_LINE','ko','무료로 가입하면 더 많은 코인의 신호를 볼 수 있습니다'),
('ARENA_SIGNED_OUT_LOCK_LINE','ru','Зарегистрируйтесь бесплатно, чтобы видеть сигналы по большему числу монет'),
('ARENA_SIGNED_OUT_LOCK_LINE','zh','免费注册即可查看更多币种的信号'),
('ARENA_SIGNED_OUT_LOCK_CTA','ar','إنشاء حساب'),
('ARENA_SIGNED_OUT_LOCK_CTA','en','Sign up'),
('ARENA_SIGNED_OUT_LOCK_CTA','ko','가입하기'),
('ARENA_SIGNED_OUT_LOCK_CTA','ru','Регистрация'),
('ARENA_SIGNED_OUT_LOCK_CTA','zh','注册')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
