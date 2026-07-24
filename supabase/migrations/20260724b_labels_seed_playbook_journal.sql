-- PLAYBOOK_*, JOURNAL_* rows (app/playbook/page.tsx, app/journal/page.tsx).
-- Run once against BOTH lhq_labels (prod) and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('PLAYBOOK_PAGE_TITLE','en','Liquidity Playbook'),
('PLAYBOOK_SUBTITLE','en','{count} plays - the complete predator playbook'),
('PLAYBOOK_SEARCH_PLACEHOLDER','en','Search plays...'),
('PLAYBOOK_CAT_ALL','en','All'),
('PLAYBOOK_CAT_FAV_EMPTY','en','★ Saved'),
('PLAYBOOK_CAT_FAV_COUNT','en','★ Saved ({count})'),
('PLAYBOOK_CAT_HUNT','en','Hunt'),
('PLAYBOOK_CAT_TIME','en','Timing'),
('PLAYBOOK_CAT_TRAP','en','Trap'),
('PLAYBOOK_CAT_PSYCH','en','Psychology'),
('PLAYBOOK_NO_FAVS','en','No saved plays yet - tap ★ on any play to pin it.'),
('PLAYBOOK_NO_MATCHES','en','No plays match that search.'),
('PLAYBOOK_PLAY_NUMBER','en','PLAY #{n}'),
('PLAYBOOK_UNSAVE_TITLE','en','Remove from saved'),
('PLAYBOOK_SAVE_TITLE','en','Save play'),
('JOURNAL_HINT_TITLE','en','Trade Journal'),
('JOURNAL_HINT_BODY','en','Log every trade you take, then review your win rate, streak, and patterns over time. The more you log, the clearer your edge becomes.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
