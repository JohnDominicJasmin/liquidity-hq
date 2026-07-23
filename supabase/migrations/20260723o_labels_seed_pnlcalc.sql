-- CALC_PNL_* rows (components/PnLCalc.tsx). Run once against BOTH
-- lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('CALC_PNL_TITLE','en','PnL Calculator'),
('CALC_PNL_SUBTITLE','en','Entry · exit · margin · leverage → PnL, PnL%, ROE%'),
('CALC_PNL_DIRECTION_LABEL','en','Direction'),
('CALC_PNL_LONG_BUTTON','en','Long'),
('CALC_PNL_SHORT_BUTTON','en','Short'),
('CALC_PNL_TRADE_LABEL','en','Trade'),
('CALC_PNL_LIVE_PRICE_TITLE','en','Set entry to the current live price'),
('CALC_PNL_PRICE_LOADING','en','{coin} price loading…'),
('CALC_PNL_ENTRY_PRICE_LABEL','en','Entry Price'),
('CALC_PNL_EXIT_PRICE_LABEL','en','Exit Price'),
('CALC_PNL_MARGIN_LABEL','en','Margin (Capital)'),
('CALC_PNL_MARGIN_ARIA','en','Margin'),
('CALC_PNL_LEVERAGE_LABEL','en','Leverage'),
('CALC_PNL_BANNER_PROFIT','en','▲ PROFIT - {pct}'),
('CALC_PNL_BANNER_LOSS','en','▼ LOSS - {pct}'),
('CALC_PNL_RESULT_PNL','en','PnL'),
('CALC_PNL_RESULT_PNL_PCT','en','PnL%'),
('CALC_PNL_ROE_TIP','en','Return on Equity - your profit as a % of the margin (collateral) you actually put up, same number as PnL% here since both are measured against your margin.'),
('CALC_PNL_ROE_LABEL','en','ROE%'),
('CALC_PNL_NOTIONAL_TIP','en','The full size of your position (margin × leverage), before accounting for what you actually put up as collateral. This is the amount your P&L is calculated against.'),
('CALC_PNL_NOTIONAL_LABEL','en','Notional Value'),
('CALC_PNL_RESULT_QUANTITY','en','Quantity'),
('CALC_PNL_EMPTY_TITLE','en','Fill in entry, exit, margin and leverage to calculate')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
