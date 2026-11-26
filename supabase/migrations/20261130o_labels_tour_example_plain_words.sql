-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- The onboarding tour's example card in plain words instead of setup codes (#1185).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('SPOTLIGHT_TOUR_ALERT_FIRED','ar','تم إطلاق التنبيه - BTC غلبة مراكز البيع 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','en','Alert fired - BTC Short-heavy 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','ko','알림 발생 - BTC 숏 우세 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','ru','Сработал сигнал - BTC перекос в шорты 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','zh','提醒已触发 - BTC 空头偏重 87/100'),
('SPOTLIGHT_TOUR_CARD3_SUB','ar','غلبة مراكز البيع، سكويز آخذ في التشكل'),
('SPOTLIGHT_TOUR_CARD3_SUB','en','Short-heavy, squeeze forming'),
('SPOTLIGHT_TOUR_CARD3_SUB','ko','숏 우세, 스퀴즈 형성 중'),
('SPOTLIGHT_TOUR_CARD3_SUB','ru','Перекос в шорты, формируется сквиз'),
('SPOTLIGHT_TOUR_CARD3_SUB','zh','空头偏重，挤压正在形成'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','ar','BTC غلبة مراكز البيع 82/100 - سكويز آخذ في التشكل'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','en','BTC Short-heavy 82/100 - squeeze forming'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','ko','BTC 숏 우세 82/100 - 스퀴즈 형성 중'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','ru','BTC перекос в шорты 82/100 - формируется сквиз'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','zh','BTC 空头偏重 82/100 - 挤压正在形成')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('SPOTLIGHT_TOUR_ALERT_FIRED','ar','تم إطلاق التنبيه - BTC غلبة مراكز البيع 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','en','Alert fired - BTC Short-heavy 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','ko','알림 발생 - BTC 숏 우세 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','ru','Сработал сигнал - BTC перекос в шорты 87/100'),
('SPOTLIGHT_TOUR_ALERT_FIRED','zh','提醒已触发 - BTC 空头偏重 87/100'),
('SPOTLIGHT_TOUR_CARD3_SUB','ar','غلبة مراكز البيع، سكويز آخذ في التشكل'),
('SPOTLIGHT_TOUR_CARD3_SUB','en','Short-heavy, squeeze forming'),
('SPOTLIGHT_TOUR_CARD3_SUB','ko','숏 우세, 스퀴즈 형성 중'),
('SPOTLIGHT_TOUR_CARD3_SUB','ru','Перекос в шорты, формируется сквиз'),
('SPOTLIGHT_TOUR_CARD3_SUB','zh','空头偏重，挤压正在形成'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','ar','BTC غلبة مراكز البيع 82/100 - سكويز آخذ في التشكل'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','en','BTC Short-heavy 82/100 - squeeze forming'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','ko','BTC 숏 우세 82/100 - 스퀴즈 형성 중'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','ru','BTC перекос в шорты 82/100 - формируется сквиз'),
('SPOTLIGHT_TOUR_TELEGRAM_BODY','zh','BTC 空头偏重 82/100 - 挤压正在形成')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
