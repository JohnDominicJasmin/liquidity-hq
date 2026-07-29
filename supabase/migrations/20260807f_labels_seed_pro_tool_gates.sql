-- Locked-feature copy for the five AI tools that just became Pro-only server
-- side (thesis-check, shadow-account, behavioral-bias, dry-powder, and the
-- hypothesis analyze route). Without these rows a free user got a raw error
-- string - or, on the thesis and hypothesis buttons, nothing at all - instead
-- of the app's normal LockedFeatureCard treatment. Same shape and tone as
-- 20260803a_labels_seed_gating_lockcards.sql, which did this for
-- GlobalMacroContext and OnChainScore.
-- DRY_POWDER_FETCH_FAILED replaces a hardcoded English 'Failed' in the same
-- error path that now handles the Pro gate.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('DRY_POWDER_LOCKED_DESC','en','Stablecoin buying power sitting on exchanges, with an AI read on whether it is building up or draining away - part of Pro.'),
('DRY_POWDER_FETCH_FAILED','en','Could not load stablecoin supply right now.'),

('TRADE_JOURNAL_SHADOW_LOCKED_DESC','en','An AI read of the strategy your trades actually follow, including the rules you keep without noticing and the ones you keep breaking - part of Pro.'),
('TRADE_JOURNAL_BIAS_LOCKED_DESC','en','An AI check for the habits that quietly cost you money, such as cutting winners early, overtrading, and chasing moves - part of Pro.'),
('TRADE_JOURNAL_THESIS_LOCKED_DESC','en','Write down the reasoning behind a trade and have AI score whether your assumptions still hold as the market moves - part of Pro.'),

('HYPOTHESIS_TRACKER_ANALYSIS_LOCKED_TITLE','en','Hypothesis Analysis'),
('HYPOTHESIS_TRACKER_ANALYSIS_LOCKED_DESC','en','Have AI weigh your logged evidence against your acceptance criteria and give a verdict on whether the idea is holding up - part of Pro.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
