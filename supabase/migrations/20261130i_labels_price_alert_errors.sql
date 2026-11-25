-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: PROD on qdpwhnvmhqgzijuwopso; DEV on wdtjhrilakoitfcezxpx.
-- Price alert errors in the reader's language (#1263).

-- ===================== PROD =====================
insert into lhq_labels (key, locale, value) values
('ALERTS_ERR_SIGN_IN','ar','سجّل الدخول مرة أخرى للمتابعة.'),
('ALERTS_ERR_SIGN_IN','en','Sign in again to continue.'),
('ALERTS_ERR_SIGN_IN','ko','계속하려면 다시 로그인하세요.'),
('ALERTS_ERR_SIGN_IN','ru','Войдите снова, чтобы продолжить.'),
('ALERTS_ERR_SIGN_IN','zh','请重新登录后继续。'),
('ALERTS_ERR_LIMIT','ar','يمكنك الاحتفاظ بما يصل إلى {max} تنبيه سعر نشط. احذف واحدًا لإضافة آخر.'),
('ALERTS_ERR_LIMIT','en','You can have up to {max} active price alerts. Delete one to add another.'),
('ALERTS_ERR_LIMIT','ko','활성 가격 알림은 최대 {max}개입니다. 새로 추가하려면 하나를 삭제하세요.'),
('ALERTS_ERR_LIMIT','ru','Можно иметь до {max} активных оповещений о цене. Удалите одно, чтобы добавить новое.'),
('ALERTS_ERR_LIMIT','zh','最多可有 {max} 个有效价格提醒。请删除一个后再添加。'),
('ALERTS_ERR_NOTE_TOO_LONG','ar','الملاحظة طويلة جدًا.'),
('ALERTS_ERR_NOTE_TOO_LONG','en','The note is too long.'),
('ALERTS_ERR_NOTE_TOO_LONG','ko','메모가 너무 깁니다.'),
('ALERTS_ERR_NOTE_TOO_LONG','ru','Заметка слишком длинная.'),
('ALERTS_ERR_NOTE_TOO_LONG','zh','备注过长。'),
('ALERTS_ERR_INVALID','ar','تحقق من السعر والاتجاه.'),
('ALERTS_ERR_INVALID','en','Check the price and the direction.'),
('ALERTS_ERR_INVALID','ko','가격과 방향을 확인하세요.'),
('ALERTS_ERR_INVALID','ru','Проверьте цену и направление.'),
('ALERTS_ERR_INVALID','zh','请检查价格和方向。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ===================== DEV =====================
insert into lhq_dev_labels (key, locale, value) values
('ALERTS_ERR_SIGN_IN','ar','سجّل الدخول مرة أخرى للمتابعة.'),
('ALERTS_ERR_SIGN_IN','en','Sign in again to continue.'),
('ALERTS_ERR_SIGN_IN','ko','계속하려면 다시 로그인하세요.'),
('ALERTS_ERR_SIGN_IN','ru','Войдите снова, чтобы продолжить.'),
('ALERTS_ERR_SIGN_IN','zh','请重新登录后继续。'),
('ALERTS_ERR_LIMIT','ar','يمكنك الاحتفاظ بما يصل إلى {max} تنبيه سعر نشط. احذف واحدًا لإضافة آخر.'),
('ALERTS_ERR_LIMIT','en','You can have up to {max} active price alerts. Delete one to add another.'),
('ALERTS_ERR_LIMIT','ko','활성 가격 알림은 최대 {max}개입니다. 새로 추가하려면 하나를 삭제하세요.'),
('ALERTS_ERR_LIMIT','ru','Можно иметь до {max} активных оповещений о цене. Удалите одно, чтобы добавить новое.'),
('ALERTS_ERR_LIMIT','zh','最多可有 {max} 个有效价格提醒。请删除一个后再添加。'),
('ALERTS_ERR_NOTE_TOO_LONG','ar','الملاحظة طويلة جدًا.'),
('ALERTS_ERR_NOTE_TOO_LONG','en','The note is too long.'),
('ALERTS_ERR_NOTE_TOO_LONG','ko','메모가 너무 깁니다.'),
('ALERTS_ERR_NOTE_TOO_LONG','ru','Заметка слишком длинная.'),
('ALERTS_ERR_NOTE_TOO_LONG','zh','备注过长。'),
('ALERTS_ERR_INVALID','ar','تحقق من السعر والاتجاه.'),
('ALERTS_ERR_INVALID','en','Check the price and the direction.'),
('ALERTS_ERR_INVALID','ko','가격과 방향을 확인하세요.'),
('ALERTS_ERR_INVALID','ru','Проверьте цену и направление.'),
('ALERTS_ERR_INVALID','zh','请检查价格和方向。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
