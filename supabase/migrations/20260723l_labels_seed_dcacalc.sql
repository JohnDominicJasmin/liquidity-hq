-- CALC_DCA_* rows (components/DcaCalc.tsx). Run once against BOTH
-- lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('CALC_DCA_TITLE','en','DCA Average'),
('CALC_DCA_SUBTITLE','en','Multiple entries → average price, break-even, and current PnL'),
('CALC_DCA_ENTRIES_LABEL','en','Buy Entries'),
('CALC_DCA_ENTRY_PRICE_COL','en','Entry Price'),
('CALC_DCA_QTY_COL','en','Quantity'),
('CALC_DCA_ENTRY_PRICE_ARIA','en','Entry Price {n}'),
('CALC_DCA_QTY_ARIA','en','Quantity {n}'),
('CALC_DCA_ADD_ENTRY_BUTTON','en','+ Add entry'),
('CALC_DCA_CURRENT_PRICE_LABEL','en','Current Price (optional)'),
('CALC_DCA_LIVE_PRICE_TITLE','en','Set current price to the live price'),
('CALC_DCA_PRICE_LOADING','en','{coin} price loading…'),
('CALC_DCA_MARKET_PRICE_LABEL','en','Market Price'),
('CALC_DCA_MARKET_PRICE_PLACEHOLDER','en','Enter current price to calculate PnL'),
('CALC_DCA_RESULT_AVG_ENTRY','en','Average Entry'),
('CALC_DCA_RESULT_TOTAL_QTY','en','Total Quantity'),
('CALC_DCA_RESULT_TOTAL_COST','en','Total Cost'),
('CALC_DCA_RESULT_CURRENT_VALUE','en','Current Value'),
('CALC_DCA_RESULT_UNREALIZED_PNL','en','Unrealized PnL'),
('CALC_DCA_BANNER_ABOVE','en','▲ Price is {pct} above average entry'),
('CALC_DCA_BANNER_BELOW','en','▼ Price is {pct} below average entry'),
('CALC_DCA_EMPTY_TITLE','en','Add at least one entry with a price and quantity')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
