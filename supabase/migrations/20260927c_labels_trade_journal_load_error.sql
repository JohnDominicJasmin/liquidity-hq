-- #1342: label rows for the Trade Journal history/stats read-error state.
--
-- The journal's History and Stats tabs used to render "no trades yet" on a
-- failed/401 read - the same confident-empty defect the tracker exists to
-- remove. The fix (components/TradeJournal.tsx) now shows a retry instead, which
-- needs two user-visible strings.
--
-- The en values here MUST match lib/labelDefaults.en.json exactly - the JSON is
-- the build-time fallback, so English renders these before this migration is
-- applied. ar/ko/ru/zh fall back to en via the labelDefaults fallback until
-- translated. WORDING PENDING OWNER SIGN-OFF (they are user-visible), routed via
-- the batch like every other label add.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention) - shared-database write, owner-gated at
-- release time.

insert into lhq_labels (key, locale, value) values
('TRADE_JOURNAL_HISTORY_LOAD_FAILED','en','Couldn''t load your trades - this doesn''t mean they''re gone.'),
('TRADE_JOURNAL_HISTORY_LOAD_RETRY','en','Try again')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('TRADE_JOURNAL_HISTORY_LOAD_FAILED','en','Couldn''t load your trades - this doesn''t mean they''re gone.'),
-- ('TRADE_JOURNAL_HISTORY_LOAD_RETRY','en','Try again')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
