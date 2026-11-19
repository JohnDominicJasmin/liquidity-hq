-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- BRIEFING_YEN_DANGER_DESC also drops its association claim ("Yen carry-trade unwinds have coincided with past crypto selloffs."): the line states the level only (QA note on #2653).
-- The Macro strip states the USD/JPY level and the gold move, it does not forecast (PM 2026-11-19, #1185: 'Carry trade stable', 'BOJ intervention risk', 'Gold falling -> risk appetite up' read as predictions). 3 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   MACRO_STRIP_GOLD_DOWN 'Gold falling'   MACRO_STRIP_JPY_INTERVENTION 'USD/JPY at or above 160'   MACRO_STRIP_JPY_CARRY_STABLE 'USD/JPY below 158'
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('BRIEFING_YEN_DANGER_DESC','en','USD/JPY is at or above 160.'),
('BRIEFING_YEN_DANGER_DESC','ko','USD/JPY가 160 이상입니다.'),
('BRIEFING_YEN_DANGER_DESC','zh','USD/JPY 在 160 或以上。'),
('BRIEFING_YEN_DANGER_DESC','ru','USD/JPY на уровне 160 или выше.'),
('BRIEFING_YEN_DANGER_DESC','ar','USD/JPY عند 160 أو أعلى.'),
('MACRO_STRIP_GOLD_DOWN','en','Gold falling'),
('MACRO_STRIP_GOLD_DOWN','ko','금 하락'),
('MACRO_STRIP_GOLD_DOWN','zh','黄金下跌'),
('MACRO_STRIP_GOLD_DOWN','ru','Золото падает'),
('MACRO_STRIP_GOLD_DOWN','ar','الذهب يهبط'),
('MACRO_STRIP_JPY_INTERVENTION','en','USD/JPY at or above 160'),
('MACRO_STRIP_JPY_INTERVENTION','ko','USD/JPY 160 이상'),
('MACRO_STRIP_JPY_INTERVENTION','zh','USD/JPY 在 160 以上'),
('MACRO_STRIP_JPY_INTERVENTION','ru','USD/JPY от 160'),
('MACRO_STRIP_JPY_INTERVENTION','ar','USD/JPY عند 160 أو أعلى'),
('MACRO_STRIP_JPY_CARRY_STABLE','en','USD/JPY below 158'),
('MACRO_STRIP_JPY_CARRY_STABLE','ko','USD/JPY 158 미만'),
('MACRO_STRIP_JPY_CARRY_STABLE','zh','USD/JPY 低于 158'),
('MACRO_STRIP_JPY_CARRY_STABLE','ru','USD/JPY ниже 158'),
('MACRO_STRIP_JPY_CARRY_STABLE','ar','USD/JPY أقل من 158')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('BRIEFING_YEN_DANGER_DESC','en','USD/JPY is at or above 160.'),
('BRIEFING_YEN_DANGER_DESC','ko','USD/JPY가 160 이상입니다.'),
('BRIEFING_YEN_DANGER_DESC','zh','USD/JPY 在 160 或以上。'),
('BRIEFING_YEN_DANGER_DESC','ru','USD/JPY на уровне 160 или выше.'),
('BRIEFING_YEN_DANGER_DESC','ar','USD/JPY عند 160 أو أعلى.'),
('MACRO_STRIP_GOLD_DOWN','en','Gold falling'),
('MACRO_STRIP_GOLD_DOWN','ko','금 하락'),
('MACRO_STRIP_GOLD_DOWN','zh','黄金下跌'),
('MACRO_STRIP_GOLD_DOWN','ru','Золото падает'),
('MACRO_STRIP_GOLD_DOWN','ar','الذهب يهبط'),
('MACRO_STRIP_JPY_INTERVENTION','en','USD/JPY at or above 160'),
('MACRO_STRIP_JPY_INTERVENTION','ko','USD/JPY 160 이상'),
('MACRO_STRIP_JPY_INTERVENTION','zh','USD/JPY 在 160 以上'),
('MACRO_STRIP_JPY_INTERVENTION','ru','USD/JPY от 160'),
('MACRO_STRIP_JPY_INTERVENTION','ar','USD/JPY عند 160 أو أعلى'),
('MACRO_STRIP_JPY_CARRY_STABLE','en','USD/JPY below 158'),
('MACRO_STRIP_JPY_CARRY_STABLE','ko','USD/JPY 158 미만'),
('MACRO_STRIP_JPY_CARRY_STABLE','zh','USD/JPY 低于 158'),
('MACRO_STRIP_JPY_CARRY_STABLE','ru','USD/JPY ниже 158'),
('MACRO_STRIP_JPY_CARRY_STABLE','ar','USD/JPY أقل من 158')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
