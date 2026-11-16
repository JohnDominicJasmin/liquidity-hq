-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The News events table shows its Impact column again (#2403 + #2454: impact is per event type, High or Medium). These are the plain words for the two values; the en rows equal the shipped defaults. ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('NEWS_EVENTS_IMPACT_WORD_HIGH','en','High'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','ko','높음'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','zh','高'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','ru','Высокое'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','ar','مرتفع'),
('NEWS_EVENTS_IMPACT_WORD_MED','en','Medium'),
('NEWS_EVENTS_IMPACT_WORD_MED','ko','보통'),
('NEWS_EVENTS_IMPACT_WORD_MED','zh','中'),
('NEWS_EVENTS_IMPACT_WORD_MED','ru','Среднее'),
('NEWS_EVENTS_IMPACT_WORD_MED','ar','متوسط')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('NEWS_EVENTS_IMPACT_WORD_HIGH','en','High'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','ko','높음'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','zh','高'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','ru','Высокое'),
('NEWS_EVENTS_IMPACT_WORD_HIGH','ar','مرتفع'),
('NEWS_EVENTS_IMPACT_WORD_MED','en','Medium'),
('NEWS_EVENTS_IMPACT_WORD_MED','ko','보통'),
('NEWS_EVENTS_IMPACT_WORD_MED','zh','中'),
('NEWS_EVENTS_IMPACT_WORD_MED','ru','Среднее'),
('NEWS_EVENTS_IMPACT_WORD_MED','ar','متوسط')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
