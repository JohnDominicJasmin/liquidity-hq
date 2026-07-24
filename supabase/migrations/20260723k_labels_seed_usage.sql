-- USAGE_METER_*, USAGE_RINGS_* rows. Run once against BOTH lhq_labels (prod)
-- and lhq_dev_labels (dev).

insert into lhq_labels (key, locale, value) values
('USAGE_METER_QUICK_LABEL','en','Quick'),
('USAGE_METER_LEFT_SUFFIX','en','/{limit} left'),
('USAGE_METER_DEEP_LABEL','en','Deep'),
('USAGE_METER_RESETS_IN','en','resets in {countdown}'),
('USAGE_METER_UPGRADE_LINK','en','Upgrade →'),
('USAGE_RINGS_QUICK','en','Quick'),
('USAGE_RINGS_DEEP','en','Deep'),
('USAGE_RINGS_CHAT','en','Chat'),
('USAGE_RINGS_SEARCH','en','Search'),
('USAGE_RINGS_BRIEFING','en','Briefing'),
('USAGE_RINGS_HEADER','en','AI calls remaining today'),
('USAGE_RINGS_RESETS_AT','en','Resets at {time}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
