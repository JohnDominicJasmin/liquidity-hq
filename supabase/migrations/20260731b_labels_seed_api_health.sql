-- Copy for the External API Health card on /ops.
--
-- The note text is the important one. It states the rule the card is built on -
-- a source counts as healthy only when it returns usable data, not when it
-- returns HTTP 200 - because the failure that motivated this whole card was a
-- feed answering 200 OK with an HTML page and zero items in it. Anyone reading
-- the card later needs to know it is not a status-code monitor, or they will
-- misread a green row.
--
-- Source names and failure details are deliberately NOT labels: they are
-- technical identifiers ('rss:BBC World', 'HTTP 500') generated at runtime,
-- and translating them would make them harder to match against logs.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
  ('OPS_CARDS_API_HEALTH_TITLE', 'en', 'External API Health'),
  ('OPS_CARDS_API_HEALTH_OK',    'en', 'Healthy'),
  ('OPS_CARDS_API_HEALTH_WARN',  'en', 'Degraded'),
  ('OPS_CARDS_API_HEALTH_DOWN',  'en', 'Down'),
  ('OPS_CARDS_API_HEALTH_EMPTY', 'en', 'No health data yet - the ingest jobs write this on their next run.'),
  ('OPS_CARDS_API_HEALTH_NOTE',  'en', 'Written by the ingest jobs each run, not probed separately. A source counts as healthy only when it returns usable data - an HTTP 200 carrying zero items is recorded as a failure. Percentage is the success rate over the last 50 checks. "Down" means three or more consecutive failures.')
on conflict (key, locale) do update set value = excluded.value;
