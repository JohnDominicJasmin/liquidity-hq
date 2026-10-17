-- #1552 residual: the Arabic checkout button still said $25 a month.
-- Read (select only) on PROD 2026-10-08 after 20261008a was applied: UPGRADE_CHECKOUT_BUTTON_CTA / ar = "اشترك في Pro - 25 دولاراً/شهرياً ←".
-- That row predates the three-plan change (20260923a wrote en/ko/ru/zh and no ar), so 20261008a, which only replaced rows carrying $35,
-- could not reach it. Every other price label was re-read in all five locales: no other key carries 25, 35 or 350 as a price (the
-- remaining hits were RSI thresholds and the account-size buckets "$5k - $25k" / "$25k - $100k", which are not prices of the plan).
-- Same wording as the old row, number changed to the final monthly price. Machine-translated, not native-reviewed.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only
-- when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('UPGRADE_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - 49 دولاراً/شهرياً ←')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same row against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('UPGRADE_CHECKOUT_BUTTON_CTA','ar','اشترك في Pro - 49 دولاراً/شهرياً ←')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
