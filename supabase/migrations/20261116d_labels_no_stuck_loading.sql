-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Labels for the "nothing waits for ever" batch (#1651): ARENA_READ_TIMEOUT, CHAT_TIMEOUT, STRAT_TF_UNAVAILABLE, DASH_SELECTED_COIN_NO_SIGNAL. English ships in lib/labelDefaults.en.json and needs no row.
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
('DASH_SELECTED_COIN_NO_SIGNAL','ru','Нет сигнала')
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
('DASH_SELECTED_COIN_NO_SIGNAL','ru','Нет сигнала')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
