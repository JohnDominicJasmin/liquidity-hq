-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- The dashboard Market Read card title, scale and tooltip, and the dashboard page hint, say what the card measures (how many signals agree) instead of asking whether it is a good time to trade (PM visual sign-off, 2026-11-16, tracker 1263). English ships in lib/labelDefaults.en.json and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling. ar is not offered but a stored 'ar' preference still serves its rows, so ar is overwritten too. Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('STRAT_WATCHING','ko','주시 중'),
('STRAT_WATCHING','zh','关注中'),
('STRAT_WATCHING','ru','Следим'),
('STRAT_WATCHING','ar','قيد المراقبة'),
('MARKET_READ_EYEBROW_Q','ko',' · 몇 개의 신호가 일치할까'),
('MARKET_READ_EYEBROW_Q','zh',' · 多少信号一致'),
('MARKET_READ_EYEBROW_Q','ru',' · сколько сигналов совпадает'),
('MARKET_READ_EYEBROW_Q','ar',' · كم إشارة متفقة'),
('MARKET_READ_SCALE_GOOD','ko','≥ 70 대부분 일치'),
('MARKET_READ_SCALE_GOOD','zh','≥ 70 多数一致'),
('MARKET_READ_SCALE_GOOD','ru','≥ 70 большинство совпадает'),
('MARKET_READ_SCALE_GOOD','ar','≥ 70 معظمها متفق'),
('MARKET_READ_GOOD_TICK_TITLE','ko','대부분 일치 ≥ 70'),
('MARKET_READ_GOOD_TICK_TITLE','zh','多数信号一致 ≥ 70'),
('MARKET_READ_GOOD_TICK_TITLE','ru','Большинство сигналов совпадает ≥ 70'),
('MARKET_READ_GOOD_TICK_TITLE','ar','معظم الإشارات متفقة ≥ 70'),
('DASHBOARD_HINT_BODY','ko','한눈에 보는 시장 진단 - 전반적인 시장 상황과 살펴볼 만한 신호.'),
('DASHBOARD_HINT_BODY','zh','一目了然的市场解读 - 整体行情，以及值得一看的信号。'),
('DASHBOARD_HINT_BODY','ru','Картина рынка с первого взгляда - общие условия и сигналы, на которые стоит взглянуть.'),
('DASHBOARD_HINT_BODY','ar','قراءتك السريعة للسوق - الظروف العامة والإشارات التي تستحق النظر.'),
('MARKET_READ_TIP','ko','이 코인에 대해 지금 몇 개의 신호가 일치하는지 알기 쉽게 보여줍니다. 조언이 아닌 설명입니다. 세션 타이밍, 요일, 공포·탐욕 지수, 펀딩비, 주문벽 근접도, 6개 시그널 스마트머니 복합 지표를 종합해 0-100점으로 나타냅니다.'),
('MARKET_READ_TIP','zh','直观显示当前这枚币有多少信号一致。这是描述，不是建议。综合交易时段、星期几、恐慌与贪婪指数、资金费率、订单墙远近以及6项聪明钱信号，汇总成一个0到100的分数。'),
('MARKET_READ_TIP','ru','Простое описание того, сколько сигналов по этой монете сейчас совпадает. Это описание, а не совет. Учитывает время сессии, день недели, индекс страха и жадности, ставку финансирования, близость крупных заявок и составной показатель «умных денег» из 6 сигналов, сводя всё в оценку от 0 до 100.'),
('MARKET_READ_TIP','ar','قراءة واضحة لعدد الإشارات المتفقة لهذه العملة الآن. وصف وليس نصيحة. تجمع توقيت الجلسة ويوم الأسبوع ومؤشر الخوف والطمع ومعدل التمويل والقرب من جدران الأوامر ومؤشرًا مركبًا من 6 إشارات للأموال الذكية في درجة واحدة من 0 إلى 100.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('STRAT_WATCHING','ko','주시 중'),
('STRAT_WATCHING','zh','关注中'),
('STRAT_WATCHING','ru','Следим'),
('STRAT_WATCHING','ar','قيد المراقبة'),
('MARKET_READ_EYEBROW_Q','ko',' · 몇 개의 신호가 일치할까'),
('MARKET_READ_EYEBROW_Q','zh',' · 多少信号一致'),
('MARKET_READ_EYEBROW_Q','ru',' · сколько сигналов совпадает'),
('MARKET_READ_EYEBROW_Q','ar',' · كم إشارة متفقة'),
('MARKET_READ_SCALE_GOOD','ko','≥ 70 대부분 일치'),
('MARKET_READ_SCALE_GOOD','zh','≥ 70 多数一致'),
('MARKET_READ_SCALE_GOOD','ru','≥ 70 большинство совпадает'),
('MARKET_READ_SCALE_GOOD','ar','≥ 70 معظمها متفق'),
('MARKET_READ_GOOD_TICK_TITLE','ko','대부분 일치 ≥ 70'),
('MARKET_READ_GOOD_TICK_TITLE','zh','多数信号一致 ≥ 70'),
('MARKET_READ_GOOD_TICK_TITLE','ru','Большинство сигналов совпадает ≥ 70'),
('MARKET_READ_GOOD_TICK_TITLE','ar','معظم الإشارات متفقة ≥ 70'),
('DASHBOARD_HINT_BODY','ko','한눈에 보는 시장 진단 - 전반적인 시장 상황과 살펴볼 만한 신호.'),
('DASHBOARD_HINT_BODY','zh','一目了然的市场解读 - 整体行情，以及值得一看的信号。'),
('DASHBOARD_HINT_BODY','ru','Картина рынка с первого взгляда - общие условия и сигналы, на которые стоит взглянуть.'),
('DASHBOARD_HINT_BODY','ar','قراءتك السريعة للسوق - الظروف العامة والإشارات التي تستحق النظر.'),
('MARKET_READ_TIP','ko','이 코인에 대해 지금 몇 개의 신호가 일치하는지 알기 쉽게 보여줍니다. 조언이 아닌 설명입니다. 세션 타이밍, 요일, 공포·탐욕 지수, 펀딩비, 주문벽 근접도, 6개 시그널 스마트머니 복합 지표를 종합해 0-100점으로 나타냅니다.'),
('MARKET_READ_TIP','zh','直观显示当前这枚币有多少信号一致。这是描述，不是建议。综合交易时段、星期几、恐慌与贪婪指数、资金费率、订单墙远近以及6项聪明钱信号，汇总成一个0到100的分数。'),
('MARKET_READ_TIP','ru','Простое описание того, сколько сигналов по этой монете сейчас совпадает. Это описание, а не совет. Учитывает время сессии, день недели, индекс страха и жадности, ставку финансирования, близость крупных заявок и составной показатель «умных денег» из 6 сигналов, сводя всё в оценку от 0 до 100.'),
('MARKET_READ_TIP','ar','قراءة واضحة لعدد الإشارات المتفقة لهذه العملة الآن. وصف وليس نصيحة. تجمع توقيت الجلسة ويوم الأسبوع ومؤشر الخوف والطمع ومعدل التمويل والقرب من جدران الأوامر ومؤشرًا مركبًا من 6 إشارات للأموال الذكية في درجة واحدة من 0 إلى 100.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
