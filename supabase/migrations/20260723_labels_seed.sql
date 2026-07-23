-- English baseline for the i18n pilot (Prices page + Settings page/modal).
-- Seeded so switching the label system on is a no-op visually - every key
-- a pilot page references already resolves to its current English text.
-- Other locales fall back to these rows until translated (see
-- app/api/labels/route.ts). Safe to re-run.
--
-- Run once in the Supabase SQL Editor against BOTH prefixed tables
-- (lhq_labels for prod, lhq_dev_labels for dev).

insert into lhq_labels (key, locale, value) values
('PRICES_BACK_LABEL','en','← Back'),
('PRICES_PAGE_TITLE','en','Live Prices'),
('PRICES_SUBTITLE','en','{count} coins · {status}'),
('PRICES_LIVE_BADGE','en','Live'),
('PRICES_COL_COIN','en','Coin'),
('PRICES_COL_PRICE','en','Price'),
('PRICES_COL_CHANGE','en','24h'),
('PRICES_LOADING_SR','en','Loading live prices…'),
('PRICES_VOL_PREFIX','en','Vol'),
('PRICES_OI_PREFIX','en','Open Interest'),
('SETTINGS_PAGE_TITLE','en','Settings'),
('SETTINGS_SECTION_ACCOUNT','en','Account'),
('SETTINGS_SECTION_WATCHLIST','en','My Watchlist'),
('SETTINGS_SECTION_TRADING_PROFILE','en','Trading Profile'),
('SETTINGS_SECTION_ARENA_DEFAULTS','en','AI Arena Defaults'),
('SETTINGS_SECTION_NOTIFICATIONS','en','Notification Thresholds'),
('SETTINGS_SECTION_APPEARANCE','en','Appearance'),
('SETTINGS_SECTION_TELEGRAM','en','Telegram Alerts'),
('SETTINGS_SIGNED_IN_AS','en','Signed in as'),
('SETTINGS_SIGN_OUT_BUTTON','en','Sign Out'),
('SETTINGS_WATCHLIST_DESC','en','Select coins to track in your watchlist feed on the dashboard.'),
('SETTINGS_FIELD_ACCOUNT_SIZE','en','Account Size'),
('SETTINGS_FIELD_RISK_PER_TRADE','en','Risk Per Trade'),
('SETTINGS_AT_RISK_PREFIX','en','At risk per trade:'),
('SETTINGS_FIELD_DEFAULT_COIN','en','Default Coin'),
('SETTINGS_FIELD_DEFAULT_TF','en','Default Timeframe'),
('SETTINGS_NOTIF_DESC','en','Browser push - get alerts even when the tab is closed.'),
('SETTINGS_FIELD_PUSH_NOTIFICATIONS','en','Push Notifications'),
('SETTINGS_PUSH_ACTIVE','en','Active on this device'),
('SETTINGS_PUSH_INACTIVE','en','Not enabled on this device'),
('SETTINGS_TEST_PUSH_BUTTON','en','Send test notification'),
('SETTINGS_TEST_PUSH_SENT','en','Notification sent'),
('SETTINGS_TEST_PUSH_FAILED','en','Failed - check console'),
('SETTINGS_FIELD_FUNDING_TRIGGER','en','Funding Rate trigger'),
('SETTINGS_FIELD_FEAR_BELOW','en','Extreme Fear below'),
('SETTINGS_FIELD_GREED_ABOVE','en','Extreme Greed above'),
('SETTINGS_FIELD_RSI_OB','en','RSI 1h overbought'),
('SETTINGS_FIELD_RSI_OS','en','RSI 1h oversold'),
('SETTINGS_FIELD_SQUEEZE_SCORE','en','Squeeze/Flush alert score'),
('SETTINGS_NOTIF_NOTE','en','RSI and Squeeze/Flush thresholds apply to both browser push and Telegram alerts. Other thresholds (funding rate, Fear & Greed) are browser push only for now.'),
('SETTINGS_FIELD_THEME','en','Theme'),
('SETTINGS_FIELD_STATUS','en','Status'),
('SETTINGS_TG_CHECKING','en','Checking…'),
('SETTINGS_TG_CONFIGURED','en','Configured'),
('SETTINGS_TG_NOT_CONFIGURED','en','Not configured'),
('SETTINGS_TG_MANAGE_LINK','en','Manage alerts →'),
('SETTINGS_TG_SETUP_LINK','en','Set up Telegram →'),
('SETTINGS_STATUS_SAVING','en','Saving…'),
('SETTINGS_STATUS_SAVED','en','Saved ✓'),
('SETTINGS_STATUS_FAILED','en','Failed')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
