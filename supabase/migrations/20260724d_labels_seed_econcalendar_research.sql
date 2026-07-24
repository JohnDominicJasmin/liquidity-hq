-- ECON_CALENDAR_*, RESEARCH_* rows (app/econ-calendar/page.tsx, app/research/page.tsx).
-- Row-level {e.impact} badge text (HIGH/MEDIUM/LOW) is raw API data, not
-- authored copy, and is intentionally not seeded here. Run once against
-- BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('ECON_CALENDAR_TITLE','en','Economic Calendar'),
('ECON_CALENDAR_SUBTITLE','en','High-impact US macro events - FOMC, NFP, CPI, PCE, GDP and more'),
('ECON_CALENDAR_TODAY_PREFIX','en','Today - {date}'),
('ECON_CALENDAR_LATEST_RELEASE','en','Latest Release'),
('ECON_CALENDAR_NEXT_EVENT','en','Next High-Impact Event'),
('ECON_CALENDAR_COUNTDOWN_AWAY','en','away'),
('ECON_CALENDAR_LOADING','en','Loading…'),
('ECON_CALENDAR_LOAD_ERROR','en','Failed to load calendar'),
('ECON_CALENDAR_NO_EVENTS','en','No upcoming events found.'),
('ECON_CALENDAR_RELEASED','en','Released'),
('ECON_CALENDAR_COUNTDOWN_DAYS_HOURS','en','{d}d {h}h'),
('ECON_CALENDAR_COUNTDOWN_HOURS_MINUTES','en','{h}h {m}m'),
('ECON_CALENDAR_COUNTDOWN_MINUTES','en','{m}m'),
('ECON_CALENDAR_IN_COUNTDOWN','en','in {countdown}'),
('ECON_CALENDAR_COL_TIME','en','TIME'),
('ECON_CALENDAR_COL_COUNTRY','en','COUNTRY'),
('ECON_CALENDAR_COL_EVENT','en','EVENT'),
('ECON_CALENDAR_COL_PREVIOUS','en','PREVIOUS'),
('ECON_CALENDAR_COL_CONSENSUS','en','CONSENSUS'),
('ECON_CALENDAR_COL_ACTUAL','en','ACTUAL'),
('ECON_CALENDAR_COL_DELTA','en','DELTA'),
('ECON_CALENDAR_COL_IMPACT','en','IMPACT'),
('ECON_CALENDAR_COUNTRY_US','en','US'),
('RESEARCH_HINT_TITLE','en','Market Research'),
('RESEARCH_HINT_BODY','en','Big-picture context: cycle positioning, BTC risk level, volatility regime, on-chain score, macro environment, and dry powder. Use this for daily orientation before trading.'),
('RESEARCH_HYPOTHESIS_TRACKER_TITLE','en','Hypothesis Tracker')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
