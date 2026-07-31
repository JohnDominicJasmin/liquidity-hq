-- Label for the new Market Structure factor row in the Confluence Score card.
--
-- Wording matches the other factor rows on that card: plain trader language,
-- no abbreviations, no internal names. "Market Structure" is what the Arena
-- card above it is already called, so the two read as the same idea rather
-- than two features.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
  ('CONFLUENCE_SCORE_FACTOR_STRUCTURE', 'en', 'Market Structure')
on conflict (key, locale) do update set value = excluded.value;

-- ── DEV ──────────────────────────────────────────────────────────────────────
-- insert into lhq_dev_labels (key, locale, value) values
--   ('CONFLUENCE_SCORE_FACTOR_STRUCTURE', 'en', 'Market Structure')
-- on conflict (key, locale) do update set value = excluded.value;
