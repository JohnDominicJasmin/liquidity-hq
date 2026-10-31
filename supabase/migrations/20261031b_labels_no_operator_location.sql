-- Owner order, 2026-10-31: "why are u fucking mentioning where i live?", then "don't mention where is
-- the server and where country I live. Remove that shit."
--
-- The code half shipped in `fix/no-location-in-legal-copy`: SECURITY_SECTION_WHERE_BODY and
-- PRIVACY_SECTION_INTERNATIONAL_USERS_BODY in lib/labelDefaults.en.json now name the PROCESSOR and
-- the FACT of international transfer and no geography at all.
--
-- A SHIPPED DEFAULT IS NOT WHAT THE USER SEES. An lhq_labels row wins over it (lib/labelOverrides.ts,
-- #675), so /privacy keeps saying "operated from the Philippines" in every locale until these rows
-- change. That is what this file is for, and it is why the code change alone was not the fix.
--
-- SECURITY_SECTION_WHERE_BODY needs nothing here: it has NO rows in either project, so the shipped
-- default already serves it. Checked, not assumed.
--
-- HOW MANY ROWS, AND WHY THE FIRST COUNT WAS WRONG. A sweep for the English word "Philippines"
-- returned ONE prod row. The same sweep including the translated forms returned TWELVE, because four
-- of the five privacy rows are translated and say it in their own script:
--
--     en  "LiquidityHQ is operated from the Philippines..."
--     ar  "يُشغَّل LiquidityHQ من الفلبين..."
--     ko  "LiquidityHQ는 필리핀에서 운영됩니다..."
--     ru  "LiquidityHQ управляется с территории Филиппин..."
--     zh  "LiquidityHQ 由菲律宾团队运营..."   <- "operated by a Philippine TEAM", worse than the others
--
-- **THE ABBREVIATION IS THE HIDING PLACE.** The other seven of those twelve are `HOURS_*` rows saying
-- "PHT", which contains none of the words any sweep was looking for. Any future sweep for a sensitive
-- term must include its abbreviations, its codes and its translated forms.
--
-- `/hours` IS NOT IN THIS FILE, DELIBERATELY. Those rows label every trading window in Philippine
-- time on a page shown worldwide - which both names his country and is the wrong timezone for the
-- reader. The fix is the viewer's local time with UTC in brackets, which is a FEATURE change needing
-- his visual sign-off, not a copy strip. Bundling it here would make this file unreviewable and hold
-- an urgent fix behind a product decision. Separate branch, separate ask, not this release.
--
-- THE TWO PROJECTS DIFFER AND THAT WAS MEASURED, NOT ASSUMED:
--
--     prod (lhq_labels)      12 rows carry the country:  5 privacy + 7 HOURS_* (ar and zh only)
--     dev  (lhq_dev_labels)  40 rows:                    5 privacy + 35 HOURS_* (all five locales)
--
-- So dev/qa/staging show it in more places than production does. Only the 5 privacy rows are in scope
-- here, in both projects.
--
-- NOT APPLIED. This is a write to the shared database, which is the owner's approval and nobody
-- else's. Neither PM nor Dev applies it, and a relay of his approval through another session does not
-- count - it goes to him directly.
--
-- ============================ THE ONE OPEN DECISION ============================
--
-- `en` is an UPDATE to the neutral text. The four translated rows are a choice, and the applied path
-- below DELETES them. What that does: `t()` falls back to lib/labelDefaults.en.json, so a Korean,
-- Russian or Chinese reader sees the neutral sentence in ENGLISH rather than a sentence naming the
-- country in their own language.
--
--   WHY DELETE IS RECOMMENDED. Translating legal wording needs a native reader, and this project has
--   held translations for native review before - so UPDATE-with-a-translation is a decision with a
--   cost and a delay, while the country stays live in four languages in the meantime. Untranslated
--   English is already the state of some label rows here, so it is not a new compromise.
--
--   `ar` IS DELETED REGARDLESS. Arabic is not an offered locale (#138), so every `ar` row is dead
--   weight - and this one is dead weight carrying his country in full words.
--
--   IF HE WANTS TRANSLATIONS INSTEAD, use the commented block at the bottom and supply the four
--   strings. Do NOT machine-translate a legal disclosure into a language nobody here reads.
--
-- WHAT MUST SURVIVE, and the reason the sentence is replaced rather than deleted: the policy still has
-- to disclose that data may be processed outside the user's own country and point at the safeguard.
-- That duty is about disclosing the TRANSFER, not about naming the destination. Deleting the sentence
-- would trade a wording complaint for an incomplete legal page.
--
-- AND NOT A VAGUER LOCATION. No "Asia-Pacific", no "South East Asia". He said no location, so the
-- answer is no location rather than a coarser one.

-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================

update lhq_labels
   set value = 'Your data may be transferred to and processed outside your own country by our hosting and service providers. By using the Platform, you consent to this transfer.'
 where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY'
   and locale = 'en';

delete from lhq_labels
 where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY'
   and locale in ('ar', 'ko', 'ru', 'zh');

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
-- Commented out: applies only in the QA DDL window. Same rows, prefixed table (lib/tables.ts).
--
-- update lhq_dev_labels
--    set value = 'Your data may be transferred to and processed outside your own country by our hosting and service providers. By using the Platform, you consent to this transfer.'
--  where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY'
--    and locale = 'en';
--
-- delete from lhq_dev_labels
--  where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY'
--    and locale in ('ar', 'ko', 'ru', 'zh');

-- ===================== VERIFY AFTER APPLYING, per project =====================
--
--   select locale, left(value, 60) from lhq_labels
--    where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY';
--   -- expect exactly ONE row, locale 'en', starting "Your data may be transferred"
--
-- AND THE SWEEP THAT FOUND THIS, re-run - the point is that the first version of it was too narrow:
--
--   select key, locale from lhq_labels
--    where value ilike '%philippines%' or value like '%필리핀%' or value like '%菲律宾%'
--       or value like '%الفلبين%'      or value like '%Филиппин%' or value like '%Pilipinas%'
--       or value ilike '%seoul%'       or value ilike '%south korea%' or value ilike '%ap-northeast%';
--   -- expect ONLY HOURS_* rows to remain (those are /hours, tracked separately).
--   -- A result of ZERO rows means the sweep is broken, not that the table is clean: the HOURS_*
--   -- rows are still there by design until /hours is decided. Zero is the tell.
--
--   Then read the RENDERED /privacy in each locale, not the JSON and not this table. A row can be
--   right and a page still wrong if the default is being read from a stale build.

-- ===================== ALTERNATIVE: TRANSLATE RATHER THAN DELETE =====================
-- Only if the owner chooses translations AND a native reader has supplied them. Replace each
-- <...> with the translated equivalent of the English above, keeping the transfer disclosure and
-- naming no country, city or region. `ar` is still deleted: it is not an offered locale.
--
-- update lhq_labels set value = '<ko>' where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY' and locale = 'ko';
-- update lhq_labels set value = '<ru>' where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY' and locale = 'ru';
-- update lhq_labels set value = '<zh>' where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY' and locale = 'zh';
-- delete from lhq_labels where key = 'PRIVACY_SECTION_INTERNATIONAL_USERS_BODY' and locale = 'ar';
