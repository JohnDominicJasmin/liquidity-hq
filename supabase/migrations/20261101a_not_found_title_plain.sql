-- NOT_FOUND_TITLE: "Liquidity not found" -> "Page not found", in every locale that has a row.
--
-- THE OWNER REJECTED THE WORDING ON 2026-11-01: "It should be page not found not liquidity not
-- found." Plain, not clever.
--
-- ── WHY THIS FILE EXISTS AT ALL, WHICH IS THE PART WORTH READING ────────────────────────────────
--
-- Changing `lib/labelDefaults.en.json` DOES NOT CHANGE THE PAGE. A row in the labels table beats
-- the shipped default, and `NOT_FOUND_TITLE` has one in five locales in BOTH projects. That was
-- not assumed - it was demonstrated: the default was edited to "404 - Page not found", the page
-- was reloaded, and it still rendered "404 - Liquidity not found".
--
--     file default : 404 - Page not found
--     rendered     : 404 - Liquidity not found     <- the row won
--
-- So the file edit alone would have shipped nothing, and the PR would have looked correct while
-- production kept the rejected wording.
--
-- FIVE LOCALES, NOT THREE. en, ko, zh, ar AND ru. The seed files in this directory cover ko, zh and
-- ar, so enumerating from the seeds would have missed `ru` entirely and left one language saying
-- "Ликвидность не найдена" after every other one changed. The locale list here comes from querying
-- both tables, not from reading the migrations.
--
-- ── NOT APPLIED BY THIS SESSION ─────────────────────────────────────────────────────────────────
--
-- A write to the shared database is one of the three things that go to the OWNER directly, however
-- it is relayed. This file is the prepared change, not an applied one. It is also why the
-- screenshots that accompany this work still show the old headline: the size and contrast fixes are
-- real and visible, the wording is blocked on this.
--
-- SAFE TO RUN MORE THAN ONCE. Matching on the old value rather than on the key means a second run
-- updates nothing, and a row an editor has since changed by hand is left alone instead of being
-- stamped over.

-- ── PRODUCTION (qdpwhnvmhqgzijuwopso) ───────────────────────────────────────────────────────────
update lhq_labels set value = '404 - Page not found'
  where key = 'NOT_FOUND_TITLE' and locale = 'en' and value = '404 - Liquidity not found';

update lhq_labels set value = '404 - 페이지를 찾을 수 없음'
  where key = 'NOT_FOUND_TITLE' and locale = 'ko' and value = '404 - 유동성을 찾을 수 없음';

update lhq_labels set value = '404 - 页面未找到'
  where key = 'NOT_FOUND_TITLE' and locale = 'zh' and value = '404 - 流动性未找到';

update lhq_labels set value = '404 - الصفحة غير موجودة'
  where key = 'NOT_FOUND_TITLE' and locale = 'ar' and value = '404 - السيولة غير موجودة';

update lhq_labels set value = '404 - Страница не найдена'
  where key = 'NOT_FOUND_TITLE' and locale = 'ru' and value = '404 - Ликвидность не найдена';

-- ── DEV / QA / STAGING (wdtjhrilakoitfcezxpx) ───────────────────────────────────────────────────
-- Same five rows, same values. The prefix differs because lib/tables.ts prefixes dev tables; the
-- three environments share this one database, so this covers qa and staging too.
update lhq_dev_labels set value = '404 - Page not found'
  where key = 'NOT_FOUND_TITLE' and locale = 'en' and value = '404 - Liquidity not found';

update lhq_dev_labels set value = '404 - 페이지를 찾을 수 없음'
  where key = 'NOT_FOUND_TITLE' and locale = 'ko' and value = '404 - 유동성을 찾을 수 없음';

update lhq_dev_labels set value = '404 - 页面未找到'
  where key = 'NOT_FOUND_TITLE' and locale = 'zh' and value = '404 - 流动性未找到';

update lhq_dev_labels set value = '404 - الصفحة غير موجودة'
  where key = 'NOT_FOUND_TITLE' and locale = 'ar' and value = '404 - السيولة غير موجودة';

update lhq_dev_labels set value = '404 - Страница не найдена'
  where key = 'NOT_FOUND_TITLE' and locale = 'ru' and value = '404 - Ликвидность не найдена';

-- ── WHAT THIS DELIBERATELY DOES NOT TOUCH ───────────────────────────────────────────────────────
--
-- `NOT_FOUND_BODY` - "This page got stop-hunted. The level you're looking for doesn't exist - or it
-- was swept and never came back." It is the same trading joke as the headline the owner just
-- rejected, and pulling half a joke can read as broken rather than fixed. But he named the headline
-- and only the headline, and he had approved this copy in the round before.
--
-- **So it is asked, not assumed.** Deciding for him what he would accept is what cost this project
-- the Arena redesign three times. If he says the subtitle goes plain too, the replacement is one
-- more block in this shape, in the same five locales.
