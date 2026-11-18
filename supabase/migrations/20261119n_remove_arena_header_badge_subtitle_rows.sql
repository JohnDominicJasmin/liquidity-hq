-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project AFTER the release deploy that removes them from the page: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
--
-- Arena header refinement (owner visual, PM spec 2026-11-18): the "LIVE · web + X" badge and the subtitle are gone from the page, so their label rows
-- (all locales) are deleted. The two keys stay in lib/labelKeys.ts for now because held migration 20261118f still carries them (the label guard
-- requires its keys registered); a later dead-key pass removes key + default together.
--
-- ===================== PROD =====================
delete from lhq_labels where key in ('ARENA_LIVE_BADGE', 'ARENA_PAGE_SUBTITLE');

-- ===================== DEV =====================
delete from lhq_dev_labels where key in ('ARENA_LIVE_BADGE', 'ARENA_PAGE_SUBTITLE');
