-- QA's prod re-check on release #4 (#1334) found one non-blocking leftover:
-- `ABOUT_STEP4_TEXT`'s ko/zh rows (from #1329/PR B) rendered "실시간 신호" /
-- "实时信号" ("real-time signals") for the exact spot the corrected English
-- says "live signals" - a plausible machine-translation choice for "live"
-- that happens to carry the "real-time" connotation item 38 removed in
-- English. en/ar/ru already say the neutral equivalent (ar's "المباشرة",
-- ru's "живым" - both "live", not "real-time") and are untouched here.
--
-- Fix: drop the "실시간"/"实时" modifier entirely, same treatment the hero
-- badge and features.sub already got in lib/i18n/dictionaries.ts (this PR) -
-- "dozens of signals", not "dozens of live/real-time signals".
--
-- ko/zh remain MACHINE-TRANSLATED (not reviewed by a native speaker), same
-- standard as the rest of this audit's translation waves - this is a
-- correction of a specific flagged phrase, not a claim of translation
-- quality.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx). The dev section below is
-- commented out per 20260912b's convention - apply separately, and this is
-- a shared-database write that needs the owner's go at release time.

insert into lhq_labels (key, locale, value) values

('ABOUT_STEP4_TEXT','ko','수십 개의 신호에 대한 Grok의 분석을 받아 명확한 트레이드 방향을 얻습니다.'),
('ABOUT_STEP4_TEXT','zh','获取Grok对数十个信号的解读，得出明确的交易方向。')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('ABOUT_STEP4_TEXT','ko','수십 개의 신호에 대한 Grok의 분석을 받아 명확한 트레이드 방향을 얻습니다.'),
-- ('ABOUT_STEP4_TEXT','zh','获取Grok对数十个信号的解读，得出明确的交易方向。')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
