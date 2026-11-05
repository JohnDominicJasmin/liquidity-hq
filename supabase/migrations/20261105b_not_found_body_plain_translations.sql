-- NOT_FOUND_BODY: the plain sentence in every locale that has a row.
--
-- ── ALREADY APPLIED. THESE ROWS ARE LIVE ON BOTH PROJECTS AS OF 2026-11-05 ─────────────────────
--
-- **DO NOT READ THIS FILE AS PENDING WORK.** PM/DevOps applied these rows to prod and dev on
-- 2026-11-05 after the owner approved the wording, and verified each. This file is the RECORD, so
-- that "what is in the labels table" is answerable from the repository rather than only from a
-- query. Written the day after, which is why it is 20261105b and not 20261106b.
--
-- Re-running it is a no-op: each statement has `and value <> '<new value>'`, so an applied row is
-- not matched. Expect `UPDATE 0` on every statement today.
--
-- ── WHY THE WORDING CHANGED ────────────────────────────────────────────────────────────────────
--
-- Same owner ruling that produced 20261101a for `NOT_FOUND_TITLE`: plain, not clever. The body was
-- "This page got stop-hunted. The level you're looking for doesn't exist - or it was swept and
-- never came back." - trading jargon on the one page a lost or non-trading visitor is most likely
-- to hit.
--
-- ── AND THE HALF THAT THE ROWS DID NOT FIX, WHICH IS A SEPARATE PR ─────────────────────────────
--
-- **A row is not enough for this particular key, and that is the interesting part.**
-- `app/global-not-found.tsx` carries no `AppShell`, so `LabelsProvider` is its only provider, and
-- that provider seeds its map from the static `lib/labelDefaults.en.json` on first render - the
-- file's own comment says so. The DB row arrives later, from `/api/labels`, only once client JS
-- runs.
--
-- So the SERVER HTML of the 404 page renders the SHIPPED DEFAULT, not the row. Measured against
-- live production on 2026-11-06, before the default was changed:
--
--     curl https://liquidity-hq.com/<a path that does not exist>
--       "stop-hunted"                      1   <- the metaphor, in the server HTML
--       "swept and never came back"        1
--       "The page you're looking for..."   0   <- the approved row, absent
--       "Page not found"                   1   <- the TITLE was already plain
--
-- A crawler, an AI fetcher or a link-preview bot therefore still read the jargon in English after
-- these rows landed, while ko, zh, ar and ru were correct. The title did not have the problem
-- because 20261101a's change had already reached the default file.
--
-- The fix is a one-line change to `lib/labelDefaults.en.json`, in the PR that carries this file.
-- Recorded here because the next person to change a label on an outside-the-shell page needs to
-- know that the row alone does not ship it - the same present-vs-rendered distinction behind
-- #1961's no-JS SEO fix.

-- ════════════════════════════════════════════════════════════════════════════
-- PROD  (qdpwhnvmhqgzijuwopso)
-- Run this section against PROD ONLY.
-- ════════════════════════════════════════════════════════════════════════════

update lhq_labels set value = 'The page you''re looking for doesn''t exist.'
  where key = 'NOT_FOUND_BODY' and locale = 'en'
    and value <> 'The page you''re looking for doesn''t exist.';

update lhq_labels set value = '찾으시는 페이지가 존재하지 않습니다.'
  where key = 'NOT_FOUND_BODY' and locale = 'ko'
    and value <> '찾으시는 페이지가 존재하지 않습니다.';

update lhq_labels set value = '您要找的页面不存在。'
  where key = 'NOT_FOUND_BODY' and locale = 'zh'
    and value <> '您要找的页面不存在。';

update lhq_labels set value = 'الصفحة التي تبحث عنها غير موجودة.'
  where key = 'NOT_FOUND_BODY' and locale = 'ar'
    and value <> 'الصفحة التي تبحث عنها غير موجودة.';

update lhq_labels set value = 'Страница, которую вы ищете, не существует.'
  where key = 'NOT_FOUND_BODY' and locale = 'ru'
    and value <> 'Страница, которую вы ищете, не существует.';

-- ════════════════════════════════════════════════════════════════════════════
-- DEV  (wdtjhrilakoitfcezxpx)
-- Run this section against DEV ONLY. `qa` and `staging` share this project.
-- ════════════════════════════════════════════════════════════════════════════

update lhq_dev_labels set value = 'The page you''re looking for doesn''t exist.'
  where key = 'NOT_FOUND_BODY' and locale = 'en'
    and value <> 'The page you''re looking for doesn''t exist.';

update lhq_dev_labels set value = '찾으시는 페이지가 존재하지 않습니다.'
  where key = 'NOT_FOUND_BODY' and locale = 'ko'
    and value <> '찾으시는 페이지가 존재하지 않습니다.';

update lhq_dev_labels set value = '您要找的页面不存在。'
  where key = 'NOT_FOUND_BODY' and locale = 'zh'
    and value <> '您要找的页面不存在。';

update lhq_dev_labels set value = 'الصفحة التي تبحث عنها غير موجودة.'
  where key = 'NOT_FOUND_BODY' and locale = 'ar'
    and value <> 'الصفحة التي تبحث عنها غير موجودة.';

update lhq_dev_labels set value = 'Страница, которую вы ищете, не существует.'
  where key = 'NOT_FOUND_BODY' and locale = 'ru'
    and value <> 'Страница, которую вы ищете, не существует.';

-- ── VERIFY (either project, adjusting the table prefix) ───────────────────────────────────────
--
--   SELECT locale, value FROM lhq_labels
--   WHERE key = 'NOT_FOUND_BODY' ORDER BY locale;
--
-- Five rows: ar, en, ko, ru, zh, each the plain sentence in its own language. The values above were
-- read back from prod on 2026-11-06, so they are the live values rather than a transcription.
