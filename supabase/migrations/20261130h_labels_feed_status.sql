-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- The price feed chip, shown only while prices are not live (#1651).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('FEED_STATUS_BACKUP','ar','مصدر احتياطي'),
('FEED_STATUS_BACKUP','en','Backup feed'),
('FEED_STATUS_BACKUP','ko','백업 피드'),
('FEED_STATUS_BACKUP','ru','Резервный поток'),
('FEED_STATUS_BACKUP','zh','备用数据源'),
('FEED_STATUS_DELAYED','ar','متأخر'),
('FEED_STATUS_DELAYED','en','Delayed'),
('FEED_STATUS_DELAYED','ko','지연'),
('FEED_STATUS_DELAYED','ru','С задержкой'),
('FEED_STATUS_DELAYED','zh','延迟'),
('FEED_STATUS_AS_OF','ar','حتى {time}'),
('FEED_STATUS_AS_OF','en','as of {time}'),
('FEED_STATUS_AS_OF','ko','{time} 기준'),
('FEED_STATUS_AS_OF','ru','на {time}'),
('FEED_STATUS_AS_OF','zh','截至 {time}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('FEED_STATUS_BACKUP','ar','مصدر احتياطي'),
('FEED_STATUS_BACKUP','en','Backup feed'),
('FEED_STATUS_BACKUP','ko','백업 피드'),
('FEED_STATUS_BACKUP','ru','Резервный поток'),
('FEED_STATUS_BACKUP','zh','备用数据源'),
('FEED_STATUS_DELAYED','ar','متأخر'),
('FEED_STATUS_DELAYED','en','Delayed'),
('FEED_STATUS_DELAYED','ko','지연'),
('FEED_STATUS_DELAYED','ru','С задержкой'),
('FEED_STATUS_DELAYED','zh','延迟'),
('FEED_STATUS_AS_OF','ar','حتى {time}'),
('FEED_STATUS_AS_OF','en','as of {time}'),
('FEED_STATUS_AS_OF','ko','{time} 기준'),
('FEED_STATUS_AS_OF','ru','на {time}'),
('FEED_STATUS_AS_OF','zh','截至 {time}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
