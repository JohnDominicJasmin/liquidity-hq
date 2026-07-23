-- UPGRADE_GATE_* rows (components/UpgradeGateModal.tsx). Run once against
-- BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('UPGRADE_GATE_PRO_FEATURE_LABEL','en','Pro Feature'),
('UPGRADE_GATE_UNLOCK_BUTTON','en','Unlock with Pro'),
('UPGRADE_GATE_CTA','en','Upgrade to Pro'),
('UPGRADE_GATE_COMPARE_LINK','en','Compare Free and Pro'),
('UPGRADE_GATE_HEADLINE_FEATURE','en','{feature} is part of Pro.'),
('UPGRADE_GATE_HEADLINE_DEFAULT','en','This is part of Pro.'),
('UPGRADE_GATE_BODY','en','Pro unlocks the fast timeframes, the full signal stack, backtesting, and the deeper AI research tools. One subscription, everything included.'),
('UPGRADE_GATE_BULLET_1','en','Signals on the 1 minute, 5 minute, and 15 minute charts'),
('UPGRADE_GATE_BULLET_2','en','Absorption Detector, Order Flow, and Confluence Score'),
('UPGRADE_GATE_BULLET_3','en','Full backtesting across every coin and timeframe'),
('UPGRADE_GATE_BULLET_4','en','On-chain and global macro AI analysis'),
('UPGRADE_GATE_NOT_NOW','en','Not now')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
