-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Labels for the "nothing waits for ever" batch (#1651): ARENA_READ_TIMEOUT, CHAT_TIMEOUT, STRAT_TF_UNAVAILABLE, DASH_SELECTED_COIN_NO_SIGNAL, MARKET_READ_UNAVAILABLE, MARKET_READ_UNAVAILABLE_SUB, LOGIN_CAPTCHA_STUCK. English ships in lib/labelDefaults.en.json and needs no row.
-- ko/zh/ru are AI-drafted and not native-reviewed, under the owner's 2026-11-13 ruling (see 20261113b). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('ARENA_READ_TIMEOUT','ko','AI 분석이 너무 오래 걸려 중단되었습니다. 다시 시도해 주세요.'),
('ARENA_READ_TIMEOUT','zh','AI 分析耗时过长，已被停止。请重试。'),
('ARENA_READ_TIMEOUT','ru','AI-анализ занял слишком много времени и был остановлен. Попробуйте ещё раз.'),
('CHAT_TIMEOUT','ko','AI 답변이 너무 오래 걸려 중단되었습니다. 다시 시도해 주세요.'),
('CHAT_TIMEOUT','zh','AI 回复耗时过长，已被停止。请重试。'),
('CHAT_TIMEOUT','ru','AI отвечал слишком долго, ответ был остановлен. Попробуйте ещё раз.'),
('STRAT_TF_UNAVAILABLE','ko','이 시간대에서는 전략 신호를 사용할 수 없습니다. 1m~1d 중에서 선택하세요.'),
('STRAT_TF_UNAVAILABLE','zh','此周期不提供策略信号。请选择 1m 至 1d。'),
('STRAT_TF_UNAVAILABLE','ru','На этом таймфрейме сигналы стратегий недоступны. Выберите от 1m до 1d.'),
('DASH_SELECTED_COIN_NO_SIGNAL','ko','신호 없음'),
('DASH_SELECTED_COIN_NO_SIGNAL','zh','暂无信号'),
('DASH_SELECTED_COIN_NO_SIGNAL','ru','Нет сигнала'),
('MARKET_READ_UNAVAILABLE','ko','시장 분석을 사용할 수 없습니다'),
('MARKET_READ_UNAVAILABLE','zh','市场解读暂不可用'),
('MARKET_READ_UNAVAILABLE','ru','Обзор рынка недоступен'),
('MARKET_READ_UNAVAILABLE_SUB','ko','공포·탐욕 지수 또는 펀딩 데이터를 불러오지 못해 분석을 표시하지 않습니다. 자동으로 다시 시도합니다.'),
('MARKET_READ_UNAVAILABLE_SUB','zh','恐惧与贪婪指数或资金费率数据未能加载，因此不显示解读。系统会自动重试。'),
('MARKET_READ_UNAVAILABLE_SUB','ru','Данные индекса страха и жадности или фандинга не загрузились, поэтому обзор не показан. Повтор идёт автоматически.'),
('LOGIN_CAPTCHA_STUCK','ko','보안 확인을 불러오지 못했습니다. 연결 상태나 광고 차단기를 확인한 뒤 페이지를 새로 고침하세요.'),
('LOGIN_CAPTCHA_STUCK','zh','安全验证未能加载。请检查网络连接或广告拦截器，然后刷新页面。'),
('LOGIN_CAPTCHA_STUCK','ru','Проверка безопасности не загрузилась. Проверьте соединение или блокировщик рекламы и обновите страницу.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('ARENA_READ_TIMEOUT','ko','AI 분석이 너무 오래 걸려 중단되었습니다. 다시 시도해 주세요.'),
('ARENA_READ_TIMEOUT','zh','AI 分析耗时过长，已被停止。请重试。'),
('ARENA_READ_TIMEOUT','ru','AI-анализ занял слишком много времени и был остановлен. Попробуйте ещё раз.'),
('CHAT_TIMEOUT','ko','AI 답변이 너무 오래 걸려 중단되었습니다. 다시 시도해 주세요.'),
('CHAT_TIMEOUT','zh','AI 回复耗时过长，已被停止。请重试。'),
('CHAT_TIMEOUT','ru','AI отвечал слишком долго, ответ был остановлен. Попробуйте ещё раз.'),
('STRAT_TF_UNAVAILABLE','ko','이 시간대에서는 전략 신호를 사용할 수 없습니다. 1m~1d 중에서 선택하세요.'),
('STRAT_TF_UNAVAILABLE','zh','此周期不提供策略信号。请选择 1m 至 1d。'),
('STRAT_TF_UNAVAILABLE','ru','На этом таймфрейме сигналы стратегий недоступны. Выберите от 1m до 1d.'),
('DASH_SELECTED_COIN_NO_SIGNAL','ko','신호 없음'),
('DASH_SELECTED_COIN_NO_SIGNAL','zh','暂无信号'),
('DASH_SELECTED_COIN_NO_SIGNAL','ru','Нет сигнала'),
('MARKET_READ_UNAVAILABLE','ko','시장 분석을 사용할 수 없습니다'),
('MARKET_READ_UNAVAILABLE','zh','市场解读暂不可用'),
('MARKET_READ_UNAVAILABLE','ru','Обзор рынка недоступен'),
('MARKET_READ_UNAVAILABLE_SUB','ko','공포·탐욕 지수 또는 펀딩 데이터를 불러오지 못해 분석을 표시하지 않습니다. 자동으로 다시 시도합니다.'),
('MARKET_READ_UNAVAILABLE_SUB','zh','恐惧与贪婪指数或资金费率数据未能加载，因此不显示解读。系统会自动重试。'),
('MARKET_READ_UNAVAILABLE_SUB','ru','Данные индекса страха и жадности или фандинга не загрузились, поэтому обзор не показан. Повтор идёт автоматически.'),
('LOGIN_CAPTCHA_STUCK','ko','보안 확인을 불러오지 못했습니다. 연결 상태나 광고 차단기를 확인한 뒤 페이지를 새로 고침하세요.'),
('LOGIN_CAPTCHA_STUCK','zh','安全验证未能加载。请检查网络连接或广告拦截器，然后刷新页面。'),
('LOGIN_CAPTCHA_STUCK','ru','Проверка безопасности не загрузилась. Проверьте соединение или блокировщик рекламы и обновите страницу.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
