-- New /faq page (app/faq/page.tsx) - the footer already linked to About,
-- Glossary, Terms, Privacy, and Disclaimer; FAQ was the obvious missing
-- sixth. English only for now - per this repo's established process
-- (pendings/I18N_MIGRATION.md), a new page ships en-first and other locales
-- (ko/zh/ar/ru already done for every other page) backfill in the next
-- scheduled translation wave, same as every other page here.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('FAQ_EYEBROW', 'en', 'SUPPORT'),
('FAQ_PAGE_TITLE', 'en', 'Frequently Asked Questions'),
('FAQ_INTRO', 'en', 'Answers to the questions we hear most - accounts, signals, alerts, and how LiquidityHQ works.'),

('FAQ_CAT_ACCOUNT_BILLING', 'en', 'Account & Billing'),
('FAQ_CAT_SIGNALS', 'en', 'How the Signals Work'),
('FAQ_CAT_ALERTS', 'en', 'Alerts & Notifications'),
('FAQ_CAT_GENERAL', 'en', 'General'),

('FAQ_Q_FREE_VS_PRO_Q', 'en', 'What''s the difference between Free and Pro?'),
('FAQ_Q_FREE_VS_PRO_A', 'en', 'Free covers the Dashboard, Briefing, News, Scanners, and full charting, plus a limited amount of AI analysis each day. Pro adds the faster timeframes, the Confluence Score, backtesting, on-chain and macro data, Telegram alerts, unlimited price alerts, and a much larger AI allowance.'),

('FAQ_Q_PRO_PRICE_Q', 'en', 'How much does Pro cost?'),
('FAQ_Q_PRO_PRICE_A', 'en', '$25 per month, cancel anytime.'),

('FAQ_Q_FREE_TRIAL_Q', 'en', 'Is there a free trial?'),
('FAQ_Q_FREE_TRIAL_A', 'en', 'Yes. Every new account gets 14 days of full Pro access automatically, no card required. You''re moved to the Free plan when the trial ends unless you upgrade.'),

('FAQ_Q_CANCEL_PLAN_Q', 'en', 'How do I cancel or change my plan?'),
('FAQ_Q_CANCEL_PLAN_A', 'en', 'Your subscription is billed through our payment processor. You can cancel anytime and you''ll keep Pro access until the end of the period you already paid for - no partial refunds, no other action needed.'),

('FAQ_Q_BUYSELL_SIGNAL_Q', 'en', 'What does a BUY or SELL signal mean?'),
('FAQ_Q_BUYSELL_SIGNAL_A', 'en', 'It''s the EMA ribbon strategy: a 9/20 EMA cross arms a direction, then the first candle that closes past the 50 EMA confirms it and prints the marker, with an entry, stop, and target shown. The same rule runs on the chart and in every alert, so they''re always describing the same signal.'),

('FAQ_Q_CONFLUENCE_SCORE_Q', 'en', 'What is the Confluence Score?'),
('FAQ_Q_CONFLUENCE_SCORE_A', 'en', 'A Pro feature that combines the EMA ribbon, order flow, multi-timeframe RSI, choppiness, and RSI divergence into a single directional score, so you don''t have to weigh five indicators yourself.'),

('FAQ_Q_FINANCIAL_ADVICE_Q', 'en', 'Is this financial advice?'),
('FAQ_Q_FINANCIAL_ADVICE_A', 'en', 'No. Everything on LiquidityHQ - signals, scores, alerts, and AI commentary - is for informational purposes only. Nothing here is a recommendation to buy, sell, or hold any asset, and we''re not a registered investment advisor.'),

('FAQ_Q_AI_DISAGREE_Q', 'en', 'Why might the AI say something different from the chart?'),
('FAQ_Q_AI_DISAGREE_A', 'en', 'LiquidityAI is powered by xAI Grok, and like any AI it can be incomplete or wrong. Treat it as a second opinion, not the final word - always check it against the raw data on the chart.'),

('FAQ_Q_TELEGRAM_SETUP_Q', 'en', 'How do I get Telegram alerts?'),
('FAQ_Q_TELEGRAM_SETUP_A', 'en', 'Telegram alerts are a Pro feature. Message our bot to get your chat ID, then paste it into Settings to connect your account.'),

('FAQ_Q_ALERT_MISMATCH_Q', 'en', 'Why didn''t an alert match what''s on the chart?'),
('FAQ_Q_ALERT_MISMATCH_A', 'en', 'Alerts use the exact same signal engine as the Arena chart, so a fired alert is always the same confirmed marker the chart is showing. If it looks out of place, check the timeframe the alert was for - it may be describing an earlier candle than the one currently in view.'),

('FAQ_Q_MUTE_ALERTS_Q', 'en', 'Can I mute specific alerts?'),
('FAQ_Q_MUTE_ALERTS_A', 'en', 'Yes. On the Alerts page you can mute by coin, by direction, or by rule, so you only get pinged for what you actually care about.'),

('FAQ_Q_ALERT_TF_CAP_Q', 'en', 'How many timeframes can I get alerts for?'),
('FAQ_Q_ALERT_TF_CAP_A', 'en', 'Up to 3 at a time, picked from every timeframe the Arena chart itself offers. Switch them anytime from the Alerts page.'),

('FAQ_Q_WHAT_IS_LHQ_Q', 'en', 'What is LiquidityHQ?'),
('FAQ_Q_WHAT_IS_LHQ_A', 'en', 'Market intelligence for active crypto traders - one dashboard for price action, order flow, sentiment, and AI-assisted signals, instead of juggling a dozen tabs.'),

('FAQ_Q_DATA_SOURCES_Q', 'en', 'Where does your data come from?'),
('FAQ_Q_DATA_SOURCES_A', 'en', 'Price, funding, and open interest data comes from Binance, Bybit, Finnhub, and Alternative.me. We do not guarantee the accuracy, completeness, or availability of any third-party feed.'),

('FAQ_Q_CUSTODY_Q', 'en', 'Do you have custody of my funds?'),
('FAQ_Q_CUSTODY_A', 'en', 'No. LiquidityHQ is a read-only analytics and alerting tool - there''s no wallet connection and we never touch or trade your funds.'),

('FAQ_Q_WHO_FOR_Q', 'en', 'Who is LiquidityHQ for?'),
('FAQ_Q_WHO_FOR_A', 'en', 'Active and retail crypto traders who want one place to read the market and get notified when it moves, instead of stitching together TradingView, exchange apps, and a Telegram bot themselves.')
on conflict (key, locale) do update set value = excluded.value;
