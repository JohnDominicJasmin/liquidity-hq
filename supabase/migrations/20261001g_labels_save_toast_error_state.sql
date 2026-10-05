-- #1498: the settings save toast moved to top-centre (owner, 2026-10-01), and
-- its error state became an alert with a real retry button and a close X
-- instead of the one line "Couldn't save - try again". Three new labels:
--
--   SETTINGS_SAVE_FAILED_TITLE  "Couldn't save"
--   SETTINGS_SAVE_RETRY_BUTTON  "Try again"
--   SETTINGS_SAVE_DISMISS_ARIA  "Dismiss"   (the X's accessible name)
--
-- English equals lib/labelDefaults.en.json (the build-time fallback, so English
-- renders before this is applied). ko, zh, ar and ru are MACHINE-TRANSLATED,
-- not checked by a native speaker; until applied they fall back to English.
-- New keys, so `do nothing` on conflict. The old SETTINGS_STATUS_FAILED stays
-- registered and is no longer rendered.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention). Shared-database write, owner-gated.

insert into lhq_labels (key, locale, value) values
('SETTINGS_SAVE_FAILED_TITLE','en','Couldn''t save'),
('SETTINGS_SAVE_FAILED_TITLE','ko','저장하지 못했습니다'),
('SETTINGS_SAVE_FAILED_TITLE','zh','保存失败'),
('SETTINGS_SAVE_FAILED_TITLE','ar','تعذّر الحفظ'),
('SETTINGS_SAVE_FAILED_TITLE','ru','Не удалось сохранить'),
('SETTINGS_SAVE_RETRY_BUTTON','en','Try again'),
('SETTINGS_SAVE_RETRY_BUTTON','ko','다시 시도'),
('SETTINGS_SAVE_RETRY_BUTTON','zh','重试'),
('SETTINGS_SAVE_RETRY_BUTTON','ar','إعادة المحاولة'),
('SETTINGS_SAVE_RETRY_BUTTON','ru','Повторить'),
('SETTINGS_SAVE_DISMISS_ARIA','en','Dismiss'),
('SETTINGS_SAVE_DISMISS_ARIA','ko','닫기'),
('SETTINGS_SAVE_DISMISS_ARIA','zh','关闭'),
('SETTINGS_SAVE_DISMISS_ARIA','ar','إغلاق'),
('SETTINGS_SAVE_DISMISS_ARIA','ru','Закрыть')
on conflict (key, locale) do nothing;

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write; PM/DevOps applies after QA clears the timing).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('SETTINGS_SAVE_FAILED_TITLE','en','Couldn''t save'),
-- ('SETTINGS_SAVE_FAILED_TITLE','ko','저장하지 못했습니다'),
-- ('SETTINGS_SAVE_FAILED_TITLE','zh','保存失败'),
-- ('SETTINGS_SAVE_FAILED_TITLE','ar','تعذّر الحفظ'),
-- ('SETTINGS_SAVE_FAILED_TITLE','ru','Не удалось сохранить'),
-- ('SETTINGS_SAVE_RETRY_BUTTON','en','Try again'),
-- ('SETTINGS_SAVE_RETRY_BUTTON','ko','다시 시도'),
-- ('SETTINGS_SAVE_RETRY_BUTTON','zh','重试'),
-- ('SETTINGS_SAVE_RETRY_BUTTON','ar','إعادة المحاولة'),
-- ('SETTINGS_SAVE_RETRY_BUTTON','ru','Повторить'),
-- ('SETTINGS_SAVE_DISMISS_ARIA','en','Dismiss'),
-- ('SETTINGS_SAVE_DISMISS_ARIA','ko','닫기'),
-- ('SETTINGS_SAVE_DISMISS_ARIA','zh','关闭'),
-- ('SETTINGS_SAVE_DISMISS_ARIA','ar','إغلاق'),
-- ('SETTINGS_SAVE_DISMISS_ARIA','ru','Закрыть')
-- on conflict (key, locale) do nothing;
