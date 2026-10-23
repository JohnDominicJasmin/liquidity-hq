-- #1631 item 1, the owner's decision of 2026-10-23: the AI surfaces must say "AI" plainly, because his approved label - "Not
-- financial advice. You're still the one who decides your trades." - deliberately does NOT claim AI authorship. Arena's "AI Read"
-- eyebrow and the briefing's "AI Pre-Session Briefing" already did; the hypothesis card and the chat byline said "GROK", which
-- names the model to someone who knows what Grok is and names nothing to anyone else.
--
-- The chat byline is hardcoded in components/GrokChat.tsx and needs no row. This file is for the one that IS a label.
--
-- AN UPDATE, NOT AN INSERT, AND THAT IS THE POINT. HYPOTHESIS_TRACKER_GROK_VERDICT_PREFIX already exists, so a row very likely
-- exists for it in the live tables - and A LIVE ROW OVERRIDES lib/labelDefaults.en.json. Shipping the new default alone would change
-- nothing on any environment whose row is already set, and the code would look fixed while the screen kept saying "GROK:".
-- `on conflict do nothing` would have the same silent failure. So this updates the existing row and inserts only if absent.
--
-- ENGLISH ONLY. The ar/ko/ru/zh rows for this key, if they exist, are left alone - translations are held for native review, and a
-- machine translation of a heading the owner just approved is exactly the kind of change that should not ride along quietly.
--
-- NOT APPLIED. Production writes need the owner's word; the dev section is commented out (apply to dev only when QA says no test
-- pass is running). Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).
--
-- VERIFY AFTER APPLYING, do not assume: select key, locale, value from lhq_labels where key = 'HYPOTHESIS_TRACKER_GROK_VERDICT_PREFIX';
-- The en row must read 'AI VERDICT: {verdict}'. A row that still says 'GROK: {verdict}' means the update matched nothing.

insert into lhq_labels (key, locale, value) values
('HYPOTHESIS_TRACKER_GROK_VERDICT_PREFIX','en','AI VERDICT: {verdict}')
on conflict (key, locale) do update set value = excluded.value;

-- DEV: the same row against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('HYPOTHESIS_TRACKER_GROK_VERDICT_PREFIX','en','AI VERDICT: {verdict}')
-- on conflict (key, locale) do update set value = excluded.value;
