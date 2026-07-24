-- Pro price change: $15/mo -> $25/mo (business decision 2026-07-24, see
-- pendings/PRICING_ANALYSIS.md - real xAI rates showed the old $15 price left
-- a fully cap-maxing Pro account underwater; caps stayed unchanged, price
-- moved instead). Updates the checkout-button CTA copy across every locale.
-- Already applied live against both lhq_labels (prod) and lhq_dev_labels
-- (dev) via execute_sql - this file documents that change for the record.

update lhq_labels
set value = replace(value, '$15', '$25'), updated_at = now()
where key = 'UPGRADE_CHECKOUT_BUTTON_CTA' and locale in ('en','ko','ru','zh');

update lhq_labels
set value = replace(value, '15 دولاراً', '25 دولاراً'), updated_at = now()
where key = 'UPGRADE_CHECKOUT_BUTTON_CTA' and locale = 'ar';

-- DEV (already applied live against lhq_dev_labels):
-- update lhq_dev_labels
-- set value = replace(value, '$15', '$25'), updated_at = now()
-- where key = 'UPGRADE_CHECKOUT_BUTTON_CTA' and locale in ('en','ko','ru','zh');
--
-- update lhq_dev_labels
-- set value = replace(value, '15 دولاراً', '25 دولاراً'), updated_at = now()
-- where key = 'UPGRADE_CHECKOUT_BUTTON_CTA' and locale = 'ar';
