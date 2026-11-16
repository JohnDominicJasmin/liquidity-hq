-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- /research: the volatility regime hints and the stablecoin card state facts, not instructions or predictions (PM, 2026-11-16). The en rows are REQUIRED, not optional: a stored en row overrides the shipped default, and the old
-- advice wording ("Reduce exposure or hedge", "bullish dry powder") is stored in lhq_labels / lhq_dev_labels (20260727a, 20260728a). ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('VOLATILITY_REGIME_HINT_LOW','en','Volatility is low compared with its own recent range'),
('VOLATILITY_REGIME_HINT_NEUTRAL','en','Volatility is within its usual range'),
('VOLATILITY_REGIME_HINT_HIGH','en','Volatility is high compared with its own recent range'),
('DRY_POWDER_TOOLTIP','en','Total stablecoin supply (USDT, USDC, DAI, etc.) from DeFi Llama, with its change over 30 and 90 days. The text below is an AI summary of those figures.'),
('DRY_POWDER_WATCH_LABEL','en','Supply: '),
('VOLATILITY_REGIME_HINT_LOW','ko','변동성이 최근 범위에 비해 낮습니다'),
('VOLATILITY_REGIME_HINT_NEUTRAL','ko','변동성이 평소 범위 안에 있습니다'),
('VOLATILITY_REGIME_HINT_HIGH','ko','변동성이 최근 범위에 비해 높습니다'),
('DRY_POWDER_TOOLTIP','ko','DeFi Llama의 전체 스테이블코인 공급량(USDT, USDC, DAI 등)과 30일·90일 변화입니다. 아래 글은 이 수치를 요약한 AI 문장입니다.'),
('DRY_POWDER_WATCH_LABEL','ko','공급량: '),
('VOLATILITY_REGIME_HINT_LOW','zh','波动率低于其近期区间'),
('VOLATILITY_REGIME_HINT_NEUTRAL','zh','波动率处于其常见区间内'),
('VOLATILITY_REGIME_HINT_HIGH','zh','波动率高于其近期区间'),
('DRY_POWDER_TOOLTIP','zh','来自 DeFi Llama 的稳定币总供应量(USDT、USDC、DAI 等)及其 30 天和 90 天变化。下方文字是对这些数字的 AI 摘要。'),
('DRY_POWDER_WATCH_LABEL','zh','供应量: '),
('VOLATILITY_REGIME_HINT_LOW','ru','Волатильность ниже своего недавнего диапазона'),
('VOLATILITY_REGIME_HINT_NEUTRAL','ru','Волатильность в своём обычном диапазоне'),
('VOLATILITY_REGIME_HINT_HIGH','ru','Волатильность выше своего недавнего диапазона'),
('DRY_POWDER_TOOLTIP','ru','Общее предложение стейблкоинов (USDT, USDC, DAI и др.) по данным DeFi Llama и его изменение за 30 и 90 дней. Текст ниже — ИИ-сводка этих цифр.'),
('DRY_POWDER_WATCH_LABEL','ru','Предложение: ')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('VOLATILITY_REGIME_HINT_LOW','en','Volatility is low compared with its own recent range'),
('VOLATILITY_REGIME_HINT_NEUTRAL','en','Volatility is within its usual range'),
('VOLATILITY_REGIME_HINT_HIGH','en','Volatility is high compared with its own recent range'),
('DRY_POWDER_TOOLTIP','en','Total stablecoin supply (USDT, USDC, DAI, etc.) from DeFi Llama, with its change over 30 and 90 days. The text below is an AI summary of those figures.'),
('DRY_POWDER_WATCH_LABEL','en','Supply: '),
('VOLATILITY_REGIME_HINT_LOW','ko','변동성이 최근 범위에 비해 낮습니다'),
('VOLATILITY_REGIME_HINT_NEUTRAL','ko','변동성이 평소 범위 안에 있습니다'),
('VOLATILITY_REGIME_HINT_HIGH','ko','변동성이 최근 범위에 비해 높습니다'),
('DRY_POWDER_TOOLTIP','ko','DeFi Llama의 전체 스테이블코인 공급량(USDT, USDC, DAI 등)과 30일·90일 변화입니다. 아래 글은 이 수치를 요약한 AI 문장입니다.'),
('DRY_POWDER_WATCH_LABEL','ko','공급량: '),
('VOLATILITY_REGIME_HINT_LOW','zh','波动率低于其近期区间'),
('VOLATILITY_REGIME_HINT_NEUTRAL','zh','波动率处于其常见区间内'),
('VOLATILITY_REGIME_HINT_HIGH','zh','波动率高于其近期区间'),
('DRY_POWDER_TOOLTIP','zh','来自 DeFi Llama 的稳定币总供应量(USDT、USDC、DAI 等)及其 30 天和 90 天变化。下方文字是对这些数字的 AI 摘要。'),
('DRY_POWDER_WATCH_LABEL','zh','供应量: '),
('VOLATILITY_REGIME_HINT_LOW','ru','Волатильность ниже своего недавнего диапазона'),
('VOLATILITY_REGIME_HINT_NEUTRAL','ru','Волатильность в своём обычном диапазоне'),
('VOLATILITY_REGIME_HINT_HIGH','ru','Волатильность выше своего недавнего диапазона'),
('DRY_POWDER_TOOLTIP','ru','Общее предложение стейблкоинов (USDT, USDC, DAI и др.) по данным DeFi Llama и его изменение за 30 и 90 дней. Текст ниже — ИИ-сводка этих цифр.'),
('DRY_POWDER_WATCH_LABEL','ru','Предложение: ')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
