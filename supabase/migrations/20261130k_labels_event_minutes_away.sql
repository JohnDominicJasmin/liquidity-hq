-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- A calendar alert counts the minutes before an event starts (#1185).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('NEWS_COUNTDOWN_MINUTES','ar','خلال {n} دقيقة'),
('NEWS_COUNTDOWN_MINUTES','en','in {n} min'),
('NEWS_COUNTDOWN_MINUTES','ko','{n}분 후'),
('NEWS_COUNTDOWN_MINUTES','ru','через {n} мин'),
('NEWS_COUNTDOWN_MINUTES','zh','{n} 分钟后')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('NEWS_COUNTDOWN_MINUTES','ar','خلال {n} دقيقة'),
('NEWS_COUNTDOWN_MINUTES','en','in {n} min'),
('NEWS_COUNTDOWN_MINUTES','ko','{n}분 후'),
('NEWS_COUNTDOWN_MINUTES','ru','через {n} мин'),
('NEWS_COUNTDOWN_MINUTES','zh','{n} 分钟后')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
