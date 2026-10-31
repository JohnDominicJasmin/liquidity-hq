-- A RE-RUNNABLE SWEEP: remove any label row that names the operator's country, city, region or
-- timezone.
--
-- Safe to run at any time, as often as you like. It is a NO-OP against the current state of both
-- projects, and it exists for the state AFTER a replay.
--
-- **IT IS A SWEEP, NOT A GUARD, AND IT WAS NAMED `guard_no_reseeded_location` UNTIL QA READ IT.**
-- The executable content is two `delete from` statements. There is no trigger, no constraint and
-- nothing standing - so if one of the eight seed files is replayed AFTER this file is applied, the
-- rows come back and nothing removes them. **The ordering it depends on is the ordering nobody
-- controls**, and a file called "guard" invites a reader to assume otherwise. Renamed rather than
-- strengthened under a deadline.
--
-- WHAT ACTUALLY SCALES IS THE HEADER ON EACH SEED FILE, which tells a replayer to run this
-- afterwards: it stops the replay rather than cleaning up after it. A trigger would additionally
-- catch a row hand-inserted from the Supabase dashboard, which no migration ordering can reach -
-- worth considering, not worth doing today.
--
-- ============================ WHY THIS FILE EXISTS ============================
--
-- The owner, 2026-10-31: "don't mention where is the server and where country I live. Remove that
-- shit." The rows were deleted by hand (see 20261031b) and the shipped defaults were rewritten.
--
-- BUT EIGHT EARLIER SEED MIGRATIONS STILL CONTAIN THE OLD TEXT, and they have to:
--
--     20260723g_labels_seed_privacy          20260723z_labels_seed_hours
--     20260724c_labels_seed_news             20260727h_user_settings_timezone
--     20260731a_labels_seed_translation_ko   20260801a_labels_seed_translation_zh
--     20260802a_labels_seed_translation_ar   20260803f_labels_governing_law_neutral
--
-- A migration is the RECORD of what was applied. Editing one to remove the text would make the file
-- claim it inserted something it never inserted - the same reason 20261031b is kept as a record
-- rather than deleted. So the history stays honest and the risk is handled here instead.
--
-- THE RISK IS A REPLAY, AND NOTHING WATCHES FOR IT. A fresh Supabase project, a restore, or a new
-- environment re-runs those seeds and puts the country straight back into `lhq_labels` - in five
-- locales, including translated forms that no English sweep would find. Nobody would notice,
-- because no check looks for it. Run this after any replay and the problem cannot survive.
--
-- ============================ WHAT IT MATCHES, AND WHY THAT SHAPE ============================
--
-- IT DELETES BY **VALUE**, NOT BY KEY, AND THAT DISTINCTION IS THE WHOLE DESIGN.
--
-- Five of the thirteen affected keys currently hold CORRECT, neutral rows in production -
-- HOURS_SUBTITLE is "Live local clock + session window detector", NEWS_EVENTS_FOOTER_NOTE is
-- "...Times in your local time". Measured, 5 rows each. **A delete by key would throw those away**
-- and fall back to the shipped English default for every locale, which is a localisation regression
-- dressed as a privacy fix.
--
-- So it removes a row only if that row's TEXT carries the location. A correct row is untouched, a
-- re-seeded row is removed, and running it twice does nothing the first run did not.
--
-- THE SEARCH TERMS INCLUDE THE ABBREVIATION AND EVERY SCRIPT, because that is what the whole purge
-- turned on: a sweep for the English word "Philippines" found ONE row of forty. "PHT" was carrying
-- twenty-eight of them, and four of the five privacy rows said the country in their own script.
-- **Any future term added here needs its abbreviation, its IANA identifier and its translations, or
-- this sweep will report clean while a row sits there.**
--
-- `%PHT%` IS A THREE-LETTER SUBSTRING AND THAT WAS CHECKED RATHER THAN ASSUMED (QA). It is the
-- shape that quietly deletes a row containing "naphtha". Measured across everything a replay could
-- insert - the 2,845-key defaults file and every seed migration - **`pht` appears only as the
-- standalone token `PHT`**, so no false-positive class exists here. **If a future value could
-- contain the letters in a word, this predicate needs a word boundary before it is applied again.**
--
-- THE REGION HALF IS DELIBERATELY UNCOVERED, and saying so is the point (QA). The owner ordered the
-- server location removed as well as the country, and this sweep only matches country and timezone
-- terms. **It costs nothing: no seed migration carries `Seoul`, `South Korea`, `ap-northeast` or
-- `Singapore`** - measured, with a control that the same grep finds the country terms in 10 of
-- those files. So there is nothing for a region sweep to catch on a replay. **The asymmetry is
-- recorded because the next reader would otherwise see it and wonder which half was forgotten** -
-- and because the same asymmetry already bit once today: a sweep that covered the country was
-- reported as covering the order, and one hit in a QA tool survived it.

-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================

delete from lhq_labels
 where value ilike '%PHT%'
    or value ilike '%philippine%'
    or value ilike '%philippines%'
    or value ilike '%asia/manila%'
    or value like '%필리핀%'
    or value like '%菲律宾%'
    or value like '%الفلبين%'
    or value like '%Филиппин%'
    or value like '%Pilipinas%';

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
-- Same statement, prefixed table (lib/tables.ts). ACTIVE, not commented: dev/qa/staging share this
-- project, so a commented half is how prod gets guarded and the site QA tests does not - which is
-- exactly the defect QA caught in 20261031b.

delete from lhq_dev_labels
 where value ilike '%PHT%'
    or value ilike '%philippine%'
    or value ilike '%philippines%'
    or value ilike '%asia/manila%'
    or value like '%필리핀%'
    or value like '%菲律宾%'
    or value like '%الفلبين%'
    or value like '%Филиппин%'
    or value like '%Pilipinas%';

-- ===================== VERIFY, per project =====================
--
-- Run the same predicate as a SELECT and expect zero:
--
--   select key, locale, left(value, 60) from lhq_labels
--    where value ilike '%PHT%' or value ilike '%philippine%' or value like '%필리핀%'
--       or value like '%菲律宾%' or value like '%الفلبين%' or value like '%Филиппин%';
--
-- AND A CONTROL, because a zero here could mean a clean table or a broken predicate:
--
--   select count(*) from lhq_labels where key like 'HOURS_%';   -- expect ~295 on prod, ~293 on dev
--
-- Without that second number, "0 rows" is not a result. It is the same control that made the
-- original deletion believable, and the reason it is written down here is that the first sweep of
-- this problem returned 1 row and was believed.
--
-- THEN READ THE RENDERED PAGES, not this table: /privacy, /security and /hours, in each locale. A
-- row can be right and a page still wrong if a stale build is serving an old default.
