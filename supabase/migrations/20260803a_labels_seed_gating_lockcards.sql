-- New locked-feature copy for GlobalMacroContext and OnChainScore (dashboard/
-- research widgets that hit Pro-gated APIs). They used to show a raw red
-- error box ("... is a Pro feature.") to free users instead of the app's
-- normal LockedFeatureCard treatment - these two rows back that fix.
-- Run once against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('GLOBAL_MACRO_CONTEXT_LOCKED_DESC','en','DXY, VIX, gold, oil, and bond yields with an AI risk-on/risk-off read - part of Pro.'),
('ON_CHAIN_SCORE_LOCKED_DESC','en','MVRV, SOPR, NVT, and exchange flow scored into one composite verdict - part of Pro.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
