-- #1309 item 34 / #1360. The product sold "Priority support", Privacy and Terms
-- told people to use "the email address listed on the About page", the About page
-- listed none, and a suspended user was told to "Contact support" with no contact
-- given. The address existed the whole time: support@liquidity-hq.com is the sole
-- mailbox on the domain's mail plan, active and unused. Confirmed in the host's
-- panel on 2026-09-18 at the owner's request.
--
-- Three keys. Two are new (the About page's Contact card); one is a correction of
-- an existing string that promised a contact it never gave.
--
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not reviewed by a native speaker, the
-- same standard as the rest of this audit's translation waves. The email address
-- itself is identical in every locale and must stay that way - a translated or
-- transliterated address is a broken address.
--
-- NOT YET APPLIED, as of 2026-09-18T21:36Z. This is a shared-database write and
-- needs the owner's go. WHOEVER APPLIES IT EDITS THIS LINE IN THE SAME ACTION -
-- 20260907a_user_settings_strategy_selection.sql still claims it was never applied
-- weeks after both projects got its columns, and a reader who believes that file
-- concludes the whole persistence path is dead. A status line nobody updates is
-- worse than no status line.
-- Prepared in advance so applying it is one step once they approve; QA's #1366
-- carries four deliberately-red tests that pass only once these rows exist.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels
-- (dev, wdtjhrilakoitfcezxpx). The dev section below is commented out per
-- 20260912b's convention - apply one section at a time.

insert into lhq_labels (key, locale, value) values

('ABOUT_CONTACT_LABEL','en','Contact'),
('ABOUT_CONTACT_LABEL','ar','تواصل معنا'),
('ABOUT_CONTACT_LABEL','ko','문의'),
('ABOUT_CONTACT_LABEL','ru','Контакты'),
('ABOUT_CONTACT_LABEL','zh','联系我们'),

('ABOUT_CONTACT_BODY','en','Questions, support requests, or feedback: support@liquidity-hq.com'),
('ABOUT_CONTACT_BODY','ar','للأسئلة أو طلبات الدعم أو الملاحظات: support@liquidity-hq.com'),
('ABOUT_CONTACT_BODY','ko','문의, 지원 요청, 의견은 support@liquidity-hq.com 으로 보내주세요.'),
('ABOUT_CONTACT_BODY','ru','Вопросы, обращения в поддержку и отзывы: support@liquidity-hq.com'),
('ABOUT_CONTACT_BODY','zh','问题、支持请求或反馈请发送至 support@liquidity-hq.com'),

('AUTH_GATE_BANNED_DESC','en','Your account has been suspended. Contact support at support@liquidity-hq.com if you believe this is a mistake.'),
('AUTH_GATE_BANNED_DESC','ar','تم تعليق حسابك. تواصل مع الدعم على support@liquidity-hq.com إذا كنت تعتقد أن هذا خطأ.'),
('AUTH_GATE_BANNED_DESC','ko','계정이 정지되었습니다. 잘못된 조치라고 생각되면 support@liquidity-hq.com 으로 문의해 주세요.'),
('AUTH_GATE_BANNED_DESC','ru','Ваш аккаунт заблокирован. Если вы считаете это ошибкой, напишите в поддержку: support@liquidity-hq.com'),
('AUTH_GATE_BANNED_DESC','zh','您的账户已被暂停。如果您认为这是误判，请联系 support@liquidity-hq.com')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('ABOUT_CONTACT_LABEL','en','Contact'),
-- ('ABOUT_CONTACT_LABEL','ar','تواصل معنا'),
-- ('ABOUT_CONTACT_LABEL','ko','문의'),
-- ('ABOUT_CONTACT_LABEL','ru','Контакты'),
-- ('ABOUT_CONTACT_LABEL','zh','联系我们'),
--
-- ('ABOUT_CONTACT_BODY','en','Questions, support requests, or feedback: support@liquidity-hq.com'),
-- ('ABOUT_CONTACT_BODY','ar','للأسئلة أو طلبات الدعم أو الملاحظات: support@liquidity-hq.com'),
-- ('ABOUT_CONTACT_BODY','ko','문의, 지원 요청, 의견은 support@liquidity-hq.com 으로 보내주세요.'),
-- ('ABOUT_CONTACT_BODY','ru','Вопросы, обращения в поддержку и отзывы: support@liquidity-hq.com'),
-- ('ABOUT_CONTACT_BODY','zh','问题、支持请求或反馈请发送至 support@liquidity-hq.com'),
--
-- ('AUTH_GATE_BANNED_DESC','en','Your account has been suspended. Contact support at support@liquidity-hq.com if you believe this is a mistake.'),
-- ('AUTH_GATE_BANNED_DESC','ar','تم تعليق حسابك. تواصل مع الدعم على support@liquidity-hq.com إذا كنت تعتقد أن هذا خطأ.'),
-- ('AUTH_GATE_BANNED_DESC','ko','계정이 정지되었습니다. 잘못된 조치라고 생각되면 support@liquidity-hq.com 으로 문의해 주세요.'),
-- ('AUTH_GATE_BANNED_DESC','ru','Ваш аккаунт заблокирован. Если вы считаете это ошибкой, напишите в поддержку: support@liquidity-hq.com'),
-- ('AUTH_GATE_BANNED_DESC','zh','您的账户已被暂停。如果您认为这是误判，请联系 support@liquidity-hq.com')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
