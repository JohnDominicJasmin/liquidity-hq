-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- The funding + OI squeeze says WHY it is silent where funding cannot read as extreme (QA audit #1263, 2026-11-20: silent on every timeframe for SOL, XRP, SUI, BNB, MSTR, TSLA):
--   STRAT_SQUEEZE_WAIT_FUNDING_PINNED  funding equals the coin's own top readings (so "strictly beyond 95% of the last 90 days" can never hold)
--   STRAT_SQUEEZE_WAIT_FUNDING_STOCK   a tokenized stock whose funding is often zero
-- en equals lib/labelDefaults.en.json; ko/zh/ru/ar are AI-drafted and not native-reviewed. Upserts by (key, locale).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','en','Funding equals its usual top readings for this coin, so it cannot stand out.'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','ko','이 코인의 펀딩비가 평소 최고 수준과 같아 두드러지지 않습니다.'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','zh','该币种的资金费率等于其常见最高读数，因此无法显得突出。'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','ru','Ставка финансирования равна обычным максимумам этой монеты, поэтому не выделяется.'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','ar','معدل التمويل يساوي أعلى قراءاته المعتادة لهذه العملة، فلا يبرز.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','en','Funding on a tokenized stock is often zero, so it rarely stands out.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','ko','토큰화 주식의 펀딩비는 자주 0이라 두드러지는 경우가 드뭅니다.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','zh','代币化股票的资金费率常为零，因此很少显得突出。'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','ru','У токенизированной акции ставка финансирования часто равна нулю, поэтому редко выделяется.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','ar','معدل التمويل للسهم المرمَّز غالبًا صفر، لذا نادرًا ما يبرز.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','en','Funding equals its usual top readings for this coin, so it cannot stand out.'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','ko','이 코인의 펀딩비가 평소 최고 수준과 같아 두드러지지 않습니다.'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','zh','该币种的资金费率等于其常见最高读数，因此无法显得突出。'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','ru','Ставка финансирования равна обычным максимумам этой монеты, поэтому не выделяется.'),
('STRAT_SQUEEZE_WAIT_FUNDING_PINNED','ar','معدل التمويل يساوي أعلى قراءاته المعتادة لهذه العملة، فلا يبرز.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','en','Funding on a tokenized stock is often zero, so it rarely stands out.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','ko','토큰화 주식의 펀딩비는 자주 0이라 두드러지는 경우가 드뭅니다.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','zh','代币化股票的资金费率常为零，因此很少显得突出。'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','ru','У токенизированной акции ставка финансирования часто равна нулю, поэтому редко выделяется.'),
('STRAT_SQUEEZE_WAIT_FUNDING_STOCK','ar','معدل التمويل للسهم المرمَّز غالبًا صفر، لذا نادرًا ما يبرز.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
