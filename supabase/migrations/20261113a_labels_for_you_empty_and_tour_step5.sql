-- NOT YET APPLIED TO PRODUCTION. PM/DevOps applies this at release time, after the render check.
-- Nothing in this file touches the dev project: the only table named below is production's `lhq_labels`.
-- NO DEV BLOCK IS NEEDED, and that was checked rather than assumed (read-only, 2026-11-13): dev's `lhq_dev_labels` already holds all ten rows (NEWS_FORYOU_EMPTY_TITLE and SPOTLIGHT_TOUR_STEP5_BODY, five locales each) with this wording, so qa and staging already render it.
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
-- ── 2. SPOTLIGHT_TOUR_STEP5_BODY, all five locales ───────────────────────────────────────────────────
--
-- The tour's last step claimed "scanning every major coin in real time". The scores refresh on 3 to 8 minute
-- timers (QA's measurement, #1113); only prices are live. The approved English is below.
--
-- THE FOUR NON-ENGLISH ROWS ARE MACHINE-DRAFTED AND NOT NATIVE-REVIEWED, AND THAT IS THE OWNER'S DECISION FOR THIS KEY.
-- On 2026-11-13 the owner ruled first-hand, via PM, to ship them now: native review comes later. That overrides the
-- 2026-10-22 rule (machine-made translations with no native review are held; see 20261022d's header and 20261028a) for
-- this one key only. Each was re-read against the English before it was uncommented, and each says the same three things:
-- the coins are checked every few minutes, prices are live, and Arena shows the scores and the AI read. None says "real
-- time" about the scanning, none promises 24/7 or continuous coverage, and none names a vendor or model ("LiquidityAI"
-- is the product's own name, as in the English). Until a native reader has been through them, treat them as drafts.
--
-- Upserts by (key, locale): re-running is safe, and no row for any other key is touched.

insert into lhq_labels (key, locale, value) values
('NEWS_FORYOU_EMPTY_TITLE','en','No catalysts right now'),
('NEWS_FORYOU_EMPTY_TITLE','ko','지금은 촉매 뉴스가 없습니다'),
('NEWS_FORYOU_EMPTY_TITLE','zh','目前没有催化事件'),
('NEWS_FORYOU_EMPTY_TITLE','ru','Сейчас нет катализаторов'),
('NEWS_FORYOU_EMPTY_TITLE','ar','لا توجد محفزات حالياً'),
('SPOTLIGHT_TOUR_STEP5_BODY','en','LiquidityHQ checks the major coins every few minutes, with live prices. Open Arena to see the scores, pick a coin, and let LiquidityAI analyze the setup for you.'),
('SPOTLIGHT_TOUR_STEP5_BODY','ko','LiquidityHQ는 주요 코인을 몇 분마다 확인하며 실시간 가격을 제공합니다. Arena를 열어 점수를 확인하고 코인을 선택하면 LiquidityAI가 셋업을 분석해드립니다.'),
('SPOTLIGHT_TOUR_STEP5_BODY','zh','LiquidityHQ 每隔几分钟检查一次主流币种，并提供实时价格。打开 Arena 查看评分，选择一个币种，让 LiquidityAI 为你分析行情设置。'),
('SPOTLIGHT_TOUR_STEP5_BODY','ru','LiquidityHQ проверяет основные монеты каждые несколько минут и показывает цены в реальном времени. Откройте Arena, чтобы увидеть оценки, выберите монету и позвольте LiquidityAI проанализировать сетап за вас.'),
('SPOTLIGHT_TOUR_STEP5_BODY','ar','تقوم LiquidityHQ بفحص العملات الرئيسية كل بضع دقائق مع عرض الأسعار مباشرة. افتح Arena لمشاهدة النتائج، اختر عملة، ودع LiquidityAI يحلل الإعداد نيابة عنك.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
