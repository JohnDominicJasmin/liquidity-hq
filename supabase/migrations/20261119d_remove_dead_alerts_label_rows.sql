-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso AFTER the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Dead-label cleanup (PM 2026-11-18): ten Alerts labels that no page, component or route reads (no call site anywhere; found while cutting wordy text). Their rows in every locale are deleted; the English defaults are removed in the same change. Nothing renders them, so nothing changes on screen.
--
-- ===================== PROD =====================
delete from lhq_labels where key in ('ALERTS_EMA_SETUP_4H_TITLE', 'ALERTS_EMA_SETUP_4H_DESC', 'ALERTS_EMA_SETUP_1H_TITLE', 'ALERTS_EMA_SETUP_1H_DESC', 'ALERTS_EMA_SETUP_30M_TITLE', 'ALERTS_EMA_SETUP_30M_DESC', 'ALERTS_EMA_SETUP_15M_TITLE', 'ALERTS_EMA_SETUP_15M_DESC', 'ALERTS_EMA_CROSS_TITLE', 'ALERTS_NO_HISTORY_TITLE');

-- ===================== DEV =====================
delete from lhq_dev_labels where key in ('ALERTS_EMA_SETUP_4H_TITLE', 'ALERTS_EMA_SETUP_4H_DESC', 'ALERTS_EMA_SETUP_1H_TITLE', 'ALERTS_EMA_SETUP_1H_DESC', 'ALERTS_EMA_SETUP_30M_TITLE', 'ALERTS_EMA_SETUP_30M_DESC', 'ALERTS_EMA_SETUP_15M_TITLE', 'ALERTS_EMA_SETUP_15M_DESC', 'ALERTS_EMA_CROSS_TITLE', 'ALERTS_NO_HISTORY_TITLE');
