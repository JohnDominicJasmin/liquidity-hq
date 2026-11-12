-- NOT YET APPLIED TO PRODUCTION. PM/DevOps applies this at release time, after the render check.
-- Nothing in this file touches the dev project: the only table named below is production's `lhq_labels`.
--
-- Two label rows the owner approved first-hand to PM on 2026-11-13. A database row silently wins over the
-- shipped default (lib/labelOverrides.ts), so production keeps showing the OLD wording until these rows are
-- written; the shipped defaults (lib/labelDefaults.en.json) already carry the new wording, in #2177 and #2152.
--
-- ── 1. NEWS_FORYOU_EMPTY_TITLE, all five locales ──────────────────────────────────────────────────
--
-- The For You tab said "Scanning for catalysts…" on a feed that had finished loading and was empty, which
-- read as still loading (#1651). The values below are the five rows ALREADY on the dev database, read
-- read-only on 2026-11-13 (en, ko, zh, ru, ar), so production gets exactly what dev has been showing.
--
-- ── 2. SPOTLIGHT_TOUR_STEP5_BODY, English only, and why ─────────────────────────────────────────────
--
-- The tour's last step claimed "scanning every major coin in real time". The scores refresh on 3 to 8 minute
-- timers (QA's measurement, #1113); only prices are live. The approved English is below.
--
-- THE FOUR NON-ENGLISH ROWS ARE NOT WRITTEN BY THIS FILE, deliberately:
--   - On the dev database all five tour rows still carry the OLD "real time" wording, including the English
--     one, so there is no translation of the approved text to copy from.
--   - The owner ruled on 2026-10-22 that machine-made translations with no native review are held: English
--     ships now, the other languages later (see 20261022d's header and 20261028a). Drafts are kept below,
--     COMMENTED OUT, for whoever gets a native reader.
-- CONSEQUENCE, stated so nobody is surprised: until a reviewed translation is written, ko, zh, ru and ar users
-- keep seeing their existing text, which still says "real time". That is the claim this change corrects in
-- English. It is the same gap the English-first ruling accepted for every other copy change.
--
-- Upserts by (key, locale): re-running is safe, and no row for any other key is touched.

insert into lhq_labels (key, locale, value) values
('NEWS_FORYOU_EMPTY_TITLE','en','No catalysts right now'),
('NEWS_FORYOU_EMPTY_TITLE','ko','지금은 촉매 뉴스가 없습니다'),
('NEWS_FORYOU_EMPTY_TITLE','zh','目前没有催化事件'),
('NEWS_FORYOU_EMPTY_TITLE','ru','Сейчас нет катализаторов'),
('NEWS_FORYOU_EMPTY_TITLE','ar','لا توجد محفزات حالياً'),
('SPOTLIGHT_TOUR_STEP5_BODY','en','LiquidityHQ checks the major coins every few minutes, with live prices. Open Arena to see the scores, pick a coin, and let LiquidityAI analyze the setup for you.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- HELD, DO NOT APPLY until a speaker of each language has read these. MACHINE-DRAFTED, NOT APPROVED.
-- Drafts of the approved English for the four locales that have no translation of it yet:
--
-- insert into lhq_labels (key, locale, value) values
-- ('SPOTLIGHT_TOUR_STEP5_BODY','ko','LiquidityHQ는 주요 코인을 몇 분마다 확인하며 실시간 가격을 제공합니다. Arena를 열어 점수를 확인하고 코인을 선택하면 LiquidityAI가 셋업을 분석해드립니다.'),
-- ('SPOTLIGHT_TOUR_STEP5_BODY','zh','LiquidityHQ 每隔几分钟检查一次主流币种,并提供实时价格。打开 Arena 查看评分,选择一个币种,让 LiquidityAI 为你分析行情设置。'),
-- ('SPOTLIGHT_TOUR_STEP5_BODY','ru','LiquidityHQ проверяет основные монеты каждые несколько минут и показывает цены в реальном времени. Откройте Arena, чтобы увидеть оценки, выберите монету и позвольте LiquidityAI проанализировать сетап за вас.'),
-- ('SPOTLIGHT_TOUR_STEP5_BODY','ar','تقوم LiquidityHQ بفحص العملات الرئيسية كل بضع دقائق مع عرض الأسعار مباشرة. افتح Arena لمشاهدة النتائج، اختر عملة، ودع LiquidityAI يحلل الإعداد نيابة عنك.')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
