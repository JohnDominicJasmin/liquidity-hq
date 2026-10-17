-- #1567 Phase 2 (owner, 2026-10-17): the /upgrade payment panel is Whop only. Four NEW keys, five locales: UPGRADE_WHOP_PANEL_TITLE,
-- UPGRADE_WHOP_CTA, UPGRADE_WHOP_EMAIL_NOTE, UPGRADE_WHOP_CHECKOUT_NOTE. New keys, so no live label row is overwritten.
--
-- The English text is the default in lib/labelDefaults.en.json; ar/ko/ru/zh are machine-translated by Dev and NOT native-reviewed. "Whop" stays in
-- Latin script, as the other provider names do. Copy says only what the product does today: no cancel, refund, card or crypto claim.
-- "All sales are final" is what the Terms/Return policy PDF says; the on-site /terms page does not state it.
--
-- Until these rows exist the page shows the English default in every locale (the build-time fallback), which is correct, just not translated.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says
-- no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('UPGRADE_WHOP_PANEL_TITLE','en','Complete your purchase'),
('UPGRADE_WHOP_PANEL_TITLE','ar','أكمل عملية الشراء'),
('UPGRADE_WHOP_PANEL_TITLE','ko','구매를 완료하세요'),
('UPGRADE_WHOP_PANEL_TITLE','ru','Завершите покупку'),
('UPGRADE_WHOP_PANEL_TITLE','zh','完成购买'),
('UPGRADE_WHOP_CTA','en','Pay with Whop'),
('UPGRADE_WHOP_CTA','ar','الدفع عبر Whop'),
('UPGRADE_WHOP_CTA','ko','Whop으로 결제'),
('UPGRADE_WHOP_CTA','ru','Оплатить через Whop'),
('UPGRADE_WHOP_CTA','zh','通过 Whop 支付'),
('UPGRADE_WHOP_EMAIL_NOTE','en','At checkout, use the same email as your LiquidityHQ account.'),
('UPGRADE_WHOP_EMAIL_NOTE','ar','عند الدفع، استخدم نفس البريد الإلكتروني المرتبط بحسابك في LiquidityHQ.'),
('UPGRADE_WHOP_EMAIL_NOTE','ko','결제 시 LiquidityHQ 계정과 같은 이메일을 사용하세요.'),
('UPGRADE_WHOP_EMAIL_NOTE','ru','При оплате используйте тот же адрес электронной почты, что и в аккаунте LiquidityHQ.'),
('UPGRADE_WHOP_EMAIL_NOTE','zh','结账时请使用与 LiquidityHQ 账户相同的电子邮箱。'),
('UPGRADE_WHOP_CHECKOUT_NOTE','en','You''ll finish paying on Whop. All sales are final.'),
('UPGRADE_WHOP_CHECKOUT_NOTE','ar','ستُكمل الدفع على Whop. جميع المبيعات نهائية.'),
('UPGRADE_WHOP_CHECKOUT_NOTE','ko','결제는 Whop에서 완료됩니다. 모든 판매는 최종입니다.'),
('UPGRADE_WHOP_CHECKOUT_NOTE','ru','Оплата завершается на Whop. Все продажи окончательные.'),
('UPGRADE_WHOP_CHECKOUT_NOTE','zh','您将在 Whop 上完成支付。所有销售均为最终交易。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('UPGRADE_WHOP_PANEL_TITLE','en','Complete your purchase'),
-- ('UPGRADE_WHOP_PANEL_TITLE','ar','أكمل عملية الشراء'),
-- ('UPGRADE_WHOP_PANEL_TITLE','ko','구매를 완료하세요'),
-- ('UPGRADE_WHOP_PANEL_TITLE','ru','Завершите покупку'),
-- ('UPGRADE_WHOP_PANEL_TITLE','zh','完成购买'),
-- ('UPGRADE_WHOP_CTA','en','Pay with Whop'),
-- ('UPGRADE_WHOP_CTA','ar','الدفع عبر Whop'),
-- ('UPGRADE_WHOP_CTA','ko','Whop으로 결제'),
-- ('UPGRADE_WHOP_CTA','ru','Оплатить через Whop'),
-- ('UPGRADE_WHOP_CTA','zh','通过 Whop 支付'),
-- ('UPGRADE_WHOP_EMAIL_NOTE','en','At checkout, use the same email as your LiquidityHQ account.'),
-- ('UPGRADE_WHOP_EMAIL_NOTE','ar','عند الدفع، استخدم نفس البريد الإلكتروني المرتبط بحسابك في LiquidityHQ.'),
-- ('UPGRADE_WHOP_EMAIL_NOTE','ko','결제 시 LiquidityHQ 계정과 같은 이메일을 사용하세요.'),
-- ('UPGRADE_WHOP_EMAIL_NOTE','ru','При оплате используйте тот же адрес электронной почты, что и в аккаунте LiquidityHQ.'),
-- ('UPGRADE_WHOP_EMAIL_NOTE','zh','结账时请使用与 LiquidityHQ 账户相同的电子邮箱。'),
-- ('UPGRADE_WHOP_CHECKOUT_NOTE','en','You''ll finish paying on Whop. All sales are final.'),
-- ('UPGRADE_WHOP_CHECKOUT_NOTE','ar','ستُكمل الدفع على Whop. جميع المبيعات نهائية.'),
-- ('UPGRADE_WHOP_CHECKOUT_NOTE','ko','결제는 Whop에서 완료됩니다. 모든 판매는 최종입니다.'),
-- ('UPGRADE_WHOP_CHECKOUT_NOTE','ru','Оплата завершается на Whop. Все продажи окончательные.'),
-- ('UPGRADE_WHOP_CHECKOUT_NOTE','zh','您将在 Whop 上完成支付。所有销售均为最终交易。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
