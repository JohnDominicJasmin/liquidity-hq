-- DASH_SELECTED_COIN_OPEN_ARENA - accessible title/tooltip for the dashboard's
-- selected-coin glance card, now a link to /arena?coin=X. The card showed the
-- coin's price and one signal with no way to jump straight to Arena for that
-- same coin - had to go through Arena's own coin picker instead.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('DASH_SELECTED_COIN_OPEN_ARENA', 'en', 'Open {coin} in Arena'),
('DASH_SELECTED_COIN_OPEN_ARENA', 'ko', 'Arena에서 {coin} 열기'),
('DASH_SELECTED_COIN_OPEN_ARENA', 'zh', '在 Arena 中打开 {coin}'),
('DASH_SELECTED_COIN_OPEN_ARENA', 'ar', 'افتح {coin} في Arena'),
('DASH_SELECTED_COIN_OPEN_ARENA', 'ru', 'Открыть {coin} в Arena')
on conflict (key, locale) do update set value = excluded.value;
