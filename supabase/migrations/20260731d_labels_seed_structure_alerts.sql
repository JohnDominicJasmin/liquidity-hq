-- Copy for the Market Structure alert toggles on /alerts.
--
-- The description has one job: make clear this is a SECOND, separate system,
-- not a variant of the EMA Buy/Sell alert directly above it. Someone who
-- assumes it is the same rule will read a CHoCH as a buy signal, which it is
-- not - it is a heads-up that structure may be turning.
--
-- Wording avoids "BOS"/"CHoCH" as the headline. Those are the labels on the
-- chart markers, but a toggle in a settings list is the wrong place to teach
-- the vocabulary; the alert body itself spells both out in full.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
  ('ALERTS_STRUCTURE_TITLE', 'en', 'Market Structure Breaks'),
  ('ALERTS_STRUCTURE_DESC',  'en', 'Separate from the buy/sell signal above. Alerts when price closes through a previous swing high or low - either continuing the trend, or breaking against it as an early sign it may be turning. Read from price alone, no moving averages. Off by default.')
on conflict (key, locale) do update set value = excluded.value;
