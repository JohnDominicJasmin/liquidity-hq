-- Third feature-flag toggle label, for /ops/config's Feature kill switches card.
-- Run once against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('OPS_CONFIG_FEATURE_SIGNUPS','en','New signups')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
