-- AUTH_GATE_*, COIN_SELECT_*, PAGE_HINT_*, THEME_CHIPS_* rows. Run once
-- against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('AUTH_GATE_TITLE','en','Sign in required'),
('AUTH_GATE_DESC','en','Create a free account to access this feature.'),
('AUTH_GATE_SIGN_IN_BUTTON','en','Sign In'),
('COIN_SELECT_PLACEHOLDER','en','Select coins…'),
('COIN_SELECT_SEARCH_PLACEHOLDER','en','Search coins…'),
('COIN_SELECT_NO_MATCH','en','No coins match "{search}"'),
('COIN_SELECT_CLEAR_ALL','en','Clear all ({count})'),
('PAGE_HINT_DISMISS_LABEL','en','Dismiss hint'),
('THEME_CHIPS_DARK','en','Dark'),
('THEME_CHIPS_LIGHT','en','Light')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
