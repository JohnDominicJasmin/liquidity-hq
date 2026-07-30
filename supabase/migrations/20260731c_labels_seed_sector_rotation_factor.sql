-- Label for the Sector Rotation factor in the Confluence Score.
--
-- Appears only for alts - majors omit the factor entirely, because "is capital
-- rotating into alts" is not a meaningful question about BTC itself, and would
-- mislead for ETH, which leads the alt complex rather than following it.
--
-- Wording matches the other factor labels ("EMA Ribbon", "Order Flow Setup",
-- "Multi-TF RSI Alignment"): the name of the signal, not a verdict. The
-- bull/bear reading is carried by the row's own colour, so the label must stay
-- directionally neutral or it will contradict the factor on half the renders.
--
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
  ('CONFLUENCE_SCORE_FACTOR_SECTOR_ROTATION', 'en', 'Sector Rotation (BTC vs Alts)')
on conflict (key, locale) do update set value = excluded.value;
