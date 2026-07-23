-- CALC_RR_* rows (components/RiskRewardCalc.tsx). Run once against BOTH
-- lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('CALC_RR_TITLE','en','Risk / Reward'),
('CALC_RR_SUBTITLE','en','Entry · SL · TP · win rate → R:R, expected value, breakeven'),
('CALC_RR_TRADE_LEVELS_LABEL','en','Trade Levels'),
('CALC_RR_LIVE_PRICE_TITLE','en','Set entry to the current live price'),
('CALC_RR_PRICE_LOADING','en','{coin} price loading…'),
('CALC_RR_ENTRY_PRICE_LABEL','en','Entry Price'),
('CALC_RR_STOP_LOSS_LABEL','en','Stop Loss'),
('CALC_RR_TP_LABEL','en','Take Profit'),
('CALC_RR_WIN_RATE_LABEL','en','Win Rate'),
('CALC_RR_BANNER_LONG','en','▲ LONG - {rr}R setup'),
('CALC_RR_BANNER_SHORT','en','▼ SHORT - {rr}R setup'),
('CALC_RR_RATIO_TIP','en','Risk:Reward - how many dollars you stand to make for every dollar risked. 2R means a win pays double the loss. Below 1.5R, you need too high a win rate to be profitable long-term - the math doesn''t work in your favor.'),
('CALC_RR_RATIO_LABEL','en','R:R Ratio'),
('CALC_RR_EV_TIP','en','The average $ outcome per unit if you took this exact setup many times at the win rate you entered: (win% × TP distance) - (loss% × SL distance). Positive means the math favors taking the trade; negative means it doesn''t, even if it ''feels'' right.'),
('CALC_RR_EV_LABEL','en','Expected Value (per unit)'),
('CALC_RR_BREAKEVEN_TIP','en','The minimum win rate this exact R:R needs just to break even long-term. Win below this rate and you lose money overall; win above it and the setup is profitable.'),
('CALC_RR_BREAKEVEN_LABEL','en','Breakeven Win Rate'),
('CALC_RR_RESULT_SL_DISTANCE','en','SL Distance'),
('CALC_RR_RESULT_TP_DISTANCE','en','TP Distance'),
('CALC_RR_WARN_LOW_RR','en','R:R below 1.5 - not worth taking unless win rate is very high'),
('CALC_RR_WARN_NEGATIVE_EV','en','Negative expected value at {winRate}% win rate - skip this trade'),
('CALC_RR_POSITIVE_EV_BANNER','en','✓ Positive expected value with {rr}R - good setup'),
('CALC_RR_EMPTY_TITLE','en','Fill in entry, stop loss and take profit to calculate')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
