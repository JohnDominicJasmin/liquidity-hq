-- New /refund page (app/refund/page.tsx) - required by LemonSqueezy's
-- onboarding review (their reply asked for clear Terms of Service, Privacy
-- Policy, AND Refund Policy links on the landing page; Terms/Privacy already
-- existed, Refund Policy didn't exist anywhere). Follows the exact same
-- shape as terms/privacy/disclaimer's own migrations - same eyebrow ("Legal"),
-- same trailing-period title convention ("Refund Policy."), same footer
-- acknowledgement/copyright pattern. English only for now, same as every
-- other new page here - see pendings/I18N_MIGRATION.md.
-- Policy substance: no refunds on completed billing periods, cancel anytime
-- effective at period end, free 14-day trial needs no refund path, billing
-- errors/duplicate charges are the one carve-out.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('REFUND_EYEBROW', 'en', 'Legal'),
('REFUND_PAGE_TITLE', 'en', 'Refund Policy.'),
('REFUND_LAST_UPDATED', 'en', 'Last updated: July 2026'),
('REFUND_CALLOUT_BODY', 'en', 'This policy explains when payments to LiquidityHQ are, and are not, refundable. It does not cover trading or investment risk, which is addressed in our Full Disclaimer.'),

('REFUND_SECTION_NO_REFUNDS_TITLE', 'en', 'No Refunds on Payments'),
('REFUND_SECTION_NO_REFUNDS_BODY', 'en', 'All payments to LiquidityHQ are final. We do not provide refunds, in full or in part, for any billing period once it has started - including if you cancel partway through, forget to cancel, or simply don''t use the service.'),

('REFUND_SECTION_CANCELLATION_TITLE', 'en', 'Cancelling Your Subscription'),
('REFUND_SECTION_CANCELLATION_BODY', 'en', 'You can cancel your Pro subscription at any time. Cancelling stops future billing but does not refund the current period - you keep full Pro access until the end of the period you already paid for, then your account moves to the Free plan.'),

('REFUND_SECTION_FREE_TRIAL_TITLE', 'en', 'Free Trial'),
('REFUND_SECTION_FREE_TRIAL_BODY', 'en', 'Every new account gets a 14-day Pro trial with no card required, so you can evaluate the full product before paying anything. Because the trial itself is free, no refund applies to it - if you don''t upgrade, your account simply moves to the Free plan when it ends.'),

('REFUND_SECTION_BILLING_ERRORS_TITLE', 'en', 'Billing Errors'),
('REFUND_SECTION_BILLING_ERRORS_BODY', 'en', 'The one exception to our no-refund policy is a genuine billing error - for example, a duplicate charge, or a charge that went through after you''d already cancelled. Contact us and we''ll investigate and correct any error we find.'),

('REFUND_SECTION_CHARGEBACKS_TITLE', 'en', 'Chargebacks'),
('REFUND_SECTION_CHARGEBACKS_BODY', 'en', 'If you have a billing concern, please contact us before filing a chargeback with your bank or card provider - most issues are resolved faster that way. Unwarranted chargebacks may result in your account being suspended.'),

('REFUND_SECTION_CONTACT_TITLE', 'en', 'How to Reach Us'),
('REFUND_SECTION_CONTACT_BODY', 'en', 'For billing questions, cancellations, or a suspected billing error, contact support through the email on your purchase receipt. We aim to respond within 2 business days.'),

('REFUND_FOOTER_ACKNOWLEDGEMENT', 'en', 'By using LiquidityHQ, you acknowledge that you have read, understood, and agree to this Refund Policy.'),
('REFUND_FOOTER_COPYRIGHT', 'en', '© {year} LiquidityHQ. All rights reserved.')
on conflict (key, locale) do update set value = excluded.value;
