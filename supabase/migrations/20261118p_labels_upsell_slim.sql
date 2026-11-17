-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Upsell overload (owner 2026-11-17): the slim locked row and the one-line EMA lock. New keys; en equals the shipped default. ko/zh/ru/ar AI-drafted, not native-reviewed (owner 2026-11-13).
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('UPGRADE_GATE_WITH_PRO','en','With Pro:'),
('UPGRADE_GATE_WITH_PRO','ko','Pro로 이용 가능:'),
('UPGRADE_GATE_WITH_PRO','zh','升级 Pro 可用:'),
('UPGRADE_GATE_WITH_PRO','ru','С Pro:'),
('UPGRADE_GATE_WITH_PRO','ar','مع Pro:'),
('EMA_SIGNAL_LOCKED_LINE','en','EMA signals for {coin}'),
('EMA_SIGNAL_LOCKED_LINE','ko','{coin} EMA 신호'),
('EMA_SIGNAL_LOCKED_LINE','zh','{coin} 的 EMA 信号'),
('EMA_SIGNAL_LOCKED_LINE','ru','EMA-сигналы для {coin}'),
('EMA_SIGNAL_LOCKED_LINE','ar','إشارات EMA لـ {coin}'),
('UPGRADE_GATE_BODY','en','Pro adds the faster timeframes, signals on every coin, the full signal set and the deeper AI tools. One subscription.'),
('UPGRADE_GATE_BODY','ko','Pro는 더 빠른 타임프레임, 모든 코인의 신호, 전체 신호 세트, 더 깊은 AI 도구를 추가합니다. 구독 하나로 이용합니다.'),
('UPGRADE_GATE_BODY','zh','Pro 增加更快的时间周期、所有币种的信号、完整的信号集以及更深入的 AI 工具。一个订阅即可。'),
('UPGRADE_GATE_BODY','ru','Pro добавляет более быстрые таймфреймы, сигналы по каждой монете, полный набор сигналов и более глубокие ИИ-инструменты. Одна подписка.'),
('UPGRADE_GATE_BODY','ar','يضيف Pro الأطر الزمنية الأسرع وإشارات لكل عملة ومجموعة الإشارات الكاملة وأدوات الذكاء الاصطناعي الأعمق. اشتراك واحد.'),
('UPGRADE_GATE_BULLET_5','en','EMA signals, S/R and liquidation-cluster layers on every coin, and several indicators at once'),
('UPGRADE_GATE_BULLET_5','ko','모든 코인의 EMA 신호, S/R 및 청산 클러스터 레이어, 여러 지표 동시 사용'),
('UPGRADE_GATE_BULLET_5','zh','所有币种的 EMA 信号、支撑阻力与清算集群图层，以及同时使用多个指标'),
('UPGRADE_GATE_BULLET_5','ru','EMA-сигналы, слои S/R и кластеров ликвидаций по каждой монете и несколько индикаторов одновременно'),
('UPGRADE_GATE_BULLET_5','ar','إشارات EMA وطبقات الدعم/المقاومة وتجمعات التصفية لكل عملة، وعدة مؤشرات في وقت واحد'),
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('UPGRADE_GATE_WITH_PRO','en','With Pro:'),
('UPGRADE_GATE_WITH_PRO','ko','Pro로 이용 가능:'),
('UPGRADE_GATE_WITH_PRO','zh','升级 Pro 可用:'),
('UPGRADE_GATE_WITH_PRO','ru','С Pro:'),
('UPGRADE_GATE_WITH_PRO','ar','مع Pro:'),
('EMA_SIGNAL_LOCKED_LINE','en','EMA signals for {coin}'),
('EMA_SIGNAL_LOCKED_LINE','ko','{coin} EMA 신호'),
('EMA_SIGNAL_LOCKED_LINE','zh','{coin} 的 EMA 信号'),
('EMA_SIGNAL_LOCKED_LINE','ru','EMA-сигналы для {coin}'),
('EMA_SIGNAL_LOCKED_LINE','ar','إشارات EMA لـ {coin}'),
('UPGRADE_GATE_BODY','en','Pro adds the faster timeframes, signals on every coin, the full signal set and the deeper AI tools. One subscription.'),
('UPGRADE_GATE_BODY','ko','Pro는 더 빠른 타임프레임, 모든 코인의 신호, 전체 신호 세트, 더 깊은 AI 도구를 추가합니다. 구독 하나로 이용합니다.'),
('UPGRADE_GATE_BODY','zh','Pro 增加更快的时间周期、所有币种的信号、完整的信号集以及更深入的 AI 工具。一个订阅即可。'),
('UPGRADE_GATE_BODY','ru','Pro добавляет более быстрые таймфреймы, сигналы по каждой монете, полный набор сигналов и более глубокие ИИ-инструменты. Одна подписка.'),
('UPGRADE_GATE_BODY','ar','يضيف Pro الأطر الزمنية الأسرع وإشارات لكل عملة ومجموعة الإشارات الكاملة وأدوات الذكاء الاصطناعي الأعمق. اشتراك واحد.'),
('UPGRADE_GATE_BULLET_5','en','EMA signals, S/R and liquidation-cluster layers on every coin, and several indicators at once'),
('UPGRADE_GATE_BULLET_5','ko','모든 코인의 EMA 신호, S/R 및 청산 클러스터 레이어, 여러 지표 동시 사용'),
('UPGRADE_GATE_BULLET_5','zh','所有币种的 EMA 信号、支撑阻力与清算集群图层，以及同时使用多个指标'),
('UPGRADE_GATE_BULLET_5','ru','EMA-сигналы, слои S/R и кластеров ликвидаций по каждой монете и несколько индикаторов одновременно'),
('UPGRADE_GATE_BULLET_5','ar','إشارات EMA وطبقات الدعم/المقاومة وتجمعات التصفية لكل عملة، وعدة مؤشرات في وقت واحد'),
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
