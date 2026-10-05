-- #1511 / #1263: /api/grok now refuses a fast-timeframe read (1m/5m/15m) for a
-- confirmed free account with 403 PRO_REQUIRED, and Arena's AI-read banner
-- showed that raw code. It now shows a labelled line plus an "Upgrade" link
-- (the link reuses TNAV_UPGRADE_LABEL). One new label, PM-approved copy:
--
--   ARENA_READ_FAST_TF_PRO_REQUIRED  "Fast timeframes (1m, 5m, 15m) are part of Pro."
--
-- English equals lib/labelDefaults.en.json (the build-time fallback, so English
-- renders before this is applied). en row only: ko, zh, ar and ru follow in a
-- separate migration and fall back to English until then.
-- New key, so `do nothing` on conflict.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention). Shared-database write, owner-gated.

insert into lhq_labels (key, locale, value) values
('ARENA_READ_FAST_TF_PRO_REQUIRED','en','Fast timeframes (1m, 5m, 15m) are part of Pro.')
on conflict (key, locale) do nothing;

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write; PM/DevOps applies after QA clears the timing).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('ARENA_READ_FAST_TF_PRO_REQUIRED','en','Fast timeframes (1m, 5m, 15m) are part of Pro.')
-- on conflict (key, locale) do nothing;
