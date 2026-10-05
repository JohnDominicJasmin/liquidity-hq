-- Label for the /ops AI cost card's truncation note (#1397). app/api/ops/ai-cost
-- now pages its reads past PostgREST's 1000-row cap, up to a 10,000-row bound
-- per read; if a read ever reaches that bound the response sets `truncated`
-- and AiCostCard shows this line instead of presenting a short total as exact.
-- English-only, matching the wave-13 admin-surface convention - other locales
-- fall back to English via the labels API's merge behavior. The same string is
-- in lib/labelDefaults.en.json, so the card renders it before this is applied.
--
-- FILE ONLY - not applied. Additive data row, no schema change.

-- PROD (qdpwhnvmhqgzijuwopso)
insert into lhq_labels (key, locale, value) values
('OPS_CARDS_AI_COST_TRUNCATED','en','Over 10,000 usage rows in this window - the counts and spend shown are a minimum.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV (wdtjhrilakoitfcezxpx) - run this instead against the dev project; qa
-- and staging share it.
-- insert into lhq_dev_labels (key, locale, value) values
-- ('OPS_CARDS_AI_COST_TRUNCATED','en','Over 10,000 usage rows in this window - the counts and spend shown are a minimum.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
