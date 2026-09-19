-- #1309 batch 3, round 1: three new user-facing strings, all for failure states that
-- used to be invisible.
--
--   SETTINGS_TG_STATUS_ERROR     Settings > Telegram: the status check itself failed.
--                                Used to read "Not configured", telling a user who HAS
--                                Telegram set up that they don't, on a network blip (item 16).
--   SETTINGS_PUSH_ENABLE_FAILED  Settings > push toggle: the server refused the
--                                subscription. Used to turn the toggle on anyway (item 21).
--   ONBOARDING_FLOW_SAVE_FAILED  Onboarding wizard: the profile save failed. Used to close the
--                                wizard as if done, then bring it back on the next load (item 21).
--
-- WHY ALL FIVE LOCALES, NOT ENGLISH ONLY: /api/labels serves database rows only and the
-- English fallback is client-side, so a key with no rows shows English to every ar/ko/ru/zh
-- user. The keys also carry English defaults in lib/labelDefaults.en.json, which is what
-- renders until these rows are applied.
--
-- PROPOSED WORDING, NOT APPROVED. The owner signs it off in one pass with item 14's
-- (20260919b). ar/ko/ru/zh are MACHINE-TRANSLATED and not reviewed by a native speaker, the
-- same standard as the rest of this audit's translation waves.
--
-- Purely additive: three new keys, no existing row is touched, so `on conflict do update` is
-- only a safety net for a re-run.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev,
-- wdtjhrilakoitfcezxpx). The dev section below is commented out per 20260912b's convention -
-- apply one section at a time. Shared-database write: owner-gated.

insert into lhq_labels (key, locale, value) values

('SETTINGS_TG_STATUS_ERROR','en','Couldn''t check'),
('SETTINGS_TG_STATUS_ERROR','ar','تعذّر التحقق'),
('SETTINGS_TG_STATUS_ERROR','ko','확인하지 못했습니다'),
('SETTINGS_TG_STATUS_ERROR','ru','Не удалось проверить'),
('SETTINGS_TG_STATUS_ERROR','zh','无法检查'),

('SETTINGS_PUSH_ENABLE_FAILED','en','Couldn''t turn on push notifications. Try again.'),
('SETTINGS_PUSH_ENABLE_FAILED','ar','تعذّر تفعيل الإشعارات. حاول مرة أخرى.'),
('SETTINGS_PUSH_ENABLE_FAILED','ko','푸시 알림을 켤 수 없습니다. 다시 시도해 주세요.'),
('SETTINGS_PUSH_ENABLE_FAILED','ru','Не удалось включить push-уведомления. Попробуйте ещё раз.'),
('SETTINGS_PUSH_ENABLE_FAILED','zh','无法开启推送通知。请重试。'),

('ONBOARDING_FLOW_SAVE_FAILED','en','Couldn''t save your answers. Check your connection and try again.'),
('ONBOARDING_FLOW_SAVE_FAILED','ar','تعذّر حفظ إجاباتك. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.'),
('ONBOARDING_FLOW_SAVE_FAILED','ko','답변을 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'),
('ONBOARDING_FLOW_SAVE_FAILED','ru','Не удалось сохранить ваши ответы. Проверьте подключение и попробуйте ещё раз.'),
('ONBOARDING_FLOW_SAVE_FAILED','zh','无法保存您的答案。请检查网络连接后重试。')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('SETTINGS_TG_STATUS_ERROR','en','Couldn''t check'),
-- ('SETTINGS_TG_STATUS_ERROR','ar','تعذّر التحقق'),
-- ('SETTINGS_TG_STATUS_ERROR','ko','확인하지 못했습니다'),
-- ('SETTINGS_TG_STATUS_ERROR','ru','Не удалось проверить'),
-- ('SETTINGS_TG_STATUS_ERROR','zh','无法检查'),
--
-- ('SETTINGS_PUSH_ENABLE_FAILED','en','Couldn''t turn on push notifications. Try again.'),
-- ('SETTINGS_PUSH_ENABLE_FAILED','ar','تعذّر تفعيل الإشعارات. حاول مرة أخرى.'),
-- ('SETTINGS_PUSH_ENABLE_FAILED','ko','푸시 알림을 켤 수 없습니다. 다시 시도해 주세요.'),
-- ('SETTINGS_PUSH_ENABLE_FAILED','ru','Не удалось включить push-уведомления. Попробуйте ещё раз.'),
-- ('SETTINGS_PUSH_ENABLE_FAILED','zh','无法开启推送通知。请重试。'),
--
-- ('ONBOARDING_FLOW_SAVE_FAILED','en','Couldn''t save your answers. Check your connection and try again.'),
-- ('ONBOARDING_FLOW_SAVE_FAILED','ar','تعذّر حفظ إجاباتك. تحقق من اتصالك بالإنترنت وحاول مرة أخرى.'),
-- ('ONBOARDING_FLOW_SAVE_FAILED','ko','답변을 저장하지 못했습니다. 연결을 확인하고 다시 시도해 주세요.'),
-- ('ONBOARDING_FLOW_SAVE_FAILED','ru','Не удалось сохранить ваши ответы. Проверьте подключение и попробуйте ещё раз.'),
-- ('ONBOARDING_FLOW_SAVE_FAILED','zh','无法保存您的答案。请检查网络连接后重试。')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
