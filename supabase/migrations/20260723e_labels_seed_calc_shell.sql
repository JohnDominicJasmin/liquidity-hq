-- CALC_TAB_*, CALC_PAGE_*, CALC_COIN_* rows (app/calc/page.tsx shell only -
-- individual calculator components seeded separately). Run once against BOTH
-- lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('CALC_TAB_SIZER','en','Position Sizer'),
('CALC_TAB_LIQUIDATION','en','Liquidation Price'),
('CALC_TAB_PNL','en','PnL'),
('CALC_TAB_RR','en','Risk / Reward'),
('CALC_TAB_FUNDING','en','Funding Cost'),
('CALC_TAB_DCA','en','DCA Average'),
('CALC_PAGE_TITLE','en','Calculators'),
('CALC_PAGE_SUBTITLE','en','Position sizing, liquidation, PnL, risk/reward, funding cost, and DCA average'),
('CALC_COIN_LABEL','en','Coin'),
('CALC_COIN_OPTIONAL_HINT','en','(optional - auto-fills price fields below)'),
('CALC_COIN_ANY_LABEL','en','Any coin (enter prices manually)')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
