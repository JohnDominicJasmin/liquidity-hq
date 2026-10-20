-- #1596 (owner, 2026-10-20): Free AND free-trial accounts get Buy/Sell signals, Quick Research and Deep Research only on BTC, ETH and SOL. On any other coin
-- the chart is clean and the Arena shows one line plus an Upgrade button. Two NEW keys, five locales: ARENA_COIN_LOCK_LINE ({coin} is the coin's ticker,
-- e.g. XRP) and ARENA_COIN_LOCK_PANEL. New keys, so no live label row is overwritten. The Upgrade button reuses the existing TNAV_UPGRADE_LABEL.
--
-- The English text is the default in lib/labelDefaults.en.json; ar/ko/ru/zh are machine-translated by Dev and NOT native-reviewed. BTC, ETH, SOL, Pro, Free
-- and the research names stay as the app already shows them in each locale. Copy says only what the product does today.
--
-- Until these rows exist the page shows the English default in every locale (the build-time fallback), which is correct, just not translated.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says no test
-- pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('ARENA_COIN_LOCK_LINE','en','Buy/Sell signals, Quick Research and Deep Research for {coin} are available in Pro. Free includes BTC, ETH and SOL.'),
('ARENA_COIN_LOCK_LINE','ar','إشارات الشراء/البيع والبحث السريع والبحث العميق لعملة {coin} متاحة في Pro. تتضمن الخطة المجانية BTC وETH وSOL.'),
('ARENA_COIN_LOCK_LINE','ko','{coin}의 매수/매도 신호, 빠른 리서치, 심층 리서치는 Pro에서 이용할 수 있습니다. 무료 플랜에는 BTC, ETH, SOL이 포함됩니다.'),
('ARENA_COIN_LOCK_LINE','ru','Сигналы покупки/продажи, быстрое и глубокое исследование для {coin} доступны в Pro. В бесплатный тариф входят BTC, ETH и SOL.'),
('ARENA_COIN_LOCK_LINE','zh','{coin} 的买入/卖出信号、快速研究和深度研究在 Pro 中提供。免费版包含 BTC、ETH 和 SOL。'),
('ARENA_COIN_LOCK_PANEL','en','Signals for this coin are Pro only.'),
('ARENA_COIN_LOCK_PANEL','ar','إشارات هذه العملة متاحة لمشتركي Pro فقط.'),
('ARENA_COIN_LOCK_PANEL','ko','이 코인의 신호는 Pro 전용입니다.'),
('ARENA_COIN_LOCK_PANEL','ru','Сигналы по этой монете доступны только в Pro.'),
('ARENA_COIN_LOCK_PANEL','zh','该币种的信号仅限 Pro。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('ARENA_COIN_LOCK_LINE','en','Buy/Sell signals, Quick Research and Deep Research for {coin} are available in Pro. Free includes BTC, ETH and SOL.'),
-- ('ARENA_COIN_LOCK_LINE','ar','إشارات الشراء/البيع والبحث السريع والبحث العميق لعملة {coin} متاحة في Pro. تتضمن الخطة المجانية BTC وETH وSOL.'),
-- ('ARENA_COIN_LOCK_LINE','ko','{coin}의 매수/매도 신호, 빠른 리서치, 심층 리서치는 Pro에서 이용할 수 있습니다. 무료 플랜에는 BTC, ETH, SOL이 포함됩니다.'),
-- ('ARENA_COIN_LOCK_LINE','ru','Сигналы покупки/продажи, быстрое и глубокое исследование для {coin} доступны в Pro. В бесплатный тариф входят BTC, ETH и SOL.'),
-- ('ARENA_COIN_LOCK_LINE','zh','{coin} 的买入/卖出信号、快速研究和深度研究在 Pro 中提供。免费版包含 BTC、ETH 和 SOL。'),
-- ('ARENA_COIN_LOCK_PANEL','en','Signals for this coin are Pro only.'),
-- ('ARENA_COIN_LOCK_PANEL','ar','إشارات هذه العملة متاحة لمشتركي Pro فقط.'),
-- ('ARENA_COIN_LOCK_PANEL','ko','이 코인의 신호는 Pro 전용입니다.'),
-- ('ARENA_COIN_LOCK_PANEL','ru','Сигналы по этой монете доступны только в Pro.'),
-- ('ARENA_COIN_LOCK_PANEL','zh','该币种的信号仅限 Pro。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
