-- #1569 (owner order 2026-10-10, re-scoped 2026-10-21 to what is STILL VISIBLE): earnings-claim wording that payment reviewers (Whop, MoonPay Commerce) flag.
--
-- WHAT IS HERE (four keys, five locales, all in use on a default build):
--   CALC_SIZER_RESULT_POTENTIAL_PROFIT  "Potential Profit" -> "Example Outcome"        (Position Sizer: the result of the user's OWN inputs)
--   CALC_PNL_BANNER_PROFIT              "PROFIT" -> "GAIN (example)"                  (P&L calculator banner)
--   CALC_PNL_BANNER_LOSS                "LOSS"   -> "LOSS (example)"                  (the same banner's other side, so the pair stays matched; Dev's addition)
--   JOURNAL_HINT_BODY                   "...your edge..." -> "...your patterns..."     (Trade Journal hint)
-- WHAT IS NOT HERE and why: the Win Rate / Profit Factor / Signal Accuracy / Recent record panels are hidden on a default build (NEXT_PUBLIC_SHOW_PERFORMANCE_STATS off,
-- #1574) and /backtest and /live-tracking redirect to /dashboard (#264), so renaming or captioning them is only needed if the owner turns that flag on. The Risk/Reward
-- calculator's Win Rate input and the Trade Journal's statistics are the user's own numbers.
--
-- These rows OVERWRITE whatever is live for these four keys in every locale (the label table, not this repo, is the record, and some live rows were never in a migration),
-- so that is the intent: the new wording replaces the old. ar/ko/ru/zh are Dev machine translations, NOT native-reviewed.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says no test pass is running).
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','en','Example Outcome'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ar','نتيجة توضيحية'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ko','예시 결과'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ru','Пример результата'),
('CALC_SIZER_RESULT_POTENTIAL_PROFIT','zh','示例结果'),
('CALC_PNL_BANNER_PROFIT','en','▲ GAIN (example) - {pct}'),
('CALC_PNL_BANNER_PROFIT','ar','▲ مكسب (مثال) - {pct}'),
('CALC_PNL_BANNER_PROFIT','ko','▲ 증가 (예시) - {pct}'),
('CALC_PNL_BANNER_PROFIT','ru','▲ ПРИРОСТ (пример) - {pct}'),
('CALC_PNL_BANNER_PROFIT','zh','▲ 增幅（示例）- {pct}'),
('CALC_PNL_BANNER_LOSS','en','▼ LOSS (example) - {pct}'),
('CALC_PNL_BANNER_LOSS','ar','▼ خسارة (مثال) - {pct}'),
('CALC_PNL_BANNER_LOSS','ko','▼ 손실 (예시) - {pct}'),
('CALC_PNL_BANNER_LOSS','ru','▼ УБЫТОК (пример) - {pct}'),
('CALC_PNL_BANNER_LOSS','zh','▼ 亏损（示例）- {pct}'),
('JOURNAL_HINT_BODY','en','Log every trade you take, then review your win rate, streak, and patterns over time. The more you log, the clearer your patterns become.'),
('JOURNAL_HINT_BODY','ar','سجّل كل صفقة تنفذها، ثم راجع معدل ربحك وسلسلة نتائجك وأنماطك بمرور الوقت. كلما زاد تسجيلك، ازدادت أنماطك وضوحاً.'),
('JOURNAL_HINT_BODY','ko','거래할 때마다 기록하고, 시간이 지나면서 승률, 연승, 패턴을 확인하세요. 기록이 쌓일수록 패턴이 더 명확해집니다.'),
('JOURNAL_HINT_BODY','ru','Записывайте каждую сделку, затем со временем анализируйте свой процент побед, серию и паттерны. Чем больше вы записываете, тем яснее проявляются ваши паттерны.'),
('JOURNAL_HINT_BODY','zh','记录你做的每一笔交易，随时间回顾胜率、连续走势和交易模式。记录得越多，你的交易模式就越清晰。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','en','Example Outcome'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ar','نتيجة توضيحية'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ko','예시 결과'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','ru','Пример результата'),
-- ('CALC_SIZER_RESULT_POTENTIAL_PROFIT','zh','示例结果'),
-- ('CALC_PNL_BANNER_PROFIT','en','▲ GAIN (example) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','ar','▲ مكسب (مثال) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','ko','▲ 증가 (예시) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','ru','▲ ПРИРОСТ (пример) - {pct}'),
-- ('CALC_PNL_BANNER_PROFIT','zh','▲ 增幅（示例）- {pct}'),
-- ('CALC_PNL_BANNER_LOSS','en','▼ LOSS (example) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','ar','▼ خسارة (مثال) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','ko','▼ 손실 (예시) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','ru','▼ УБЫТОК (пример) - {pct}'),
-- ('CALC_PNL_BANNER_LOSS','zh','▼ 亏损（示例）- {pct}'),
-- ('JOURNAL_HINT_BODY','en','Log every trade you take, then review your win rate, streak, and patterns over time. The more you log, the clearer your patterns become.'),
-- ('JOURNAL_HINT_BODY','ar','سجّل كل صفقة تنفذها، ثم راجع معدل ربحك وسلسلة نتائجك وأنماطك بمرور الوقت. كلما زاد تسجيلك، ازدادت أنماطك وضوحاً.'),
-- ('JOURNAL_HINT_BODY','ko','거래할 때마다 기록하고, 시간이 지나면서 승률, 연승, 패턴을 확인하세요. 기록이 쌓일수록 패턴이 더 명확해집니다.'),
-- ('JOURNAL_HINT_BODY','ru','Записывайте каждую сделку, затем со временем анализируйте свой процент побед, серию и паттерны. Чем больше вы записываете, тем яснее проявляются ваши паттерны.'),
-- ('JOURNAL_HINT_BODY','zh','记录你做的每一笔交易，随时间回顾胜率、连续走势和交易模式。记录得越多，你的交易模式就越清晰。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
