-- #861: the /about subtitle says "crypto market analytics", matching the site's
-- link-preview title ("LiquidityHQ - Crypto Market Analytics", #1485). Owner's
-- decision, relayed by PM/DevOps on 2026-09-30. It was the one place left that
-- still described the product as "trading intelligence" (QA, review of #1485).
--
--   BEFORE (both databases, from 20260917a):
--     en  Liquidity Hunter HQ - crypto trading intelligence
--     ko  Liquidity Hunter HQ - 암호화폐 트레이딩 인텔리전스
--     zh  Liquidity Hunter HQ - 加密货币交易情报
--     ar  Liquidity Hunter HQ - معلومات تداول العملات المشفرة
--     ru  Liquidity Hunter HQ - криптотрейдинговая аналитика
--   AFTER: the rows below.
--
-- English equals lib/labelDefaults.en.json, changed in the same PR. ko, zh, ar
-- and ru are MACHINE-TRANSLATED from the new English, not checked by a native
-- speaker.
--
-- `do update`: the rows exist and are changing. Only this key, five locales.
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention). Shared-database write, owner-gated.

insert into lhq_labels (key, locale, value) values
('ABOUT_PAGE_SUBTITLE','en','Liquidity Hunter HQ - crypto market analytics'),
('ABOUT_PAGE_SUBTITLE','ko','Liquidity Hunter HQ - 암호화폐 시장 분석'),
('ABOUT_PAGE_SUBTITLE','zh','Liquidity Hunter HQ - 加密货币市场分析'),
('ABOUT_PAGE_SUBTITLE','ar','Liquidity Hunter HQ - تحليلات سوق العملات المشفرة'),
('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - аналитика криптовалютного рынка')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write; PM/DevOps applies after QA clears the timing).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('ABOUT_PAGE_SUBTITLE','en','Liquidity Hunter HQ - crypto market analytics'),
-- ('ABOUT_PAGE_SUBTITLE','ko','Liquidity Hunter HQ - 암호화폐 시장 분석'),
-- ('ABOUT_PAGE_SUBTITLE','zh','Liquidity Hunter HQ - 加密货币市场分析'),
-- ('ABOUT_PAGE_SUBTITLE','ar','Liquidity Hunter HQ - تحليلات سوق العملات المشفرة'),
-- ('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - аналитика криптовалютного рынка')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
