-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- The Scanner flags a squeeze from a score of 65 (components/SetupScanner.tsx); the copy said 70 (#1185).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ABOUT_STEP1_TEXT','ar','يفحص جميع الأسواق الـ50 بحثًا عن ازدحام في المراكز. الدرجة 65+ تشير إلى إعداد ضغط محتمل.'),
('ABOUT_STEP1_TEXT','en','screens all 50 markets for crowded positioning. A score of 65+ flags a potential squeeze setup.'),
('ABOUT_STEP1_TEXT','ko','50개 시장 전체에서 과밀 포지셔닝을 스캔합니다. 점수가 65 이상이면 잠재적 스퀴즈 셋업으로 표시됩니다.'),
('ABOUT_STEP1_TEXT','ru','Сканирует все 50 рынков на перегруженное позиционирование. Показатель 65+ отмечает потенциальный сетап сквиза.'),
('ABOUT_STEP1_TEXT','zh','扫描全部50个市场的过度拥挤仓位。评分达到65以上即标记为潜在挤压形态。'),
('HELP_Q_FIRST_LOOK_A','en','Start with the Setup Scanner, which screens all 50 markets for crowded positioning - a score of 65 or above flags a possible squeeze. Then open the Liquidation Map for the coin you are interested in, to see where the estimated liquidation zones sit and how dense each cluster is.'),
('HELP_Q_FIRST_LOOK_A','ko','전체 50개 시장에서 쏠린 포지션을 걸러내는 셋업 스캐너부터 시작하세요. 점수 65 이상이면 스퀴즈 가능성이 있다는 표시입니다. 그다음 관심 있는 코인의 청산 맵을 열어 추정 청산 구간이 어디에 있고 각 군집이 얼마나 촘촘한지 확인하세요.'),
('HELP_Q_FIRST_LOOK_A','ru','Начните со сканера сетапов: он просматривает все 50 рынков на перекос позиций, оценка от 65 указывает на возможный сквиз. Затем откройте карту ликвидаций нужной монеты, чтобы увидеть, где расположены расчётные зоны ликвидаций и насколько плотен каждый кластер.'),
('HELP_Q_FIRST_LOOK_A','zh','先从“设置扫描器”开始，它会筛查全部 50 个市场中持仓拥挤的情况，评分 65 及以上表示可能出现挤压。然后打开您感兴趣币种的爆仓图，查看预估爆仓区间的位置以及每个集群的密集程度。'),
('SEO_SCANNER_A1','en','The score runs from 0 to 100 and grows as positioning on one side gets more crowded. A score of 65 or higher marks a coin where a squeeze is possible. It describes positioning, not a forecast.'),
('SEO_SCANNER_A1','ko','점수는 0부터 100까지이며, 한쪽 포지션이 더 쏠릴수록 커집니다. 점수가 65 이상이면 스퀴즈가 일어날 수 있는 코인이라는 표시입니다. 이는 포지션 상태를 설명할 뿐 예측이 아닙니다.'),
('SEO_SCANNER_A1','ru','Оценка идёт от 0 до 100 и растёт по мере того, как позиционирование на одной стороне становится более перекошенным. Оценка от 65 означает, что по монете возможен сквиз. Она описывает позиционирование, а не прогноз.'),
('SEO_SCANNER_A1','zh','分数范围是 0 到 100，某一方的仓位越拥挤，分数越高。分数达到 65 或以上，表示该币种可能出现挤压。它描述的是仓位状态，而不是预测。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ABOUT_STEP1_TEXT','ar','يفحص جميع الأسواق الـ50 بحثًا عن ازدحام في المراكز. الدرجة 65+ تشير إلى إعداد ضغط محتمل.'),
('ABOUT_STEP1_TEXT','en','screens all 50 markets for crowded positioning. A score of 65+ flags a potential squeeze setup.'),
('ABOUT_STEP1_TEXT','ko','50개 시장 전체에서 과밀 포지셔닝을 스캔합니다. 점수가 65 이상이면 잠재적 스퀴즈 셋업으로 표시됩니다.'),
('ABOUT_STEP1_TEXT','ru','Сканирует все 50 рынков на перегруженное позиционирование. Показатель 65+ отмечает потенциальный сетап сквиза.'),
('ABOUT_STEP1_TEXT','zh','扫描全部50个市场的过度拥挤仓位。评分达到65以上即标记为潜在挤压形态。'),
('HELP_Q_FIRST_LOOK_A','en','Start with the Setup Scanner, which screens all 50 markets for crowded positioning - a score of 65 or above flags a possible squeeze. Then open the Liquidation Map for the coin you are interested in, to see where the estimated liquidation zones sit and how dense each cluster is.'),
('HELP_Q_FIRST_LOOK_A','ko','전체 50개 시장에서 쏠린 포지션을 걸러내는 셋업 스캐너부터 시작하세요. 점수 65 이상이면 스퀴즈 가능성이 있다는 표시입니다. 그다음 관심 있는 코인의 청산 맵을 열어 추정 청산 구간이 어디에 있고 각 군집이 얼마나 촘촘한지 확인하세요.'),
('HELP_Q_FIRST_LOOK_A','ru','Начните со сканера сетапов: он просматривает все 50 рынков на перекос позиций, оценка от 65 указывает на возможный сквиз. Затем откройте карту ликвидаций нужной монеты, чтобы увидеть, где расположены расчётные зоны ликвидаций и насколько плотен каждый кластер.'),
('HELP_Q_FIRST_LOOK_A','zh','先从“设置扫描器”开始，它会筛查全部 50 个市场中持仓拥挤的情况，评分 65 及以上表示可能出现挤压。然后打开您感兴趣币种的爆仓图，查看预估爆仓区间的位置以及每个集群的密集程度。'),
('SEO_SCANNER_A1','en','The score runs from 0 to 100 and grows as positioning on one side gets more crowded. A score of 65 or higher marks a coin where a squeeze is possible. It describes positioning, not a forecast.'),
('SEO_SCANNER_A1','ko','점수는 0부터 100까지이며, 한쪽 포지션이 더 쏠릴수록 커집니다. 점수가 65 이상이면 스퀴즈가 일어날 수 있는 코인이라는 표시입니다. 이는 포지션 상태를 설명할 뿐 예측이 아닙니다.'),
('SEO_SCANNER_A1','ru','Оценка идёт от 0 до 100 и растёт по мере того, как позиционирование на одной стороне становится более перекошенным. Оценка от 65 означает, что по монете возможен сквиз. Она описывает позиционирование, а не прогноз.'),
('SEO_SCANNER_A1','zh','分数范围是 0 到 100，某一方的仓位越拥挤，分数越高。分数达到 65 或以上，表示该币种可能出现挤压。它描述的是仓位状态，而不是预测。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
