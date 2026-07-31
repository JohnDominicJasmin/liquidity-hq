-- Suppression list for the API-health alert email (lib/healthAlert.ts).
--
-- Seeded with the three sources that are already down and already understood,
-- so the first alert email contains NEW problems rather than a recap of things
-- decided weeks ago. An ops alert whose first message is all known-noise gets
-- filtered to a folder and never read again - that failure mode is the whole
-- reason to seed this rather than ship an empty list.
--
--   rss:CryptoSlate       403 from Render's IP only. Deliberately kept in the
--                         feed list (see the comment in lib/newsFeeds.ts) - it
--                         works from a home connection, so it is left in place
--                         in case the block lifts.
--   google-trends:bitcoin Google blocks the unofficial endpoint. Confirmed
--                         failing from Render AND locally 2026-07-31, so this
--                         is the dependency, not the IP.
--   sosovalue:etf-flows   Neither host answers. Same confirmation as above.
--
-- The last two feed the Grok prompt context (googleTrends, etfFlows), which is
-- a real product decision left open: replace them, or drop the fields rather
-- than hand the model empty strings. Suppressing the ALERT does not resolve
-- that - it only stops the hourly reminder. Both still show red on /ops.
--
-- To stop hearing about a source: add its name to this array.
-- To start hearing again: remove it. No deploy needed either way.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso) and dev (wdtjhrilakoitfcezxpx,
-- table lhq_dev_app_config).

insert into lhq_app_config (key, value) values (
  'api_health_alert_suppress',
  '["rss:CryptoSlate", "google-trends:bitcoin", "sosovalue:etf-flows"]'::jsonb
)
on conflict (key) do update set value = excluded.value;

-- ── DEV ──────────────────────────────────────────────────────────────────────
-- insert into lhq_dev_app_config (key, value) values (
--   'api_health_alert_suppress',
--   '["rss:CryptoSlate", "google-trends:bitcoin", "sosovalue:etf-flows"]'::jsonb
-- )
-- on conflict (key) do update set value = excluded.value;
