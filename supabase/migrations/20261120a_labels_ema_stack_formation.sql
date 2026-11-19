-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- EMA stack signals on its formation only (PM 2026-11-19). 2 keys x 5 locales; en equals the shipped defaults. ko/zh/ru/ar AI-drafted, not native-reviewed.
--   STRAT_EMASTACK_DESC / STRAT_EMASTACK_WAIT  changed: the pullback signal is gone; the stack signals on its formation after 10+ candles out of order.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_EMASTACK_DESC','en','EMAs 20/50/100/200 newly stacked in order after 10+ candles out of order.'),
('STRAT_EMASTACK_DESC','ko','EMA 20/50/100/200이 10캔들 이상 어긋나 있다가 새로 순서대로 정렬됨.'),
('STRAT_EMASTACK_DESC','zh','EMA 20/50/100/200 在错序 10 根以上 K 线后重新按顺序排列。'),
('STRAT_EMASTACK_DESC','ru','EMA 20/50/100/200 заново выстроились по порядку после 10+ свечей без порядка.'),
('STRAT_EMASTACK_DESC','ar','تشكلت EMA 20/50/100/200 بالترتيب من جديد بعد 10 شموع أو أكثر خارج الترتيب.'),
('STRAT_EMASTACK_WAIT','en','EMAs mixed, or the stack formed too long ago.'),
('STRAT_EMASTACK_WAIT','ko','EMA가 섞여 있거나, 정렬된 지 너무 오래되었습니다.'),
('STRAT_EMASTACK_WAIT','zh','EMA 排列混乱，或排列形成已过久。'),
('STRAT_EMASTACK_WAIT','ru','EMA перемешаны, или стек сформировался слишком давно.'),
('STRAT_EMASTACK_WAIT','ar','المتوسطات مختلطة، أو تشكل الترتيب منذ وقت طويل.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_EMASTACK_DESC','en','EMAs 20/50/100/200 newly stacked in order after 10+ candles out of order.'),
('STRAT_EMASTACK_DESC','ko','EMA 20/50/100/200이 10캔들 이상 어긋나 있다가 새로 순서대로 정렬됨.'),
('STRAT_EMASTACK_DESC','zh','EMA 20/50/100/200 在错序 10 根以上 K 线后重新按顺序排列。'),
('STRAT_EMASTACK_DESC','ru','EMA 20/50/100/200 заново выстроились по порядку после 10+ свечей без порядка.'),
('STRAT_EMASTACK_DESC','ar','تشكلت EMA 20/50/100/200 بالترتيب من جديد بعد 10 شموع أو أكثر خارج الترتيب.'),
('STRAT_EMASTACK_WAIT','en','EMAs mixed, or the stack formed too long ago.'),
('STRAT_EMASTACK_WAIT','ko','EMA가 섞여 있거나, 정렬된 지 너무 오래되었습니다.'),
('STRAT_EMASTACK_WAIT','zh','EMA 排列混乱，或排列形成已过久。'),
('STRAT_EMASTACK_WAIT','ru','EMA перемешаны, или стек сформировался слишком давно.'),
('STRAT_EMASTACK_WAIT','ar','المتوسطات مختلطة، أو تشكل الترتيب منذ وقت طويل.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
