-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso AFTER the release deploy that removes the line; DEV on wdtjhrilakoitfcezxpx.
--
-- Owner 2026-11-18: the "Signals, not predictions. Past alerts moved the alert's way about half the time at 24 hours." line is removed from the Alerts page (and from Telegram signal alerts, in code). No page reads ALERTS_SIGNALS_NOT_PREDICTIONS any more, so its rows (all locales, added by 20261114b) are deleted. STRAT_NOT_PREDICTIONS (Strategy panel) is NOT touched.
--
-- ===================== PROD =====================
delete from lhq_labels where key in ('ALERTS_SIGNALS_NOT_PREDICTIONS');

-- ===================== DEV =====================
delete from lhq_dev_labels where key in ('ALERTS_SIGNALS_NOT_PREDICTIONS');
