-- #1347 item 12. The Strategy Panel's per-indicator parameter editor changes
-- the line drawn on the chart, but NOT the condition behind the buy/sell call:
-- `lib/useEMAStrategy.ts` gates on registry defaults (smaArr(cl4, 12),
-- bollingerBandsArr(cl4, 20, 2), psarArr(cRibbon, 0.02, 0.02, 0.2),
-- macdArr(cl4, 12, 26, 9), rsiArr(cl4, 14)) and is never passed
-- `strategyParams`.
--
-- The owner ruled on 2026-09-18 that this limitation is ACCEPTED but must be
-- LABELLED - a Pro user who edits Bollinger Length, watches the line move and
-- concludes the call moved with it has been misled by silence. They chose this
-- wording over the alternative that used the word "verdict", because "verdict"
-- is our internal name for that card and appears nowhere a user can see,
-- whereas the card itself is labelled with the buy or sell call.
--
-- English is the owner's approved wording, verbatim apart from punctuation:
-- offered with a dash, shipped with a full stop, because our copy rule bans
-- the em dash in user-facing text.
--
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not reviewed by a native speaker,
-- the same standard as the rest of this audit's translation waves. Recorded
-- as a known limitation rather than presented as translation quality.
--
-- NOTE ON THE FALLBACK: this key is also hand-added to
-- lib/labelDefaults.en.json. That file is a snapshot regenerated wholesale
-- from a running server (scripts/regen-label-defaults.mjs), so the hand-added
-- entry survives only until the next regen. These rows are what makes it
-- permanent. Apply them before any `labels:regen`, or the panel renders the
-- raw key on screen.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx). The dev section below is
-- commented out per 20260912b's convention - apply one section at a time.
-- Shared-database write: owner-gated. Owner approved both writes for this
-- release on 2026-09-18.

insert into lhq_labels (key, locale, value) values

('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','en','Changes the chart line only. The buy/sell call still uses standard settings.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ar','يغيّر خط الرسم البياني فقط. أما إشارة الشراء أو البيع فلا تزال تستخدم الإعدادات القياسية.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ko','차트 선만 변경됩니다. 매수/매도 판단은 여전히 기본 설정을 사용합니다.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ru','Меняет только линию на графике. Сигнал на покупку или продажу по-прежнему использует стандартные настройки.'),
('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','zh','仅改变图表上的线条。买入/卖出判断仍使用标准设置。')

on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels - apply separately, per 20260912b.
--
-- insert into lhq_dev_labels (key, locale, value) values
--
-- ('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','en','Changes the chart line only. The buy/sell call still uses standard settings.'),
-- ('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ar','يغيّر خط الرسم البياني فقط. أما إشارة الشراء أو البيع فلا تزال تستخدم الإعدادات القياسية.'),
-- ('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ko','차트 선만 변경됩니다. 매수/매도 판단은 여전히 기본 설정을 사용합니다.'),
-- ('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','ru','Меняет только линию на графике. Сигнал на покупку или продажу по-прежнему использует стандартные настройки.'),
-- ('STRATEGY_PANEL_PARAMS_VERDICT_NOTE','zh','仅改变图表上的线条。买入/卖出判断仍使用标准设置。')
--
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
