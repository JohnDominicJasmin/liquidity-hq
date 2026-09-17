-- Antislop audit 001, batch 2, PR B (landing and product claims) - #1309
-- items 31, 32, 33, 35. DRAFT - the owner approves the exact wording
-- before this PR merges; this migration exists so the wording is ready
-- to apply the moment it is, not because it is final.
--
-- Filename deliberately avoids "batch2" and "audit001...wording" as one
-- unit - PR A's __tests__/wordingBatch2Corrections.test.mts matches
-- migration filenames on exactly those patterns, scoped to PR A's own
-- 42-key AUDIT_KEYS list (items 36-44/54/57). This file's keys (item 35)
-- are unrelated, and PR B's branch predates PR A's fixes to those 42
-- keys - matching that regex here would fail PR A's test for reasons
-- entirely outside this PR's scope.
--
-- This file covers ONLY the lhq_labels rows for item 35 (the About page
-- rewrite). Items 31/32/33 are the landing page's own separate, code-only
-- i18n system (lib/i18n/dictionaries.ts) and components/LandingTerminal.tsx
-- - not lhq_labels rows, fixed directly in those files instead. Item 34
-- (Priority Support / missing support email) stays held - nothing to
-- write until the owner supplies a real address.
--
-- en rows are the source of truth and match lib/labelDefaults.en.json
-- exactly. ar/ko/ru/zh rows are MACHINE-TRANSLATED (not reviewed by a
-- native speaker), same standard as this batch's PR A migration and the
-- 2026-07/08 translation waves - translated now so the migration is
-- ready to apply as soon as the owner signs off the wording, not because
-- the wording itself is final.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx). The dev section is
-- commented out per 20260912b's convention - apply separately, and this
-- is a shared-database write that needs the owner's go at release time.

insert into lhq_labels (key, locale, value) values

('ABOUT_PAGE_SUBTITLE','en','Liquidity Hunter HQ - crypto trading intelligence'),
('ABOUT_PAGE_SUBTITLE','ko','Liquidity Hunter HQ - 암호화폐 트레이딩 인텔리전스'),
('ABOUT_PAGE_SUBTITLE','zh','Liquidity Hunter HQ - 加密货币交易情报'),
('ABOUT_PAGE_SUBTITLE','ar','Liquidity Hunter HQ - معلومات تداول العملات المشفرة'),
('ABOUT_PAGE_SUBTITLE','ru','Liquidity Hunter HQ - криптотрейдинговая аналитика'),

('ABOUT_WHAT_THIS_IS_BODY','en','A crypto trading dashboard built around liquidity: where stops cluster, where funding gets crowded, and where price is likely to get pulled. It brings the liquidation map, a squeeze scanner, AI analysis, alerts, and a journal into one place so you can read the market faster - the decisions are still yours.'),
('ABOUT_WHAT_THIS_IS_BODY','ko','유동성을 중심으로 만들어진 암호화폐 트레이딩 대시보드입니다: 손절이 몰리는 곳, 펀딩비가 과밀해지는 곳, 가격이 끌려갈 가능성이 높은 곳을 보여줍니다. 청산 맵, 스퀴즈 스캐너, AI 분석, 알림, 매매일지를 한곳에 모아 시장을 더 빠르게 읽을 수 있게 해줍니다 - 결정은 여전히 당신의 몫입니다.'),
('ABOUT_WHAT_THIS_IS_BODY','zh','一个围绕流动性打造的加密货币交易仪表盘：止损聚集的位置、资金费率过度拥挤的位置，以及价格最可能被牵引的位置。它将清算地图、挤压扫描器、AI分析、提醒和交易日志整合到一处，帮助您更快地读懂市场 - 决定权仍在您手中。'),
('ABOUT_WHAT_THIS_IS_BODY','ar','لوحة تحكم لتداول العملات المشفرة مبنية حول السيولة: أين تتجمع أوامر وقف الخسارة، وأين يزدحم التمويل، وأين يُرجَّح أن يُسحب السعر. تجمع بين خريطة التصفية، وماسح الضغط (سكويز)، وتحليل الذكاء الاصطناعي، والتنبيهات، وسجل التداول في مكان واحد لمساعدتك على قراءة السوق بشكل أسرع - القرارات تبقى لك.'),
('ABOUT_WHAT_THIS_IS_BODY','ru','Дашборд для криптотрейдинга, построенный вокруг ликвидности: где скапливаются стопы, где перегружен фандинг и куда вероятнее всего потянет цену. Здесь собраны карта ликвидаций, сканер сквизов, AI-анализ, уведомления и журнал - чтобы вы быстрее читали рынок. Решения всё равно принимаете вы.'),

('ABOUT_DATA_SOURCE_PRICES_VALUE','en','Binance WebSocket + REST - 50 markets (majors, alts, memes, gold, S&P 500)'),
('ABOUT_DATA_SOURCE_PRICES_VALUE','ko','바이낸스 WebSocket + REST - 50개 시장 (메이저, 알트, 밈코인, 금, S&P 500)'),
('ABOUT_DATA_SOURCE_PRICES_VALUE','zh','币安 WebSocket + REST - 50个市场（主流币、山寨币、meme币、黄金、标普500）'),
('ABOUT_DATA_SOURCE_PRICES_VALUE','ar','Binance WebSocket + REST - 50 سوقًا (العملات الرئيسية، البدائل، عملات الميم، الذهب، S&P 500)'),
('ABOUT_DATA_SOURCE_PRICES_VALUE','ru','Binance WebSocket + REST - 50 рынков (основные монеты, альты, мемкоины, золото, S&P 500)'),

('ABOUT_STEP1_BOLD','en','Check the Squeeze Scanner'),
('ABOUT_STEP1_BOLD','ko','스퀴즈 스캐너 확인하기'),
('ABOUT_STEP1_BOLD','zh','查看挤压扫描器'),
('ABOUT_STEP1_BOLD','ar','تحقق من ماسح الإعدادات (سكويز)'),
('ABOUT_STEP1_BOLD','ru','Проверьте сканер сквизов'),

('ABOUT_STEP1_TEXT','en','screens all 50 markets for crowded positioning. A score of 70+ flags a potential squeeze setup.'),
('ABOUT_STEP1_TEXT','ko','50개 시장 전체에서 과밀 포지셔닝을 스캔합니다. 점수가 70 이상이면 잠재적 스퀴즈 셋업으로 표시됩니다.'),
('ABOUT_STEP1_TEXT','zh','扫描全部50个市场的过度拥挤仓位。评分达到70以上即标记为潜在挤压形态。'),
('ABOUT_STEP1_TEXT','ar','يفحص جميع الأسواق الـ50 بحثًا عن ازدحام في المراكز. الدرجة 70+ تشير إلى إعداد ضغط محتمل.'),
('ABOUT_STEP1_TEXT','ru','Сканирует все 50 рынков на перегруженное позиционирование. Показатель 70+ отмечает потенциальный сетап сквиза.'),

('ABOUT_STEP2_BOLD','en','Open the Liquidation Map'),
('ABOUT_STEP2_BOLD','ko','청산 맵 열기'),
('ABOUT_STEP2_BOLD','zh','打开清算地图'),
('ABOUT_STEP2_BOLD','ar','افتح خريطة التصفية'),
('ABOUT_STEP2_BOLD','ru','Откройте карту ликвидаций'),

('ABOUT_STEP2_TEXT','en','estimated liquidation zones - the nearest dense cluster is often where price gets drawn to.'),
('ABOUT_STEP2_TEXT','ko','추정 청산 구역 - 가장 밀집된 구간이 가격이 끌려가는 지점이 되는 경우가 많습니다.'),
('ABOUT_STEP2_TEXT','zh','估算的清算区域 - 最密集的集群往往是价格被牵引的地方。'),
('ABOUT_STEP2_TEXT','ar','مناطق تصفية تقديرية - أكثر التجمعات كثافة غالبًا ما تكون حيث يُسحب السعر.'),
('ABOUT_STEP2_TEXT','ru','Расчётные зоны ликвидаций - самый плотный кластер часто становится точкой притяжения цены.'),

('ABOUT_STEP3_BOLD','en','Check Best Hours'),
('ABOUT_STEP3_BOLD','ko','베스트 아워 확인하기'),
('ABOUT_STEP3_BOLD','zh','查看最佳时段'),
('ABOUT_STEP3_BOLD','ar','تحقق من أفضل الساعات'),
('ABOUT_STEP3_BOLD','ru','Проверьте лучшие часы'),

('ABOUT_STEP3_TEXT','en','see which hours have historically had the thinnest volume and the most room for a move.'),
('ABOUT_STEP3_TEXT','ko','과거에 거래량이 가장 적고 움직일 여지가 가장 컸던 시간대를 확인합니다.'),
('ABOUT_STEP3_TEXT','zh','查看历史上成交量最稀薄、最有波动空间的时段。'),
('ABOUT_STEP3_TEXT','ar','شاهد الساعات التي كانت تاريخيًا الأقل حجم تداول والأكثر احتمالًا لحركة كبيرة.'),
('ABOUT_STEP3_TEXT','ru','Смотрите, в какие часы исторически был самый низкий объём и больше всего простора для движения.'),

('ABOUT_STEP4_BOLD','en','Run AI Arena'),
('ABOUT_STEP4_BOLD','ko','AI 아레나 실행'),
('ABOUT_STEP4_BOLD','zh','运行AI Arena'),
('ABOUT_STEP4_BOLD','ar','شغّل AI Arena'),
('ABOUT_STEP4_BOLD','ru','Запустите AI Arena'),

('ABOUT_STEP4_TEXT','en','get Grok''s read across dozens of live signals for a direct trade bias.'),
('ABOUT_STEP4_TEXT','ko','수십 개의 실시간 신호에 대한 Grok의 분석을 받아 명확한 트레이드 방향을 얻습니다.'),
('ABOUT_STEP4_TEXT','zh','获取Grok对数十个实时信号的解读，得出明确的交易方向。'),
('ABOUT_STEP4_TEXT','ar','احصل على تحليل Grok عبر عشرات الإشارات المباشرة للحصول على اتجاه تداول مباشر.'),
('ABOUT_STEP4_TEXT','ru','Получите разбор от Grok по десяткам живых сигналов для чёткого торгового смещения.'),

('ABOUT_STEP5_BOLD','en','Size your position'),
('ABOUT_STEP5_BOLD','ko','포지션 크기 정하기'),
('ABOUT_STEP5_BOLD','zh','设定仓位大小'),
('ABOUT_STEP5_BOLD','ar','حدد حجم مركزك'),
('ABOUT_STEP5_BOLD','ru','Определите размер позиции'),

('ABOUT_STEP5_TEXT','en','use the Position Sizer and Risk/Reward calculators before entering, so risk is defined before the trade.'),
('ABOUT_STEP5_TEXT','ko','진입 전에 포지션 사이저와 리스크/리워드 계산기를 사용해 리스크를 미리 정의하세요.'),
('ABOUT_STEP5_TEXT','zh','在入场前使用仓位计算器和风险回报计算器，提前确定风险。'),
('ABOUT_STEP5_TEXT','ar','استخدم حاسبة حجم المركز وحاسبة المخاطر/العائد قبل الدخول، لتحديد المخاطر مسبقًا.'),
('ABOUT_STEP5_TEXT','ru','Перед входом используйте калькуляторы размера позиции и риска/прибыли, чтобы заранее определить риск.'),

('ABOUT_STEP6_BOLD','en','Log the trade.'),
('ABOUT_STEP6_BOLD','ko','매매일지 기록하기.'),
('ABOUT_STEP6_BOLD','zh','记录交易。'),
('ABOUT_STEP6_BOLD','ar','سجّل الصفقة.'),
('ABOUT_STEP6_BOLD','ru','Запишите сделку.'),

('ABOUT_STEP6_TEXT','en','use the Journal to record entry, exit, and reasoning, then check Signal Accuracy to see how past setups played out.'),
('ABOUT_STEP6_TEXT','ko','진입, 청산, 근거를 매매일지에 기록하고, 시그널 정확도에서 과거 셋업이 어떻게 진행됐는지 확인하세요.'),
('ABOUT_STEP6_TEXT','zh','使用交易日志记录入场、出场和理由，然后查看信号准确率，了解过往形态的表现。'),
('ABOUT_STEP6_TEXT','ar','استخدم السجل لتوثيق الدخول والخروج والسبب، ثم راجع دقة الإشارات لمعرفة كيف كانت أداء الإعدادات السابقة.'),
('ABOUT_STEP6_TEXT','ru','Используйте журнал, чтобы записать вход, выход и обоснование, затем проверьте точность сигналов, чтобы увидеть, как сработали прошлые сетапы.'),

('ABOUT_REMINDER_TITLE','en','Not financial advice'),
('ABOUT_REMINDER_TITLE','ko','투자 자문이 아닙니다'),
('ABOUT_REMINDER_TITLE','zh','非投资建议'),
('ABOUT_REMINDER_TITLE','ar','ليست نصيحة مالية'),
('ABOUT_REMINDER_TITLE','ru','Не является финансовым советом'),

('ABOUT_REMINDER_BODY','en','No warranties. All decisions are yours. The market does not care about your analysis.'),
('ABOUT_REMINDER_BODY','ko','어떠한 보증도 하지 않습니다. 모든 결정은 당신의 몫입니다. 시장은 당신의 분석에 관심이 없습니다.'),
('ABOUT_REMINDER_BODY','zh','不提供任何担保。所有决定均由您自行承担。市场不会关心您的分析。'),
('ABOUT_REMINDER_BODY','ar','لا توجد ضمانات. جميع القرارات هي قراراتك. السوق لا يهتم بتحليلك.'),
('ABOUT_REMINDER_BODY','ru','Никаких гарантий. Все решения принимаете вы. Рынку не важен ваш анализ.')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately (shared-database
-- write, owner-gated at release time, per 20260912b's convention).
