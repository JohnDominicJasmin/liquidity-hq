-- #1152: two label rows that override a fix the code already made. The label
-- row is what a visitor reads (lib/labelDefaults.en.json only covers first
-- paint), and these rows were never updated after the code changed:
--
-- 1. FAQ_Q_FREE_VS_PRO_A (en). /faq tells visitors Pro includes BACKTESTING.
--    Backtesting is not sold (owner ruling: an internal tool). 08c93826
--    (2026-08-12) removed it from the code default and said the row needed a
--    database update; that update never happened, in either database.
--      BEFORE: "...Pro adds the faster timeframes, the Confluence Score,
--              backtesting, on-chain and macro data, Telegram alerts, unlimited
--              price alerts, and a much larger AI allowance."
--      AFTER:  the same sentence without "backtesting, " (the code default).
--    No ko/zh/ar/ru row exists for this key in either database, so there is
--    nothing wrong to fix in those languages. #1475's migration
--    (20261001c) fills them from the corrected English.
--
-- 2. DASH_EDGE_CB_TIP and DASH_EDGE_CB_LABEL (the dashboard's Coinbase-premium
--    cell). The figure is ALWAYS BTC's (app/api/coinbase-price hardcodes
--    BTC-USD), but it renders in the per-coin panel, so with SOL selected it
--    reads as SOL's. 8561d8d2 (2026-09-03) fixed the English default; the rows
--    still have the old wording, and every translation has it too.
--      TIP BEFORE (en): "Coinbase price minus Binance price, as a %. Positive = US
--                 retail buyers are paying a premium (bullish signal). Negative
--                 = US retail selling at a discount (bearish signal)."
--      TIP AFTER  (en): "Coinbase BTC price minus Binance BTC price, as a %.
--                 Always BTC, whichever coin is selected. Positive = ... (the
--                 rest unchanged)" - the code default.
--      TIP ko/zh/ar/ru: the same two changes (BTC named in the subtraction, and
--                 "always BTC, whichever coin is selected"), made to each
--                 existing translation; the rest of each sentence is unchanged.
--      LABEL BEFORE: ko "CB 프리미엄", zh "CB溢价", ar "علاوة CB", ru "Премия CB";
--                 en on dev only: "CB Premium" (production en is already
--                 "BTC CB prem").
--      LABEL AFTER:  ko "BTC CB 프리미엄", zh "BTC CB溢价", ar "علاوة CB لـ BTC",
--                 ru "Премия CB (BTC)", en "BTC CB prem" (the code default).
--
-- ENGLISH VALUES ARE THE CODE DEFAULTS, VERBATIM. THE ko/zh/ar/ru VALUES ARE
-- MACHINE-TRANSLATED from the corrected English and not checked by a native
-- speaker.
--
-- `do update`, on purpose, unlike the gap-filling translation migrations: these
-- rows exist and are wrong, so the point is to change them. Only the keys and
-- locales listed here are touched.
--
-- Run against BOTH lhq_labels (prod) and lhq_dev_labels (dev, commented out
-- below per 20260912b's convention). Shared-database write, owner-gated: PM/DevOps
-- applies it on the owner's word, right before the production deploy.
-- The dev block has one more row than production (DASH_EDGE_CB_LABEL en).

insert into lhq_labels (key, locale, value) values
('FAQ_Q_FREE_VS_PRO_A','en','Free covers the Dashboard, Briefing, News, Scanners, and full charting, plus a limited amount of AI analysis each day. Pro adds the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, unlimited price alerts, and a much larger AI allowance.'),
('DASH_EDGE_CB_TIP','en','Coinbase BTC price minus Binance BTC price, as a %. Always BTC, whichever coin is selected. Positive = US retail buyers are paying a premium (bullish signal). Negative = US retail selling at a discount (bearish signal).'),
('DASH_EDGE_CB_TIP','ko','코인베이스 BTC 가격에서 바이낸스 BTC 가격을 뺀 값을 %로 나타낸 것입니다. 어떤 코인을 선택하든 항상 BTC 기준입니다. 양수는 미국 리테일 매수자가 프리미엄을 지불하고 있다는 의미(강세 신호)이고, 음수는 미국 리테일이 할인된 가격에 매도하고 있다는 의미(약세 신호)입니다.'),
('DASH_EDGE_CB_TIP','zh','Coinbase BTC价格与Binance BTC价格的差值百分比。无论选择哪个币种，始终为BTC。正值表示US散户买家愿意支付溢价（看涨信号），负值表示US散户以折价抛售（看跌信号）。'),
('DASH_EDGE_CB_TIP','ar','الفرق بين سعر BTC على Coinbase وسعر BTC على Binance كنسبة مئوية. القيمة دائمًا لـ BTC أيًا كانت العملة المحددة. القيمة الموجبة تعني أن متداولي التجزئة الأمريكيين يدفعون علاوة سعرية (إشارة صعودية)، والقيمة السالبة تعني بيعهم بسعر أقل (إشارة هبوطية).'),
('DASH_EDGE_CB_TIP','ru','Цена BTC на Coinbase минус цена BTC на Binance, в %. Всегда BTC, какая бы монета ни была выбрана. Положительное значение = US ритейл покупает с премией (бычий сигнал). Отрицательное значение = US ритейл продаёт со скидкой (медвежий сигнал).'),
('DASH_EDGE_CB_LABEL','ko','BTC CB 프리미엄'),
('DASH_EDGE_CB_LABEL','zh','BTC CB溢价'),
('DASH_EDGE_CB_LABEL','ar','علاوة CB لـ BTC'),
('DASH_EDGE_CB_LABEL','ru','Премия CB (BTC)')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels, plus DASH_EDGE_CB_LABEL en (still
-- "CB Premium" on dev only). Apply separately (shared-database write).
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('FAQ_Q_FREE_VS_PRO_A','en','Free covers the Dashboard, Briefing, News, Scanners, and full charting, plus a limited amount of AI analysis each day. Pro adds the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, unlimited price alerts, and a much larger AI allowance.'),
-- ('DASH_EDGE_CB_TIP','en','Coinbase BTC price minus Binance BTC price, as a %. Always BTC, whichever coin is selected. Positive = US retail buyers are paying a premium (bullish signal). Negative = US retail selling at a discount (bearish signal).'),
-- ('DASH_EDGE_CB_TIP','ko','코인베이스 BTC 가격에서 바이낸스 BTC 가격을 뺀 값을 %로 나타낸 것입니다. 어떤 코인을 선택하든 항상 BTC 기준입니다. 양수는 미국 리테일 매수자가 프리미엄을 지불하고 있다는 의미(강세 신호)이고, 음수는 미국 리테일이 할인된 가격에 매도하고 있다는 의미(약세 신호)입니다.'),
-- ('DASH_EDGE_CB_TIP','zh','Coinbase BTC价格与Binance BTC价格的差值百分比。无论选择哪个币种，始终为BTC。正值表示US散户买家愿意支付溢价（看涨信号），负值表示US散户以折价抛售（看跌信号）。'),
-- ('DASH_EDGE_CB_TIP','ar','الفرق بين سعر BTC على Coinbase وسعر BTC على Binance كنسبة مئوية. القيمة دائمًا لـ BTC أيًا كانت العملة المحددة. القيمة الموجبة تعني أن متداولي التجزئة الأمريكيين يدفعون علاوة سعرية (إشارة صعودية)، والقيمة السالبة تعني بيعهم بسعر أقل (إشارة هبوطية).'),
-- ('DASH_EDGE_CB_TIP','ru','Цена BTC на Coinbase минус цена BTC на Binance, в %. Всегда BTC, какая бы монета ни была выбрана. Положительное значение = US ритейл покупает с премией (бычий сигнал). Отрицательное значение = US ритейл продаёт со скидкой (медвежий сигнал).'),
-- ('DASH_EDGE_CB_LABEL','en','BTC CB prem'),
-- ('DASH_EDGE_CB_LABEL','ko','BTC CB 프리미엄'),
-- ('DASH_EDGE_CB_LABEL','zh','BTC CB溢价'),
-- ('DASH_EDGE_CB_LABEL','ar','علاوة CB لـ BTC'),
-- ('DASH_EDGE_CB_LABEL','ru','Премия CB (BTC)')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
