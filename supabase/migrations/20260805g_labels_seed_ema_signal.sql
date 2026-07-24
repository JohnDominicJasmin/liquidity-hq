-- Labels for the new EMA Buy/Sell Signal timeframe picker on /alerts,
-- replacing the removed ALERTS_EMA_SETUP_*/ALERTS_EMA_CROSS_* keys (dropped
-- from lib/labelKeys.ts - see pendings/ALERTS.md). English-only for now,
-- matching the paused-translation convention (PENDING.md) - falls back to
-- English on every other locale via the labels API's merge behavior.
-- Applied live against both lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx) via execute_sql.

insert into lhq_labels (key, locale, value) values
('ALERTS_EMA_SIGNAL_TITLE','en','EMA Buy/Sell Signal'),
('ALERTS_EMA_SIGNAL_DESC','en','The same confirmed buy or sell call your Arena chart draws, with entry, stop loss, and target included. Choose which timeframes to receive it on below.'),
('ALERTS_TF_COUNT','en','Timeframes - {onCount}/{cap} on'),
('ALERTS_TF_OVER_LIMIT','en','Timeframes - {onCount} on (limit {cap} - turn some off)'),
('ALERTS_TF_CAP_REACHED_MSG','en','Limit reached ({cap}/{cap} timeframes) - turn one off to add another.'),
('ALERTS_TF_CAP_OVER_MSG','en','You have {onCount} timeframes on, above the {cap}-timeframe limit - turn some off before adding another.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- Same 6 rows, run against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).

-- Stale-reference fix: ALERTS_COIN_SELECTION_DESC (existing key, both
-- projects) named "EMA Ribbon Setup" / its translated equivalent - that
-- feature no longer exists under that name. Updated all 5 done locales
-- (en/ko/zh/ar/ru), both projects - only the "EMA Ribbon Setup [entry
-- signals]" noun phrase changed in each, rest of each sentence untouched:
update lhq_labels set value = 'Tap a coin to stop all alerts for it, including which coins the EMA Buy/Sell Signal scans. Your saved price alerts are not affected.', updated_at = now() where key = 'ALERTS_COIN_SELECTION_DESC' and locale = 'en';
update lhq_labels set value = '코인을 탭하면 EMA 매수/매도 신호가 스캔하는 대상을 포함해 해당 코인의 모든 알림이 중지됩니다. 저장된 가격 알림에는 영향을 주지 않습니다.', updated_at = now() where key = 'ALERTS_COIN_SELECTION_DESC' and locale = 'ko';
update lhq_labels set value = '点击某币种可停用其所有警报，包括EMA买卖信号的扫描范围，不影响你已保存的价格警报', updated_at = now() where key = 'ALERTS_COIN_SELECTION_DESC' and locale = 'zh';
update lhq_labels set value = 'اضغط على عملة لإيقاف جميع تنبيهاتها، بما في ذلك العملات التي تفحصها إشارة الشراء/البيع EMA. تنبيهات الأسعار المحفوظة لديك لن تتأثر.', updated_at = now() where key = 'ALERTS_COIN_SELECTION_DESC' and locale = 'ar';
update lhq_labels set value = 'Нажмите на монету, чтобы отключить для неё все оповещения, включая то, какие монеты сканирует сигнал покупки/продажи EMA. Ваши сохранённые ценовые оповещения при этом не затрагиваются.', updated_at = now() where key = 'ALERTS_COIN_SELECTION_DESC' and locale = 'ru';
-- Same 5 statements against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).

-- Cleanup: the 10 keys these replace (ALERTS_SECTION_TRADING_SIGNALS,
-- ALERTS_EMA_SETUP_4H/1H/30M/15M_TITLE/DESC, ALERTS_SECTION_TREND,
-- ALERTS_EMA_CROSS_TITLE/DESC) are no longer referenced anywhere in the code
-- (checked: only lib/labelKeys.ts had them, already removed from there too).
-- Leaving the old rows in lhq_labels/lhq_dev_labels is harmless (the labels
-- API only ever looks up keys the code actually asks for), so no delete
-- statement here - stale but inert rows, consistent with how this project
-- has handled prior key removals.
