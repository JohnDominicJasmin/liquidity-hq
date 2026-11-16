-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- /research: "BTC Risk Level / Low Risk" becomes "BTC Long Crowding / Low crowding" (PM, 2026-11-16). The score is a blend of Fear & Greed, daily RSI and positive funding: it describes how crowded longs are, and a
-- "Low Risk" label was a claim about dump risk that the inputs cannot back. The en rows are REQUIRED: a stored en row overrides the shipped default and the old "Risk" wording is stored. New key BTC_RISK_LEVEL_INPUTS_COUNT.
-- ko/zh/ru are AI-drafted and not native-reviewed.
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('BTC_RISK_LEVEL_TITLE','en','BTC Long Crowding'),
('BTC_RISK_LEVEL_TOOLTIP','en','Blends three inputs into one 0-100 score of how crowded long positions look: the Fear & Greed index, BTC''s daily RSI, and BTC''s funding rate (only positive funding adds to it). It describes positioning, not a forecast of price.'),
('BTC_RISK_LEVEL_LOW','en','Low crowding'),
('BTC_RISK_LEVEL_MODERATE','en','Moderate crowding'),
('BTC_RISK_LEVEL_HIGH','en','High crowding'),
('BTC_RISK_LEVEL_EXTREME','en','Extreme crowding'),
('BTC_RISK_LEVEL_INPUTS_COUNT','en','{n} of 3 inputs'),
('BTC_RISK_LEVEL_TITLE','ko','BTC 롱 쏠림'),
('BTC_RISK_LEVEL_TOOLTIP','ko','공포·탐욕 지수, BTC 일봉 RSI, BTC 펀딩비(양수일 때만 반영) 세 가지를 합쳐 롱 포지션이 얼마나 쏠려 있는지를 0-100으로 나타냅니다. 포지션 상태를 보여줄 뿐 가격 예측이 아닙니다.'),
('BTC_RISK_LEVEL_LOW','ko','쏠림 낮음'),
('BTC_RISK_LEVEL_MODERATE','ko','쏠림 보통'),
('BTC_RISK_LEVEL_HIGH','ko','쏠림 높음'),
('BTC_RISK_LEVEL_EXTREME','ko','쏠림 매우 높음'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ko','입력 {n}/3개'),
('BTC_RISK_LEVEL_TITLE','zh','BTC 多头拥挤度'),
('BTC_RISK_LEVEL_TOOLTIP','zh','将恐惧与贪婪指数、BTC 日线 RSI 和 BTC 资金费率(仅正值计入)三项合成一个 0-100 分数,表示多头仓位的拥挤程度。它描述的是持仓状况,不是价格预测。'),
('BTC_RISK_LEVEL_LOW','zh','拥挤度低'),
('BTC_RISK_LEVEL_MODERATE','zh','拥挤度中等'),
('BTC_RISK_LEVEL_HIGH','zh','拥挤度高'),
('BTC_RISK_LEVEL_EXTREME','zh','拥挤度极高'),
('BTC_RISK_LEVEL_INPUTS_COUNT','zh','{n}/3 项输入'),
('BTC_RISK_LEVEL_TITLE','ru','Перегруженность лонгов BTC'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Объединяет три показателя в одну оценку 0-100 того, насколько переполнены длинные позиции: индекс страха и жадности, дневной RSI BTC и ставка финансирования BTC (учитывается только положительная). Это описание позиционирования, а не прогноз цены.'),
('BTC_RISK_LEVEL_LOW','ru','Низкая перегруженность'),
('BTC_RISK_LEVEL_MODERATE','ru','Умеренная перегруженность'),
('BTC_RISK_LEVEL_HIGH','ru','Высокая перегруженность'),
('BTC_RISK_LEVEL_EXTREME','ru','Экстремальная перегруженность'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ru','Входов: {n} из 3')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('BTC_RISK_LEVEL_TITLE','en','BTC Long Crowding'),
('BTC_RISK_LEVEL_TOOLTIP','en','Blends three inputs into one 0-100 score of how crowded long positions look: the Fear & Greed index, BTC''s daily RSI, and BTC''s funding rate (only positive funding adds to it). It describes positioning, not a forecast of price.'),
('BTC_RISK_LEVEL_LOW','en','Low crowding'),
('BTC_RISK_LEVEL_MODERATE','en','Moderate crowding'),
('BTC_RISK_LEVEL_HIGH','en','High crowding'),
('BTC_RISK_LEVEL_EXTREME','en','Extreme crowding'),
('BTC_RISK_LEVEL_INPUTS_COUNT','en','{n} of 3 inputs'),
('BTC_RISK_LEVEL_TITLE','ko','BTC 롱 쏠림'),
('BTC_RISK_LEVEL_TOOLTIP','ko','공포·탐욕 지수, BTC 일봉 RSI, BTC 펀딩비(양수일 때만 반영) 세 가지를 합쳐 롱 포지션이 얼마나 쏠려 있는지를 0-100으로 나타냅니다. 포지션 상태를 보여줄 뿐 가격 예측이 아닙니다.'),
('BTC_RISK_LEVEL_LOW','ko','쏠림 낮음'),
('BTC_RISK_LEVEL_MODERATE','ko','쏠림 보통'),
('BTC_RISK_LEVEL_HIGH','ko','쏠림 높음'),
('BTC_RISK_LEVEL_EXTREME','ko','쏠림 매우 높음'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ko','입력 {n}/3개'),
('BTC_RISK_LEVEL_TITLE','zh','BTC 多头拥挤度'),
('BTC_RISK_LEVEL_TOOLTIP','zh','将恐惧与贪婪指数、BTC 日线 RSI 和 BTC 资金费率(仅正值计入)三项合成一个 0-100 分数,表示多头仓位的拥挤程度。它描述的是持仓状况,不是价格预测。'),
('BTC_RISK_LEVEL_LOW','zh','拥挤度低'),
('BTC_RISK_LEVEL_MODERATE','zh','拥挤度中等'),
('BTC_RISK_LEVEL_HIGH','zh','拥挤度高'),
('BTC_RISK_LEVEL_EXTREME','zh','拥挤度极高'),
('BTC_RISK_LEVEL_INPUTS_COUNT','zh','{n}/3 项输入'),
('BTC_RISK_LEVEL_TITLE','ru','Перегруженность лонгов BTC'),
('BTC_RISK_LEVEL_TOOLTIP','ru','Объединяет три показателя в одну оценку 0-100 того, насколько переполнены длинные позиции: индекс страха и жадности, дневной RSI BTC и ставка финансирования BTC (учитывается только положительная). Это описание позиционирования, а не прогноз цены.'),
('BTC_RISK_LEVEL_LOW','ru','Низкая перегруженность'),
('BTC_RISK_LEVEL_MODERATE','ru','Умеренная перегруженность'),
('BTC_RISK_LEVEL_HIGH','ru','Высокая перегруженность'),
('BTC_RISK_LEVEL_EXTREME','ru','Экстремальная перегруженность'),
('BTC_RISK_LEVEL_INPUTS_COUNT','ru','Входов: {n} из 3')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
