-- #1113 option 4 rollout: per-page PageHint on the eight pages that did not have
-- one (news, alerts, settings, dashboard, calc, econ-calendar, hours, playbook),
-- so a new user learns what each page is for beyond its nav label. The existing
-- hinted pages (scanner/briefing/journal/research/arena) get the replayable
-- affordance for free via #1450.
--
-- Sixteen user-visible strings (title + body per page). OWNER-APPROVED as written
-- 2026-09-28 (all 8, no changes). The en values here MUST match
-- lib/labelDefaults.en.json exactly - the JSON is the build-time fallback, so
-- English renders these before this migration is applied; ar/ko/ru/zh fall back
-- to en until translated.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention) - shared-database write, owner-gated at
-- release time.

insert into lhq_labels (key, locale, value) values
('NEWS_HINT_TITLE','en','News'),
('NEWS_HINT_BODY','en','Breaking crypto headlines and catalysts, tagged by coin and impact - see what''s actually moving the market right now and what''s just noise.'),
('ALERTS_HINT_TITLE','en','Alerts'),
('ALERTS_HINT_BODY','en','Set price, funding, RSI, whale and open-interest alerts per coin. When one fires you get a Telegram or push notification - toggle which are active and mute the ones you don''t need.'),
('SETTINGS_HINT_TITLE','en','Settings'),
('SETTINGS_HINT_BODY','en','Your trading profile, risk defaults, watchlist, notifications, connected accounts and subscription - everything that personalizes how LiquidityHQ works for you.'),
('DASHBOARD_HINT_TITLE','en','Dashboard'),
('DASHBOARD_HINT_BODY','en','Your at-a-glance market read - overall conditions, the best setup right now, and the signals worth checking before you place a trade.'),
('CALC_HINT_TITLE','en','Calculators'),
('CALC_HINT_BODY','en','Position sizing, liquidation price, PnL, risk/reward, funding cost and DCA average - plug in your numbers before you enter, with live prices one tap away.'),
('ECON_CALENDAR_HINT_TITLE','en','Economic Calendar'),
('ECON_CALENDAR_HINT_BODY','en','High-impact US macro events - FOMC, NFP, CPI, PCE, GDP and more - so you know when volatility is likely and can stay out of the chop around a release.'),
('HOURS_HINT_TITLE','en','Best Hours'),
('HOURS_HINT_BODY','en','A live local clock and 24-hour session map showing when the Asia, London and New York sessions overlap - the windows with the most volume and cleanest moves.'),
('PLAYBOOK_HINT_TITLE','en','Liquidity Playbook'),
('PLAYBOOK_HINT_BODY','en','The complete set of liquidity-hunting plays - how market makers raid stops and trap traders, and how to position with them instead of against them. Save the ones you use most.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('NEWS_HINT_TITLE','en','News'),
-- ('NEWS_HINT_BODY','en','Breaking crypto headlines and catalysts, tagged by coin and impact - see what''s actually moving the market right now and what''s just noise.'),
-- ('ALERTS_HINT_TITLE','en','Alerts'),
-- ('ALERTS_HINT_BODY','en','Set price, funding, RSI, whale and open-interest alerts per coin. When one fires you get a Telegram or push notification - toggle which are active and mute the ones you don''t need.'),
-- ('SETTINGS_HINT_TITLE','en','Settings'),
-- ('SETTINGS_HINT_BODY','en','Your trading profile, risk defaults, watchlist, notifications, connected accounts and subscription - everything that personalizes how LiquidityHQ works for you.'),
-- ('DASHBOARD_HINT_TITLE','en','Dashboard'),
-- ('DASHBOARD_HINT_BODY','en','Your at-a-glance market read - overall conditions, the best setup right now, and the signals worth checking before you place a trade.'),
-- ('CALC_HINT_TITLE','en','Calculators'),
-- ('CALC_HINT_BODY','en','Position sizing, liquidation price, PnL, risk/reward, funding cost and DCA average - plug in your numbers before you enter, with live prices one tap away.'),
-- ('ECON_CALENDAR_HINT_TITLE','en','Economic Calendar'),
-- ('ECON_CALENDAR_HINT_BODY','en','High-impact US macro events - FOMC, NFP, CPI, PCE, GDP and more - so you know when volatility is likely and can stay out of the chop around a release.'),
-- ('HOURS_HINT_TITLE','en','Best Hours'),
-- ('HOURS_HINT_BODY','en','A live local clock and 24-hour session map showing when the Asia, London and New York sessions overlap - the windows with the most volume and cleanest moves.'),
-- ('PLAYBOOK_HINT_TITLE','en','Liquidity Playbook'),
-- ('PLAYBOOK_HINT_BODY','en','The complete set of liquidity-hunting plays - how market makers raid stops and trap traders, and how to position with them instead of against them. Save the ones you use most.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
