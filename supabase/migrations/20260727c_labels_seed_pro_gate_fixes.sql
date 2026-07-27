-- Labels for the Pro/Free gating fixes:
--   ALERTS_PRICE_LOCKED_DESC - locked-card copy for Price Alerts, which are
--     delivered over Telegram and were previously creatable by free users
--     (the alert then saved and silently never fired).
--   SETTINGS_TF_PRO_ONLY - tooltip on the Pro-gated fast-timeframe chips in
--     Settings, which used to be freely selectable and were then silently
--     clamped back to 1h by Arena on load.
-- Run against both prod (qdpwhnvmhqgzijuwopso, table lhq_labels) and
-- dev (wdtjhrilakoitfcezxpx, table lhq_dev_labels).

insert into lhq_labels (key, locale, value) values
('ALERTS_PRICE_LOCKED_DESC', 'en', 'Get a Telegram ping the moment a coin crosses a price you care about.'),
('ALERTS_PRICE_LOCKED_DESC', 'ko', '관심 있는 가격을 코인이 돌파하는 즉시 텔레그램으로 알림을 받으세요.'),
('ALERTS_PRICE_LOCKED_DESC', 'zh', '当币价突破您关注的价位时，立即接收 Telegram 通知。'),
('ALERTS_PRICE_LOCKED_DESC', 'ar', 'احصل على تنبيه عبر تيليجرام لحظة تجاوز العملة للسعر الذي يهمك.'),
('ALERTS_PRICE_LOCKED_DESC', 'ru', 'Получайте уведомление в Telegram, как только монета пересечёт нужную вам цену.'),

('SETTINGS_TF_PRO_ONLY', 'en', 'Fast timeframes are a Pro feature.'),
('SETTINGS_TF_PRO_ONLY', 'ko', '빠른 시간대는 Pro 전용 기능입니다.'),
('SETTINGS_TF_PRO_ONLY', 'zh', '快速时间周期为 Pro 专属功能。'),
('SETTINGS_TF_PRO_ONLY', 'ar', 'الأطر الزمنية السريعة ميزة حصرية لـ Pro.'),
('SETTINGS_TF_PRO_ONLY', 'ru', 'Быстрые таймфреймы доступны только в Pro.')
on conflict (key, locale) do update set value = excluded.value;
