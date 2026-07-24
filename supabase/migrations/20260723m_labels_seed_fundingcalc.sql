-- CALC_FUNDING_* rows (components/FundingCostCalc.tsx). Run once against
-- BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('CALC_FUNDING_TITLE','en','Funding Cost'),
('CALC_FUNDING_SUBTITLE','en','Position size · funding rate · hold duration → total funding cost'),
('CALC_FUNDING_POSITION_LABEL','en','Position'),
('CALC_FUNDING_POS_SIZE_LABEL','en','Position Size (Notional)'),
('CALC_FUNDING_RATE_LABEL','en','Funding Rate (8h)'),
('CALC_FUNDING_RATE_HINT_POSITIVE','en','Positive rate - longs pay shorts. You pay if long.'),
('CALC_FUNDING_RATE_HINT_NEGATIVE','en','Negative rate - shorts pay longs. You pay if short.'),
('CALC_FUNDING_RATE_HINT_NEUTRAL','en','Enter a funding rate to see who pays.'),
('CALC_FUNDING_DURATION_LABEL','en','Hold Duration'),
('CALC_FUNDING_DURATION_HOURS_LABEL','en','Duration (hours)'),
('CALC_FUNDING_BANNER_PAYING','en','▼ PAYING funding - {count} payment(s)'),
('CALC_FUNDING_BANNER_RECEIVING','en','▲ RECEIVING funding - {count} payment(s)'),
('CALC_FUNDING_RESULT_TOTAL_COST','en','Total Funding Cost'),
('CALC_FUNDING_RESULT_COST_PER_DAY','en','Cost Per Day'),
('CALC_FUNDING_RESULT_COST_PER_WEEK','en','Cost Per Week'),
('CALC_FUNDING_ANNUALIZED_TIP','en','What this funding rate would cost (or pay) over a full year if it stayed constant - a way to compare a small 8h % against something intuitive. Real funding rates swing constantly, so treat this as a snapshot, not a forecast.'),
('CALC_FUNDING_ANNUALIZED_LABEL','en','Annualized Rate'),
('CALC_FUNDING_RESULT_NUM_PAYMENTS','en','Number of Payments'),
('CALC_FUNDING_BREAKEVEN_TIP','en','The minimum price move you need in your favor just to cover what you''ll pay in funding over this hold - before you''re actually in profit.'),
('CALC_FUNDING_BREAKEVEN_LABEL','en','Breakeven PnL Needed'),
('CALC_FUNDING_WARN_HIGH_RATE','en','Annualized rate over 50% - funding is eating your position fast'),
('CALC_FUNDING_EMPTY_TITLE','en','Fill in position size and funding rate to calculate')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
