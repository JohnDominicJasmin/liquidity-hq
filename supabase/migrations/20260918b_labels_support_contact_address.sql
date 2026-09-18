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
-- APPLIED to BOTH projects at 2026-09-18T23:16:43Z, owner-approved in chat the same morning.
-- Production (lhq_labels): before the write, AUTH_GATE_BANNED_DESC existed in
-- `en` ONLY - the other four locales had been falling back to English - and the
-- two ABOUT_CONTACT_* keys did not exist. So this was 1 update and 14 inserts,
-- not a pure insert. Verified two ways: the rows read back 5 locales per key,
-- and /api/labels on the live site serves the address in all five locales.
-- Dev (lhq_dev_labels): applied and read back, 5 locales per key.
-- The suspended-user message took effect on production immediately, because it
-- is served from the database; the About Contact card renders once #1360 ships.
-- This line was edited in the same action as the apply, as the line above
-- instructed. A status line nobody updates is worse than no status line.
-- It was prepared in advance so applying it would be one step. QA's #1366 had
-- label-dependent tests grouped as expected-red until these rows existed - about
-- ten, not the four first estimated, because /api/labels serves database rows only
-- and the English fallback is client-side (Dev measured it). With the rows applied
-- those tests should now pass on qa/staging; that is QA's to confirm on a run.
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
