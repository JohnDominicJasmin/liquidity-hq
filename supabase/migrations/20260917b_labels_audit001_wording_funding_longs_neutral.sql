-- Antislop follow-up (#1309): FUNDING_SIG_LONGS_OVERCROWDED_DESC still ended
-- with "Whales have incentive to dump price and mass-liquidate these longs."
-- after PR A's pass - the SHORTS twin (FUNDING_SIG_SHORTS_OVERCROWDED_DESC,
-- 20260917_labels_audit001_wording_batch2_pr_a.sql) already got the neutral
-- funding-tip ending; this applies the same treatment here. Owner-approved
-- in chat, per PM/DevOps.
--
-- en is the source of truth and matches lib/labelDefaults.en.json exactly.
-- ko/zh/ar/ru are MACHINE-TRANSLATED (not reviewed by a native speaker),
-- same standard as the rest of this audit's translation waves.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx). The dev section below is
-- commented out per 20260912b's convention - apply separately, and this is
-- a shared-database write that needs the owner's go at release time.

insert into lhq_labels (key, locale, value) values

('FUNDING_SIG_LONGS_OVERCROWDED_DESC','en','The market is extremely long-heavy. Traders are paying 0.05%+ every 8h just to stay long - they are overleveraged. This is unsustainable, raising the risk of a long-liquidation cascade if price drops.'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ko','시장이 극도로 롱에 치우쳐 있습니다. 트레이더들은 롱 포지션을 유지하기 위해 8시간마다 0.05% 이상을 지불하고 있으며, 이는 과도한 레버리지 상태입니다. 이는 지속 불가능하며, 가격이 하락하면 롱 포지션의 연쇄 청산 위험이 커집니다.'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','zh','市场极度偏多。交易者为维持多头每8小时支付0.05%以上的费率 - 属于过度杠杆。这是不可持续的，价格下跌时会加大多头连环清算的风险。'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ar','السوق مثقل جدًا بالمراكز الشرائية (اللونغ). يدفع المتداولون أكثر من 0.05% كل 8 ساعات فقط للبقاء في مراكزهم الشرائية - وهذا يعني رافعة مالية مفرطة. هذا غير مستدام، مما يرفع خطر حدوث تصفية متسلسلة للمراكز الشرائية إذا انخفض السعر.'),
('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ru','Рынок сильно перегружен лонгами. Трейдеры платят 0.05%+ каждые 8 часов только за удержание лонга - это признак чрезмерного плеча. Это неустойчиво, что повышает риск каскадной ликвидации лонгов при падении цены.')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('FUNDING_SIG_LONGS_OVERCROWDED_DESC','en','The market is extremely long-heavy. Traders are paying 0.05%+ every 8h just to stay long - they are overleveraged. This is unsustainable, raising the risk of a long-liquidation cascade if price drops.'),
-- ('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ko','시장이 극도로 롱에 치우쳐 있습니다. 트레이더들은 롱 포지션을 유지하기 위해 8시간마다 0.05% 이상을 지불하고 있으며, 이는 과도한 레버리지 상태입니다. 이는 지속 불가능하며, 가격이 하락하면 롱 포지션의 연쇄 청산 위험이 커집니다.'),
-- ('FUNDING_SIG_LONGS_OVERCROWDED_DESC','zh','市场极度偏多。交易者为维持多头每8小时支付0.05%以上的费率 - 属于过度杠杆。这是不可持续的，价格下跌时会加大多头连环清算的风险。'),
-- ('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ar','السوق مثقل جدًا بالمراكز الشرائية (اللونغ). يدفع المتداولون أكثر من 0.05% كل 8 ساعات فقط للبقاء في مراكزهم الشرائية - وهذا يعني رافعة مالية مفرطة. هذا غير مستدام، مما يرفع خطر حدوث تصفية متسلسلة للمراكز الشرائية إذا انخفض السعر.'),
-- ('FUNDING_SIG_LONGS_OVERCROWDED_DESC','ru','Рынок сильно перегружен лонгами. Трейдеры платят 0.05%+ каждые 8 часов только за удержание лонга - это признак чрезмерного плеча. Это неустойчиво, что повышает риск каскадной ликвидации лонгов при падении цены.')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
