-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- HELP_Q_TRIAL_A promised the trial "the larger AI allowance". It is not larger: lib/limits.ts gives Trial the same Quick / Deep / chat / search / briefing limits as Free; only the one-shot tool pool (8 a day) differs. The answer now says
-- exactly that (PM, 2026-11-16). The en row is REQUIRED: a stored en row overrides the shipped default, so any row stored for this key would keep the old claim (none was found in the migrations folder, but the live table may hold one).
-- ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('HELP_Q_TRIAL_A','en','Full Pro access, with no card required: the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, unlimited price alerts, and the one-shot AI tools. Quick and Deep reads, chat and briefings have the same daily limits as the Free plan. When the 14 days end your account moves to the Free plan unless you upgrade.'),
('HELP_Q_TRIAL_A','ko','카드 없이 전체 Pro 기능을 이용할 수 있습니다: 더 빠른 타임프레임, 컨플루언스 점수, 온체인 및 거시 데이터, 텔레그램 알림, 무제한 가격 알림, 일회성 AI 도구. 빠른 분석, 심층 분석, 채팅, 브리핑의 일일 한도는 무료 플랜과 같습니다. 14일이 끝나면 업그레이드하지 않는 한 계정은 무료 플랜으로 전환됩니다.'),
('HELP_Q_TRIAL_A','zh','无需绑定银行卡即可使用完整 Pro 功能:更快的时间周期、共振评分、链上与宏观数据、Telegram 提醒、不限数量的价格提醒,以及一次性 AI 工具。快速解读、深度解读、聊天和简报的每日额度与免费版相同。14 天结束后,除非升级,您的账户将转为免费版。'),
('HELP_Q_TRIAL_A','ru','Полный доступ Pro без привязки карты: быстрые таймфреймы, Confluence Score, ончейн- и макроданные, оповещения в Telegram, неограниченные ценовые оповещения и разовые ИИ-инструменты. Дневные лимиты быстрого и глубокого разбора, чата и сводок такие же, как на бесплатном тарифе. Через 14 дней аккаунт перейдёт на бесплатный тариф, если вы не оформите подписку.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('HELP_Q_TRIAL_A','en','Full Pro access, with no card required: the faster timeframes, the Confluence Score, on-chain and macro data, Telegram alerts, unlimited price alerts, and the one-shot AI tools. Quick and Deep reads, chat and briefings have the same daily limits as the Free plan. When the 14 days end your account moves to the Free plan unless you upgrade.'),
('HELP_Q_TRIAL_A','ko','카드 없이 전체 Pro 기능을 이용할 수 있습니다: 더 빠른 타임프레임, 컨플루언스 점수, 온체인 및 거시 데이터, 텔레그램 알림, 무제한 가격 알림, 일회성 AI 도구. 빠른 분석, 심층 분석, 채팅, 브리핑의 일일 한도는 무료 플랜과 같습니다. 14일이 끝나면 업그레이드하지 않는 한 계정은 무료 플랜으로 전환됩니다.'),
('HELP_Q_TRIAL_A','zh','无需绑定银行卡即可使用完整 Pro 功能:更快的时间周期、共振评分、链上与宏观数据、Telegram 提醒、不限数量的价格提醒,以及一次性 AI 工具。快速解读、深度解读、聊天和简报的每日额度与免费版相同。14 天结束后,除非升级,您的账户将转为免费版。'),
('HELP_Q_TRIAL_A','ru','Полный доступ Pro без привязки карты: быстрые таймфреймы, Confluence Score, ончейн- и макроданные, оповещения в Telegram, неограниченные ценовые оповещения и разовые ИИ-инструменты. Дневные лимиты быстрого и глубокого разбора, чата и сводок такие же, как на бесплатном тарифе. Через 14 дней аккаунт перейдёт на бесплатный тариф, если вы не оформите подписку.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
