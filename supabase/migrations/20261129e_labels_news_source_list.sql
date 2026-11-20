-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx. HELD: apply only after QA's 390 px render check (the list is 17 characters longer).
--
-- /news source line (label NEWS_SOURCE_LIST, PM 2026-11-20): Reuters and AP are no longer read (their direct feeds were removed 2026-07-30); the list now names the feeds lib/newsFeeds.ts reads. Same ' · ' separator. The text is language-neutral (outlet names), so every locale gets the same value. DEV holds rows for ar, en, ko, ru, zh (all the old text); PROD could not be read from this machine, and a row inserted for a locale that has none is harmless, so all five are written (upsert).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('NEWS_SOURCE_LIST','ar','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','en','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','ko','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','ru','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','zh','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('NEWS_SOURCE_LIST','ar','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','en','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','ko','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','ru','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub'),
('NEWS_SOURCE_LIST','zh','BBC · Al Jazeera · CoinDesk · CoinTelegraph · Decrypt · The Block · Bitcoin Magazine · Finnhub')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
