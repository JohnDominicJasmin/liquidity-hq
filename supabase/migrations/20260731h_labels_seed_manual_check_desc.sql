-- Scope line under "Manual Check" on /alerts.
--
-- The result copy is "No conditions active right now.", which without this
-- line reads as a claim about every alert type. The check only covers the two
-- rules the user picks coins and timeframes for on that page - the buy/sell
-- (EMA) rule and market-structure breaks. Says plainly that it does not send,
-- because the button used to run the real alert cron and a user who remembers
-- that would reasonably expect a Telegram message to arrive.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
  ('ALERTS_MANUAL_CHECK_DESC', 'en',
   'Checks your buy/sell and market structure rules against live prices right now, for the coins and timeframes you selected above. Shows what is active - it does not send anything.')
on conflict (key, locale) do update set value = excluded.value;

-- ── DEV ──────────────────────────────────────────────────────────────────────
-- insert into lhq_dev_labels (key, locale, value) values
--   ('ALERTS_MANUAL_CHECK_DESC', 'en',
--    'Checks your buy/sell and market structure rules against live prices right now, for the coins and timeframes you selected above. Shows what is active - it does not send anything.')
-- on conflict (key, locale) do update set value = excluded.value;
