-- Label for the Market Structure Alerts switch on /ops/config.
--
-- Worded as an enable, not a kill switch. The three flags beside it (Grok,
-- Telegram, New signups) all turn something OFF that is otherwise running, and
-- they fail OPEN. This one is the reverse: it ships off and must be switched on
-- deliberately, and it fails CLOSED. Anyone reading the row needs to know which
-- kind it is before flipping it.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
  ('OPS_CONFIG_FEATURE_STRUCTURE_ALERTS', 'en', 'Market structure alerts (off by default - enable to start sending)')
on conflict (key, locale) do update set value = excluded.value;
