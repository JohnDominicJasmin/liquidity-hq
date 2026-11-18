-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso BEFORE the release deploy; DEV on wdtjhrilakoitfcezxpx.
--
-- Page headers say only what the page does not already show (owner: "no wordy sections"; same refinement as the Arena header, #2565). /alerts, /correlation and /funding keep one short line with the one fact the page needs (check interval, return window, colour legend); the four Trade Journal tool tabs get one factual line each. All 7 keys x 5 locales.
-- TRADE_JOURNAL_PAGE_SUBTITLE (a slogan) is no longer rendered or registered, so its rows are deleted. ABOUT_PAGE_SUBTITLE is no longer rendered on /about but still feeds the site's structured-data description, so its rows stay.
-- ko/zh/ru/ar are AI-drafted and not native-reviewed (owner's 2026-11-13 ruling).
--
-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_PAGE_SUBTITLE','en','Checked every 5 minutes.'),
('ALERTS_PAGE_SUBTITLE','ko','5분마다 확인합니다.'),
('ALERTS_PAGE_SUBTITLE','zh','每5分钟检查一次。'),
('ALERTS_PAGE_SUBTITLE','ru','Проверка каждые 5 минут.'),
('ALERTS_PAGE_SUBTITLE','ar','يتم الفحص كل 5 دقائق.'),
('CORRELATION_PAGE_SUBTITLE','en','Based on {range} returns.'),
('CORRELATION_PAGE_SUBTITLE','ko','{range} 수익률 기준.'),
('CORRELATION_PAGE_SUBTITLE','zh','基于{range}回报计算。'),
('CORRELATION_PAGE_SUBTITLE','ru','По доходности за {range}.'),
('CORRELATION_PAGE_SUBTITLE','ar','بناءً على العوائد خلال {range}.'),
('FUNDING_PAGE_SUBTITLE','en','Red: longs paying. Green: shorts paying.'),
('FUNDING_PAGE_SUBTITLE','ko','빨강: 롱 지불. 초록: 숏 지불.'),
('FUNDING_PAGE_SUBTITLE','zh','红色：多头支付。绿色：空头支付。'),
('FUNDING_PAGE_SUBTITLE','ru','Красный: лонги платят. Зелёный: шорты платят.'),
('FUNDING_PAGE_SUBTITLE','ar','الأحمر: المشترون يدفعون. الأخضر: البائعون يدفعون.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','en','Trades that break a rule are flagged when logged and in History.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','ko','규칙을 어긴 거래는 기록할 때와 기록 탭에서 표시됩니다.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','zh','违反规则的交易会在记录时和历史记录中标出。'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','ru','Сделки с нарушением правила отмечаются при записи и в истории.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','ar','تُميَّز الصفقات المخالفة لقاعدة عند تسجيلها وفي السجل.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','en','AI reads your trade history for your implicit rules and patterns.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','ko','AI가 거래 내역에서 암묵적인 규칙과 패턴을 찾습니다.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','zh','AI 从你的交易记录中找出隐含规则和模式。'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','ru','AI находит в истории сделок ваши неявные правила и паттерны.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','ar','يقرأ الذكاء الاصطناعي سجل صفقاتك لاستخراج قواعدك الضمنية وأنماطك.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','en','Checks your trades for four biases, with estimated P&L drag per bias.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','ko','거래에서 4가지 편향을 점검하고 편향별 추정 손익 영향을 보여줍니다.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','zh','检查你的交易中的四种偏差，并估算每种偏差对盈亏的拖累。'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','ru','Проверяет сделки на четыре искажения и оценивает потери P&L по каждому.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','ar','يفحص صفقاتك بحثًا عن أربعة تحيزات، مع تقدير أثر كل منها على الربح والخسارة.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','en','AI checks whether your thesis assumptions still hold. Health score 1-10.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','ko','AI가 논제의 가정이 여전히 유효한지 확인합니다. 건전성 점수 1-10.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','zh','AI 检查你的论点假设是否依然成立。健康评分 1-10。'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','ru','AI проверяет, верны ли ещё допущения вашего тезиса. Оценка 1-10.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','ar','يتحقق الذكاء الاصطناعي مما إذا كانت افتراضات فرضيتك لا تزال قائمة. تقييم الصحة 1-10.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
delete from lhq_labels where key in ('TRADE_JOURNAL_PAGE_SUBTITLE');

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_PAGE_SUBTITLE','en','Checked every 5 minutes.'),
('ALERTS_PAGE_SUBTITLE','ko','5분마다 확인합니다.'),
('ALERTS_PAGE_SUBTITLE','zh','每5分钟检查一次。'),
('ALERTS_PAGE_SUBTITLE','ru','Проверка каждые 5 минут.'),
('ALERTS_PAGE_SUBTITLE','ar','يتم الفحص كل 5 دقائق.'),
('CORRELATION_PAGE_SUBTITLE','en','Based on {range} returns.'),
('CORRELATION_PAGE_SUBTITLE','ko','{range} 수익률 기준.'),
('CORRELATION_PAGE_SUBTITLE','zh','基于{range}回报计算。'),
('CORRELATION_PAGE_SUBTITLE','ru','По доходности за {range}.'),
('CORRELATION_PAGE_SUBTITLE','ar','بناءً على العوائد خلال {range}.'),
('FUNDING_PAGE_SUBTITLE','en','Red: longs paying. Green: shorts paying.'),
('FUNDING_PAGE_SUBTITLE','ko','빨강: 롱 지불. 초록: 숏 지불.'),
('FUNDING_PAGE_SUBTITLE','zh','红色：多头支付。绿色：空头支付。'),
('FUNDING_PAGE_SUBTITLE','ru','Красный: лонги платят. Зелёный: шорты платят.'),
('FUNDING_PAGE_SUBTITLE','ar','الأحمر: المشترون يدفعون. الأخضر: البائعون يدفعون.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','en','Trades that break a rule are flagged when logged and in History.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','ko','규칙을 어긴 거래는 기록할 때와 기록 탭에서 표시됩니다.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','zh','违反规则的交易会在记录时和历史记录中标出。'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','ru','Сделки с нарушением правила отмечаются при записи и в истории.'),
('TRADE_JOURNAL_RULES_PAGE_SUBTITLE','ar','تُميَّز الصفقات المخالفة لقاعدة عند تسجيلها وفي السجل.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','en','AI reads your trade history for your implicit rules and patterns.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','ko','AI가 거래 내역에서 암묵적인 규칙과 패턴을 찾습니다.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','zh','AI 从你的交易记录中找出隐含规则和模式。'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','ru','AI находит в истории сделок ваши неявные правила и паттерны.'),
('TRADE_JOURNAL_SHADOW_PAGE_SUBTITLE','ar','يقرأ الذكاء الاصطناعي سجل صفقاتك لاستخراج قواعدك الضمنية وأنماطك.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','en','Checks your trades for four biases, with estimated P&L drag per bias.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','ko','거래에서 4가지 편향을 점검하고 편향별 추정 손익 영향을 보여줍니다.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','zh','检查你的交易中的四种偏差，并估算每种偏差对盈亏的拖累。'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','ru','Проверяет сделки на четыре искажения и оценивает потери P&L по каждому.'),
('TRADE_JOURNAL_BIAS_PAGE_SUBTITLE','ar','يفحص صفقاتك بحثًا عن أربعة تحيزات، مع تقدير أثر كل منها على الربح والخسارة.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','en','AI checks whether your thesis assumptions still hold. Health score 1-10.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','ko','AI가 논제의 가정이 여전히 유효한지 확인합니다. 건전성 점수 1-10.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','zh','AI 检查你的论点假设是否依然成立。健康评分 1-10。'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','ru','AI проверяет, верны ли ещё допущения вашего тезиса. Оценка 1-10.'),
('TRADE_JOURNAL_THESIS_PAGE_SUBTITLE','ar','يتحقق الذكاء الاصطناعي مما إذا كانت افتراضات فرضيتك لا تزال قائمة. تقييم الصحة 1-10.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
delete from lhq_dev_labels where key in ('TRADE_JOURNAL_PAGE_SUBTITLE');
