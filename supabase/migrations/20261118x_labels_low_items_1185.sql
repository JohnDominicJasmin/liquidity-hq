-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- #1185 low items (PM 2026-11-17). ko/zh/ru/ar AI-drafted, not native-reviewed.
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('MARKETS_NO_SIGNALS_BANNER','en','No coin has a derivatives signal right now.'),
('MARKETS_NO_SIGNALS_BANNER','ko','지금은 파생상품 신호가 있는 코인이 없습니다.'),
('MARKETS_NO_SIGNALS_BANNER','zh','目前没有任何币种出现衍生品信号。'),
('MARKETS_NO_SIGNALS_BANNER','ru','Сейчас ни у одной монеты нет сигнала по деривативам.'),
('MARKETS_NO_SIGNALS_BANNER','ar','لا توجد عملة بإشارة مشتقات حاليًا.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('MARKETS_NO_SIGNALS_BANNER','en','No coin has a derivatives signal right now.'),
('MARKETS_NO_SIGNALS_BANNER','ko','지금은 파생상품 신호가 있는 코인이 없습니다.'),
('MARKETS_NO_SIGNALS_BANNER','zh','目前没有任何币种出现衍生品信号。'),
('MARKETS_NO_SIGNALS_BANNER','ru','Сейчас ни у одной монеты нет сигнала по деривативам.'),
('MARKETS_NO_SIGNALS_BANNER','ar','لا توجد عملة بإشارة مشتقات حاليًا.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
