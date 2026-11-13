-- HOURS_WIN_*_DESC: the five /hours session descriptions, with the unmeasured claims removed.
--
-- ── NOT APPLIED. THIS IS PENDING WORK AND NEEDS THE OWNER'S YES ────────────────────────────────
--
-- **DO NOT READ THIS FILE AS A RECORD.** 20261105b and 20261101a in this directory are records of
-- rows already live; this one is the opposite and says so here because the two look identical at a
-- glance. Nothing below has been run against any project. 25 rows on prod (5 keys x 5 locales) are
-- a shared-database write, which is one of the three things that go to the owner directly.
-- A DEV BLOCK (25 more rows on lhq_dev_labels) was added after this was written, so qa and staging can show what production will show: see the end of the statements.
--
-- Flip this header to the "ALREADY APPLIED" wording the moment it is run, and say which projects.
--
-- ── WHY ────────────────────────────────────────────────────────────────────────────────────────
--
-- #1263 box 6. Every one of the five descriptions carried a prediction or an instruction with no
-- measurement behind it, on a page a paying trader reads before deciding when to trade:
--
--   MON_EVE  "Strong trend continuation or violent reversal setups."
--   GOD      "Retail asleep globally."  /  "Maximum priority."
--   LONDON   "Almost always a fake move first..."  /  "Never trade the first 15 minutes."
--   DEAD     "Do not trade."  /  "Highest probability of stopping out on noise."
--   PRIME    "Best daily window..."  /  "the single most consistent reversal sub-window"
--
-- The box named only MON_EVE. All five have the same defect; fixing one would leave four
-- predictions beside one careful sentence, which reads as an oversight rather than a standard.
--
-- PM/DevOps ruled the copy on 2026-11-08 under the owner's 2026-11-06 delegation. The directive
-- voice goes deliberately: "Do not trade" is the clearest sentence on the page and we cannot
-- support it with a measurement, and the data-integrity rule outranks punchiness.
--
-- TWO CLAIMS IN THE FIRST DRAFT WERE THEMSELVES UNMEASURED and PM caught them:
--   * "lowest volume of the week" (GOD) - not measured, so GOD now says "a low-volume weekend
--     window" instead.
--   * "spreads are tight" (DEAD) - BACKWARDS. Thin volume usually WIDENS spreads. That phrase was
--     inherited from the sentence being replaced and carried forward without being checked, which
--     is the same failure the box is about, committed while fixing it.
--
-- PRIME loses its one concrete claim (20:00-20:45 UTC). If that window is ever actually measured,
-- the right fix is to cite the measurement here, not to restore the superlative.
--
-- ── SAFE TO RE-RUN, AND SAFE AGAINST A ROW THAT MOVED ──────────────────────────────────────────
--
-- Every statement matches on the EXACT CURRENT VALUE as well as the key and locale, so a row that
-- someone has edited since 2026-11-08 is not matched and is left alone rather than silently
-- overwritten. `and value <> '<new>'` makes a second run a no-op.
--
-- Expect `UPDATE 1` on each of the 25 the first time. **A statement reporting `UPDATE 0` means
-- that row's current value is not what this file expects - stop and look, do not force it.**
--
-- The shipped defaults in lib/labelDefaults.en.json are updated in the same PR, so the repository
-- and production agree the moment this is applied. Until then they deliberately disagree: the rows
-- win, so production still serves the old copy and the defaults are the pending state.

-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
begin;

-- ── HOURS_WIN_MON_EVE_DESC ─────────────────────────────────────────────────────────────────────
update lhq_labels set value = 'Weekly liquidity build-up complete. US session active. The hour tells you the liquidity, not the direction.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'en'
   and value = 'Weekly liquidity build-up complete. US session active. Strong trend continuation or violent reversal setups.'
   and value <> 'Weekly liquidity build-up complete. US session active. The hour tells you the liquidity, not the direction.';

update lhq_labels set value = '주간 유동성 축적이 완료되었습니다. 미국 세션이 활성화됩니다. 이 시간대가 알려주는 것은 유동성이지 방향이 아닙니다.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'ko'
   and value = '주간 유동성 축적이 완료되었습니다. 미국 세션이 활성화됩니다. 강한 추세 지속 또는 급격한 반전 셋업이 나타납니다.';

update lhq_labels set value = '每周流动性积累完成。美国交易时段活跃。这个时段说明的是流动性，而不是方向。'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'zh'
   and value = '每周流动性积累完成。美国交易时段活跃。适合强势趋势延续或剧烈反转形态。';

update lhq_labels set value = 'Недельное накопление ликвидности завершено. Активна американская сессия. Этот час говорит о ликвидности, а не о направлении.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'ru'
   and value = 'Недельное накопление ликвидности завершено. Активна американская сессия. Сильное продолжение тренда или резкие развороты.';

update lhq_labels set value = 'اكتمل تراكم السيولة الأسبوعي. جلسة التداول الأمريكية نشطة. هذه الساعة تدل على السيولة، لا على الاتجاه.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'ar'
   and value = 'اكتمل تراكم السيولة الأسبوعي. جلسة التداول الأمريكية نشطة. إعدادات استمرار اتجاه قوي أو انعكاس حاد.';

-- ── HOURS_WIN_GOD_DESC ─────────────────────────────────────────────────────────────────────────
update lhq_labels set value = 'A low-volume weekend window. With less capital in the market, a move can be larger than the flow behind it.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'en'
   and value = 'Lowest volume of the week. Retail asleep globally. Minimum capital needed to move price. Maximum priority.';

update lhq_labels set value = '거래량이 적은 주말 시간대입니다. 시장에 들어와 있는 자본이 적어, 그 뒤의 실제 거래량보다 움직임이 더 커질 수 있습니다.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'ko'
   and value = '주간 최저 거래량 구간입니다. 전 세계 리테일 트레이더들이 잠든 시간입니다. 가격을 움직이는 데 필요한 자본이 최소입니다. 최우선 순위입니다.';

update lhq_labels set value = '成交量较低的周末时段。市场中的资金较少，价格的波动可能大于其背后的实际成交量。'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'zh'
   and value = '全周最低成交量时段。全球散户都在休息。推动价格所需资金最少。最高优先级。';

update lhq_labels set value = 'Выходное окно с низким объёмом. Капитала на рынке меньше, поэтому движение может оказаться больше стоящего за ним потока.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'ru'
   and value = 'Самый низкий объём за неделю. Розничные трейдеры по всему миру спят. Минимум капитала нужен, чтобы сдвинуть цену. Максимальный приоритет.';

update lhq_labels set value = 'نافذة عطلة نهاية الأسبوع بحجم تداول منخفض. مع قلة رأس المال في السوق، قد تكون الحركة أكبر من التدفق الذي يقف خلفها.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'ar'
   and value = 'أدنى حجم تداول في الأسبوع. المتداولون الأفراد نائمون عالميًا. أقل رأس مال مطلوب لتحريك السعر. أولوية قصوى.';

-- ── HOURS_WIN_LONDON_DESC ──────────────────────────────────────────────────────────────────────
update lhq_labels set value = 'European institutions enter and volume rises. This is a session open, so the first prints are the least settled of the hour.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'en'
   and value = 'European institutions enter. Volume spike. Almost always a fake move first to trap early entries, then real direction emerges. Never trade the first 15 minutes.';

update lhq_labels set value = '유럽 기관이 진입하면서 거래량이 증가합니다. 세션이 열리는 시점이므로, 처음 체결되는 가격들이 그 시간대에서 가장 불안정합니다.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'ko'
   and value = '유럽 기관이 진입하는 시간대로 거래량이 급증합니다. 초반 진입자를 유인하는 가짜 움직임이 먼저 나온 뒤 실제 방향이 드러나는 경우가 대부분이니, 처음 15분은 절대 매매하지 마세요.';

update lhq_labels set value = '欧洲机构入场，成交量上升。这是交易时段的开盘，因此最初的成交是该时段内最不稳定的。'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'zh'
   and value = '欧洲机构入场，成交量骤增。几乎总会先出现假动作诱多诱空，随后才走出真实方向。切勿在开盘前15分钟入场。';

update lhq_labels set value = 'Европейские институционалы выходят на рынок, объём растёт. Это открытие сессии, поэтому первые сделки наименее устоявшиеся за весь час.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'ru'
   and value = 'Европейские институционалы выходят на рынок. Резкий всплеск объёма. Почти всегда сначала идёт ложное движение, чтобы поймать ранние входы, а затем проявляется настоящее направление. Никогда не торгуйте первые 15 минут.';

update lhq_labels set value = 'دخول المؤسسات الأوروبية مع ارتفاع حجم التداول. هذه بداية الجلسة، لذا تكون الصفقات الأولى هي الأقل استقرارًا خلال الساعة.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'ar'
   and value = 'دخول المؤسسات الأوروبية مع ارتفاع مفاجئ في الحجم. غالبًا ما تظهر حركة خادعة أولًا لاصطياد الدخول المبكر، ثم يتضح الاتجاه الحقيقي. تجنب التداول في أول 15 دقيقة دائمًا.';

-- ── HOURS_WIN_DEAD_DESC ────────────────────────────────────────────────────────────────────────
update lhq_labels set value = 'US pre-market, Europe at lunch, Asia asleep. Volume is usually thin, so price can move on little flow.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'en'
   and value = 'Do not trade. US pre-market, Europe lunch, Asia sleeping. Fake moves, tight spreads, no follow-through. Highest probability of stopping out on noise.';

update lhq_labels set value = '미국 장 전, 유럽 점심시간, 아시아 수면 시간대입니다. 거래량이 대체로 얇아, 적은 거래만으로도 가격이 움직일 수 있습니다.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'ko'
   and value = '매매를 피하세요. 미국 장 전, 유럽 점심시간, 아시아 수면 시간대가 겹쳐 가짜 움직임과 좁은 스프레드만 나타나고 후속 움직임이 없습니다. 노이즈로 인한 손절 확률이 가장 높은 시간대입니다.';

update lhq_labels set value = '美盘盘前、欧洲午休、亚洲休眠。成交量通常较为稀薄，少量成交就可能推动价格。'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'zh'
   and value = '不建议交易。美盘盘前、欧洲午休、亚洲休眠，行情多为假突破，点差收窄且缺乏延续性，最容易被噪音扫损。';

update lhq_labels set value = 'Премаркет США, обед в Европе, Азия спит. Объём обычно низкий, поэтому цена может двигаться на небольшом потоке.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'ru'
   and value = 'Не торгуйте. Премаркет US, обеденный перерыв в Европе, Азия спит. Ложные движения, узкие спреды, отсутствие продолжения. Наибольшая вероятность выбивания по стопу на рыночном шуме.';

update lhq_labels set value = 'ما قبل افتتاح السوق الأمريكية، واستراحة الغداء في أوروبا، وسكون آسيا. حجم التداول ضعيف عادةً، لذا قد يتحرك السعر بتدفق قليل.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'ar'
   and value = 'لا تتداول في هذه الفترة. جلسة ما قبل السوق الأمريكية، واستراحة الغداء في أوروبا، وسكون آسيا. حركات خادعة وفروقات أسعار ضيقة بلا استمرارية، وأعلى احتمال للخروج بوقف خسارة بسبب الضوضاء.';

-- ── HOURS_WIN_PRIME_DESC ───────────────────────────────────────────────────────────────────────
update lhq_labels set value = 'US session hours, usually the most active part of the day.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'en'
   and value = 'US session hours. Volume picks up. Best daily window for clean setups. 20:00–20:45 UTC is the single most consistent reversal sub-window.';

update lhq_labels set value = '미국 세션 시간대로, 보통 하루 중 가장 활발한 구간입니다.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'ko'
   and value = '미국 세션 시간대입니다. 거래량이 증가합니다. 깔끔한 셋업을 위한 하루 중 최적의 시간대입니다. 20:00–20:45 UTC는 가장 일관된 반전 구간입니다.';

update lhq_labels set value = '美国交易时段，通常是一天中最活跃的时段。'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'zh'
   and value = '美国交易时段。成交量回升。是形成清晰形态的每日最佳窗口。20:00–20:45 UTC 是最稳定的反转子窗口。';

update lhq_labels set value = 'Часы американской сессии — обычно самая активная часть дня.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'ru'
   and value = 'Часы американской сессии. Объём растёт. Лучшее дневное окно для чётких сетапов. 20:00–20:45 UTC - самое стабильное окно разворота.';

update lhq_labels set value = 'ساعات جلسة التداول الأمريكية، وهي عادةً أكثر أوقات اليوم نشاطًا.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'ar'
   and value = 'ساعات جلسة التداول الأمريكية. يزداد حجم التداول. أفضل نافذة يومية للإعدادات الواضحة. الفترة 20:00–20:45 بتوقيت UTC هي أكثر نافذة انعكاس اتساقًا.';

commit;

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
-- ADDED so qa and staging show what production will show (QA could otherwise never see this copy). Apply ONE block per project: this one on dev, the block above on prod.
-- The same guarded UPDATEs against lhq_dev_labels. Checked read-only on 2026-11-13 before this block was written: all 25 dev rows held exactly the expected OLD text, so every guard
-- matches and all 25 rows change. Re-running is a no-op (a row is only updated while it still holds the old text).
begin;

update lhq_dev_labels set value = 'Weekly liquidity build-up complete. US session active. The hour tells you the liquidity, not the direction.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'en'
   and value = 'Weekly liquidity build-up complete. US session active. Strong trend continuation or violent reversal setups.'
   and value <> 'Weekly liquidity build-up complete. US session active. The hour tells you the liquidity, not the direction.';

update lhq_dev_labels set value = '주간 유동성 축적이 완료되었습니다. 미국 세션이 활성화됩니다. 이 시간대가 알려주는 것은 유동성이지 방향이 아닙니다.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'ko'
   and value = '주간 유동성 축적이 완료되었습니다. 미국 세션이 활성화됩니다. 강한 추세 지속 또는 급격한 반전 셋업이 나타납니다.';

update lhq_dev_labels set value = '每周流动性积累完成。美国交易时段活跃。这个时段说明的是流动性，而不是方向。'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'zh'
   and value = '每周流动性积累完成。美国交易时段活跃。适合强势趋势延续或剧烈反转形态。';

update lhq_dev_labels set value = 'Недельное накопление ликвидности завершено. Активна американская сессия. Этот час говорит о ликвидности, а не о направлении.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'ru'
   and value = 'Недельное накопление ликвидности завершено. Активна американская сессия. Сильное продолжение тренда или резкие развороты.';

update lhq_dev_labels set value = 'اكتمل تراكم السيولة الأسبوعي. جلسة التداول الأمريكية نشطة. هذه الساعة تدل على السيولة، لا على الاتجاه.'
 where key = 'HOURS_WIN_MON_EVE_DESC' and locale = 'ar'
   and value = 'اكتمل تراكم السيولة الأسبوعي. جلسة التداول الأمريكية نشطة. إعدادات استمرار اتجاه قوي أو انعكاس حاد.';

update lhq_dev_labels set value = 'A low-volume weekend window. With less capital in the market, a move can be larger than the flow behind it.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'en'
   and value = 'Lowest volume of the week. Retail asleep globally. Minimum capital needed to move price. Maximum priority.';

update lhq_dev_labels set value = '거래량이 적은 주말 시간대입니다. 시장에 들어와 있는 자본이 적어, 그 뒤의 실제 거래량보다 움직임이 더 커질 수 있습니다.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'ko'
   and value = '주간 최저 거래량 구간입니다. 전 세계 리테일 트레이더들이 잠든 시간입니다. 가격을 움직이는 데 필요한 자본이 최소입니다. 최우선 순위입니다.';

update lhq_dev_labels set value = '成交量较低的周末时段。市场中的资金较少，价格的波动可能大于其背后的实际成交量。'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'zh'
   and value = '全周最低成交量时段。全球散户都在休息。推动价格所需资金最少。最高优先级。';

update lhq_dev_labels set value = 'Выходное окно с низким объёмом. Капитала на рынке меньше, поэтому движение может оказаться больше стоящего за ним потока.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'ru'
   and value = 'Самый низкий объём за неделю. Розничные трейдеры по всему миру спят. Минимум капитала нужен, чтобы сдвинуть цену. Максимальный приоритет.';

update lhq_dev_labels set value = 'نافذة عطلة نهاية الأسبوع بحجم تداول منخفض. مع قلة رأس المال في السوق، قد تكون الحركة أكبر من التدفق الذي يقف خلفها.'
 where key = 'HOURS_WIN_GOD_DESC' and locale = 'ar'
   and value = 'أدنى حجم تداول في الأسبوع. المتداولون الأفراد نائمون عالميًا. أقل رأس مال مطلوب لتحريك السعر. أولوية قصوى.';

update lhq_dev_labels set value = 'European institutions enter and volume rises. This is a session open, so the first prints are the least settled of the hour.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'en'
   and value = 'European institutions enter. Volume spike. Almost always a fake move first to trap early entries, then real direction emerges. Never trade the first 15 minutes.';

update lhq_dev_labels set value = '유럽 기관이 진입하면서 거래량이 증가합니다. 세션이 열리는 시점이므로, 처음 체결되는 가격들이 그 시간대에서 가장 불안정합니다.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'ko'
   and value = '유럽 기관이 진입하는 시간대로 거래량이 급증합니다. 초반 진입자를 유인하는 가짜 움직임이 먼저 나온 뒤 실제 방향이 드러나는 경우가 대부분이니, 처음 15분은 절대 매매하지 마세요.';

update lhq_dev_labels set value = '欧洲机构入场，成交量上升。这是交易时段的开盘，因此最初的成交是该时段内最不稳定的。'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'zh'
   and value = '欧洲机构入场，成交量骤增。几乎总会先出现假动作诱多诱空，随后才走出真实方向。切勿在开盘前15分钟入场。';

update lhq_dev_labels set value = 'Европейские институционалы выходят на рынок, объём растёт. Это открытие сессии, поэтому первые сделки наименее устоявшиеся за весь час.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'ru'
   and value = 'Европейские институционалы выходят на рынок. Резкий всплеск объёма. Почти всегда сначала идёт ложное движение, чтобы поймать ранние входы, а затем проявляется настоящее направление. Никогда не торгуйте первые 15 минут.';

update lhq_dev_labels set value = 'دخول المؤسسات الأوروبية مع ارتفاع حجم التداول. هذه بداية الجلسة، لذا تكون الصفقات الأولى هي الأقل استقرارًا خلال الساعة.'
 where key = 'HOURS_WIN_LONDON_DESC' and locale = 'ar'
   and value = 'دخول المؤسسات الأوروبية مع ارتفاع مفاجئ في الحجم. غالبًا ما تظهر حركة خادعة أولًا لاصطياد الدخول المبكر، ثم يتضح الاتجاه الحقيقي. تجنب التداول في أول 15 دقيقة دائمًا.';

update lhq_dev_labels set value = 'US pre-market, Europe at lunch, Asia asleep. Volume is usually thin, so price can move on little flow.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'en'
   and value = 'Do not trade. US pre-market, Europe lunch, Asia sleeping. Fake moves, tight spreads, no follow-through. Highest probability of stopping out on noise.';

update lhq_dev_labels set value = '미국 장 전, 유럽 점심시간, 아시아 수면 시간대입니다. 거래량이 대체로 얇아, 적은 거래만으로도 가격이 움직일 수 있습니다.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'ko'
   and value = '매매를 피하세요. 미국 장 전, 유럽 점심시간, 아시아 수면 시간대가 겹쳐 가짜 움직임과 좁은 스프레드만 나타나고 후속 움직임이 없습니다. 노이즈로 인한 손절 확률이 가장 높은 시간대입니다.';

update lhq_dev_labels set value = '美盘盘前、欧洲午休、亚洲休眠。成交量通常较为稀薄，少量成交就可能推动价格。'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'zh'
   and value = '不建议交易。美盘盘前、欧洲午休、亚洲休眠，行情多为假突破，点差收窄且缺乏延续性，最容易被噪音扫损。';

update lhq_dev_labels set value = 'Премаркет США, обед в Европе, Азия спит. Объём обычно низкий, поэтому цена может двигаться на небольшом потоке.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'ru'
   and value = 'Не торгуйте. Премаркет US, обеденный перерыв в Европе, Азия спит. Ложные движения, узкие спреды, отсутствие продолжения. Наибольшая вероятность выбивания по стопу на рыночном шуме.';

update lhq_dev_labels set value = 'ما قبل افتتاح السوق الأمريكية، واستراحة الغداء في أوروبا، وسكون آسيا. حجم التداول ضعيف عادةً، لذا قد يتحرك السعر بتدفق قليل.'
 where key = 'HOURS_WIN_DEAD_DESC' and locale = 'ar'
   and value = 'لا تتداول في هذه الفترة. جلسة ما قبل السوق الأمريكية، واستراحة الغداء في أوروبا، وسكون آسيا. حركات خادعة وفروقات أسعار ضيقة بلا استمرارية، وأعلى احتمال للخروج بوقف خسارة بسبب الضوضاء.';

update lhq_dev_labels set value = 'US session hours, usually the most active part of the day.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'en'
   and value = 'US session hours. Volume picks up. Best daily window for clean setups. 20:00–20:45 UTC is the single most consistent reversal sub-window.';

update lhq_dev_labels set value = '미국 세션 시간대로, 보통 하루 중 가장 활발한 구간입니다.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'ko'
   and value = '미국 세션 시간대입니다. 거래량이 증가합니다. 깔끔한 셋업을 위한 하루 중 최적의 시간대입니다. 20:00–20:45 UTC는 가장 일관된 반전 구간입니다.';

update lhq_dev_labels set value = '美国交易时段，通常是一天中最活跃的时段。'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'zh'
   and value = '美国交易时段。成交量回升。是形成清晰形态的每日最佳窗口。20:00–20:45 UTC 是最稳定的反转子窗口。';

update lhq_dev_labels set value = 'Часы американской сессии — обычно самая активная часть дня.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'ru'
   and value = 'Часы американской сессии. Объём растёт. Лучшее дневное окно для чётких сетапов. 20:00–20:45 UTC - самое стабильное окно разворота.';

update lhq_dev_labels set value = 'ساعات جلسة التداول الأمريكية، وهي عادةً أكثر أوقات اليوم نشاطًا.'
 where key = 'HOURS_WIN_PRIME_DESC' and locale = 'ar'
   and value = 'ساعات جلسة التداول الأمريكية. يزداد حجم التداول. أفضل نافذة يومية للإعدادات الواضحة. الفترة 20:00–20:45 بتوقيت UTC هي أكثر نافذة انعكاس اتساقًا.';

commit;

-- Verify after applying - every row should show the new text and none of the old phrases:
--
--   select key, locale, value from lhq_labels where key like 'HOURS_WIN_%_DESC' order by key, locale;
--
--   select count(*) as must_be_zero from lhq_labels
--    where key like 'HOURS_WIN_%_DESC'
--      and (value ilike '%Do not trade%' or value ilike '%Maximum priority%'
--           or value ilike '%Never trade%' or value ilike '%most consistent%');
