-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Label for the liquidation feed's one-venue note (components/LiqFeed.tsx): shown when the stored 24 h history holds rows from only one exchange. English ships in lib/labelDefaults.en.json and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('LIQ_FEED_HISTORY_ONE_VENUE','ko','24시간 기록: {venue}만'),
('LIQ_FEED_HISTORY_ONE_VENUE','zh','24 小时记录：仅 {venue}'),
('LIQ_FEED_HISTORY_ONE_VENUE','ru','История за 24 ч: только {venue}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('LIQ_FEED_HISTORY_ONE_VENUE','ko','24시간 기록: {venue}만'),
('LIQ_FEED_HISTORY_ONE_VENUE','zh','24 小时记录：仅 {venue}'),
('LIQ_FEED_HISTORY_ONE_VENUE','ru','История за 24 ч: только {venue}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
