-- CALC_LIQ_* rows (components/LiquidationCalc.tsx). Run once against BOTH
-- lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('CALC_LIQ_TITLE','en','Liquidation Price'),
('CALC_LIQ_SUBTITLE','en','Entry · margin · leverage · maintenance margin → liq price and distance'),
('CALC_LIQ_DIRECTION_LABEL','en','Direction'),
('CALC_LIQ_LONG_BUTTON','en','Long'),
('CALC_LIQ_SHORT_BUTTON','en','Short'),
('CALC_LIQ_POSITION_LABEL','en','Position'),
('CALC_LIQ_LIVE_PRICE_TITLE','en','Set entry to the current live price'),
('CALC_LIQ_PRICE_LOADING','en','{coin} price loading…'),
('CALC_LIQ_ENTRY_PRICE_LABEL','en','Entry Price'),
('CALC_LIQ_MARGIN_LABEL','en','Margin (Collateral)'),
('CALC_LIQ_MARGIN_ARIA','en','Margin'),
('CALC_LIQ_LEVERAGE_LABEL','en','Leverage'),
('CALC_LIQ_MAINT_MARGIN_TIP','en','The minimum % of your position''s notional value your exchange requires you to keep as margin at all times. Set by the exchange per coin/tier - check your exchange''s contract specs; 0.5% is a common default for majors.'),
('CALC_LIQ_MAINT_MARGIN_LABEL','en','Maintenance Margin'),
('CALC_LIQ_BANNER_LONG','en','▲ LONG - Liquidation at {price}'),
('CALC_LIQ_BANNER_SHORT','en','▼ SHORT - Liquidation at {price}'),
('CALC_LIQ_RESULT_LIQ_PRICE','en','Liquidation Price'),
('CALC_LIQ_RESULT_DISTANCE','en','Distance to Liquidation'),
('CALC_LIQ_NOTIONAL_TIP','en','The full size of your position (margin × leverage), before accounting for what you actually put up as collateral. This is the amount your P&L is calculated against.'),
('CALC_LIQ_NOTIONAL_LABEL','en','Notional Value'),
('CALC_LIQ_RESULT_INIT_MARGIN','en','Initial Margin'),
('CALC_LIQ_RESULT_MAINT_MARGIN','en','Maintenance Margin'),
('CALC_LIQ_WARN_5PCT','en','Less than 5% from liquidation - dangerously close'),
('CALC_LIQ_WARN_10PCT','en','Less than 10% from liquidation - high risk'),
('CALC_LIQ_EMPTY_TITLE','en','Fill in entry price, margin and leverage to calculate')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
