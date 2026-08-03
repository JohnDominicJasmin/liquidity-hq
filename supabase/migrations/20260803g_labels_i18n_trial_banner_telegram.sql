-- Unpauses i18n for the two surfaces that were costing the most: the trial
-- countdown banner and the Telegram connect wizard.
--
-- Context (see the i18n section of pendings/PENDING.md): en had drifted to 2570
-- rows while ko/zh/ar/ru sat at 2416 - 154 keys behind each. The labels API
-- layers English under every locale, so the gap rendered as English rather than
-- raw keys, which is why it went unnoticed. Two surfaces made it worth fixing
-- ahead of the rest:
--
--   TRIAL_BANNER_*    - the main conversion surface. A Korean user on a paid
--                       trial was being counted down to in English.
--   ALERTS_CONNECT_*  - the onboarding flow the FAQ walks people through.
--
-- 23 keys x 4 locales = 92 rows. ALERTS_CONNECT_TELEGRAM_TITLE already had all
-- four locales and is untouched.
--
-- Placeholders {days} and {time} are interpolated by lib/labels.ts and are
-- preserved verbatim in every locale - a dropped brace would print the literal
-- token to a user. Guarded in the generator and verified after applying.
--
-- Arabic note: TRIAL_BANNER_DAYS_LEFT is "الأيام المتبقية: {days}" rather than
-- an inflected phrase. Arabic has four plural forms and this is ONE template
-- for every count, so "متبقٍ {days} يوم" was wrong for 3-10 (which takes أيام).
-- The label:value construction avoids agreement altogether and reads correctly
-- for any number. Russian uses abbreviated "дн." for the same reason.
--
-- Verified live on the dev deploy with 7 days remaining:
--   ko  프로 체험판 전체 이용 가능 - 7일 남음
--   ar  النسخة التجريبية PRO وصول كامل - الأيام المتبقية: 7
--
-- Already applied to both projects.

insert into lhq_labels (key, locale, value) values
('TRIAL_BANNER_LABEL','ko','프로 체험판'),
('TRIAL_BANNER_LABEL','zh','Pro 试用'),
('TRIAL_BANNER_LABEL','ar','النسخة التجريبية Pro'),
('TRIAL_BANNER_LABEL','ru','Пробный период Pro'),
('TRIAL_BANNER_FULL_ACCESS','ko','전체 이용 가능 -'),
('TRIAL_BANNER_FULL_ACCESS','zh','完整权限 -'),
('TRIAL_BANNER_FULL_ACCESS','ar','وصول كامل -'),
('TRIAL_BANNER_FULL_ACCESS','ru','Полный доступ -'),
('TRIAL_BANNER_DAYS_LEFT','ko','{days}일 남음'),
('TRIAL_BANNER_DAYS_LEFT','zh','还剩 {days} 天'),
('TRIAL_BANNER_DAYS_LEFT','ar','الأيام المتبقية: {days}'),
('TRIAL_BANNER_DAYS_LEFT','ru','осталось {days} дн.'),
('TRIAL_BANNER_LAST_DAY','ko','마지막 날'),
('TRIAL_BANNER_LAST_DAY','zh','最后一天'),
('TRIAL_BANNER_LAST_DAY','ar','اليوم الأخير'),
('TRIAL_BANNER_LAST_DAY','ru','последний день'),
('TRIAL_BANNER_CTA','ko','Pro 유지하기'),
('TRIAL_BANNER_CTA','zh','保留 Pro'),
('TRIAL_BANNER_CTA','ar','الاحتفاظ بـ Pro'),
('TRIAL_BANNER_CTA','ru','Оставить Pro'),
('ALERTS_CONNECT_MANUAL_ONLY','ko','두 단계로 연결하세요:'),
('ALERTS_CONNECT_MANUAL_ONLY','zh','两步完成连接：'),
('ALERTS_CONNECT_MANUAL_ONLY','ar','اتصل في خطوتين:'),
('ALERTS_CONNECT_MANUAL_ONLY','ru','Подключение в два шага:'),
('ALERTS_CONNECT_OPEN_TELEGRAM','ko','텔레그램 열기'),
('ALERTS_CONNECT_OPEN_TELEGRAM','zh','打开 Telegram'),
('ALERTS_CONNECT_OPEN_TELEGRAM','ar','فتح تيليجرام'),
('ALERTS_CONNECT_OPEN_TELEGRAM','ru','Открыть Telegram'),
('ALERTS_CONNECT_SEND_MESSAGE','ko','봇에게 이 메시지를 보내세요:'),
('ALERTS_CONNECT_SEND_MESSAGE','zh','向机器人发送这条消息：'),
('ALERTS_CONNECT_SEND_MESSAGE','ar','أرسل هذه الرسالة إلى البوت:'),
('ALERTS_CONNECT_SEND_MESSAGE','ru','Отправьте боту это сообщение:'),
('ALERTS_CONNECT_COPY_BUTTON','ko','메시지 복사'),
('ALERTS_CONNECT_COPY_BUTTON','zh','复制消息'),
('ALERTS_CONNECT_COPY_BUTTON','ar','نسخ الرسالة'),
('ALERTS_CONNECT_COPY_BUTTON','ru','Скопировать сообщение'),
('ALERTS_CONNECT_COPIED','ko','복사됨'),
('ALERTS_CONNECT_COPIED','zh','已复制'),
('ALERTS_CONNECT_COPIED','ar','تم النسخ'),
('ALERTS_CONNECT_COPIED','ru','Скопировано'),
('ALERTS_CONNECT_EXPIRES_IN','ko','이 코드는 {time} 후에 만료됩니다.'),
('ALERTS_CONNECT_EXPIRES_IN','zh','此代码将在 {time} 后过期。'),
('ALERTS_CONNECT_EXPIRES_IN','ar','تنتهي صلاحية هذا الرمز خلال {time}.'),
('ALERTS_CONNECT_EXPIRES_IN','ru','Код истекает через {time}.'),
('ALERTS_CONNECT_CODE_EXPIRED','ko','이 코드는 만료되었습니다. 계속하려면 새 코드를 받으세요.'),
('ALERTS_CONNECT_CODE_EXPIRED','zh','此代码已过期。请获取新代码以继续。'),
('ALERTS_CONNECT_CODE_EXPIRED','ar','انتهت صلاحية هذا الرمز. احصل على رمز جديد للمتابعة.'),
('ALERTS_CONNECT_CODE_EXPIRED','ru','Срок действия кода истёк. Получите новый, чтобы продолжить.'),
('ALERTS_CONNECT_NEW_CODE_BUTTON','ko','새 코드 받기'),
('ALERTS_CONNECT_NEW_CODE_BUTTON','zh','获取新代码'),
('ALERTS_CONNECT_NEW_CODE_BUTTON','ar','الحصول على رمز جديد'),
('ALERTS_CONNECT_NEW_CODE_BUTTON','ru','Получить новый код'),
('ALERTS_CONNECT_WAITING','ko','텔레그램에서 완료하기를 기다리는 중입니다. 연결되는 즉시 이 페이지가 자동으로 업데이트됩니다.'),
('ALERTS_CONNECT_WAITING','zh','正在等待您在 Telegram 中完成操作。连接成功后本页面会自动更新。'),
('ALERTS_CONNECT_WAITING','ar','في انتظار إتمامك للخطوات في تيليجرام. ستُحدَّث هذه الصفحة تلقائيًا بمجرد الاتصال.'),
('ALERTS_CONNECT_WAITING','ru','Ожидаем завершения в Telegram. Страница обновится сама, как только подключение произойдёт.'),
('ALERTS_CONNECT_STILL_WAITING','ko','아직 연결되지 않았습니다. 텔레그램에서 단계를 완료한 후 다시 확인하세요.'),
('ALERTS_CONNECT_STILL_WAITING','zh','尚未连接。请在 Telegram 中完成这些步骤，然后重新检查。'),
('ALERTS_CONNECT_STILL_WAITING','ar','لم يتم الاتصال بعد. أكمل الخطوات في تيليجرام ثم تحقق مرة أخرى.'),
('ALERTS_CONNECT_STILL_WAITING','ru','Пока не подключено. Завершите шаги в Telegram и проверьте снова.'),
('ALERTS_CONNECT_CHECK_AGAIN','ko','다시 확인'),
('ALERTS_CONNECT_CHECK_AGAIN','zh','重新检查'),
('ALERTS_CONNECT_CHECK_AGAIN','ar','تحقق مرة أخرى'),
('ALERTS_CONNECT_CHECK_AGAIN','ru','Проверить снова'),
('ALERTS_CONNECT_PREPARING','ko','링크를 준비하는 중…'),
('ALERTS_CONNECT_PREPARING','zh','正在准备您的链接…'),
('ALERTS_CONNECT_PREPARING','ar','جارٍ تجهيز الرابط…'),
('ALERTS_CONNECT_PREPARING','ru','Готовим вашу ссылку…'),
('ALERTS_CONNECT_FAILED','ko','연결을 시작할 수 없습니다. 잠시 후 다시 시도해 주세요.'),
('ALERTS_CONNECT_FAILED','zh','无法开始连接。请稍后再试。'),
('ALERTS_CONNECT_FAILED','ar','تعذّر بدء الاتصال. يرجى المحاولة مرة أخرى بعد قليل.'),
('ALERTS_CONNECT_FAILED','ru','Не удалось начать подключение. Попробуйте ещё раз через момент.'),
('ALERTS_CONNECT_MANUAL_FALLBACK','ko','해당 버튼이 작동하지 않으면 직접 연결하세요:'),
('ALERTS_CONNECT_MANUAL_FALLBACK','zh','如果该按钮无效，请手动连接：'),
('ALERTS_CONNECT_MANUAL_FALLBACK','ar','إذا لم يعمل ذلك الزر، فاتصل يدويًا:'),
('ALERTS_CONNECT_MANUAL_FALLBACK','ru','Если кнопка не работает, подключитесь вручную:'),
('ALERTS_CONNECT_DEEP_LINK_HINT','ko','봇과의 대화창이 열립니다. 거기서 시작을 누르면 연결됩니다.'),
('ALERTS_CONNECT_DEEP_LINK_HINT','zh','这会打开您与机器人的聊天。在那里按“开始”即可完成连接。'),
('ALERTS_CONNECT_DEEP_LINK_HINT','ar','يفتح هذا محادثتك مع البوت. اضغط ابدأ هناك ليتم الاتصال.'),
('ALERTS_CONNECT_DEEP_LINK_HINT','ru','Откроется чат с ботом. Нажмите «Старт» — и вы подключены.'),
('ALERTS_CONNECT_SECURITY_NOTE','ko','이 코드는 해당 텔레그램 대화가 본인의 것임을 증명합니다. 한 번만, 그리고 본인 계정에만 사용할 수 있습니다.'),
('ALERTS_CONNECT_SECURITY_NOTE','zh','该代码用于证明这个 Telegram 聊天属于您。它只能使用一次，且仅对您的账户有效。'),
('ALERTS_CONNECT_SECURITY_NOTE','ar','يثبت الرمز أن محادثة تيليجرام تخصّك. يعمل مرة واحدة فقط، ولحسابك وحده.'),
('ALERTS_CONNECT_SECURITY_NOTE','ru','Код подтверждает, что чат в Telegram принадлежит вам. Он действует один раз и только для вашего аккаунта.'),
('ALERTS_CONNECT_WEBHOOK_WARNING','ko','현재 봇이 정상적으로 응답하지 않아 시작을 눌러도 답이 없을 수 있습니다. 몇 분 후에 다시 시도해 주세요.'),
('ALERTS_CONNECT_WEBHOOK_WARNING','zh','机器人目前响应不正常，您按“开始”时它可能不会回复。请几分钟后再试。'),
('ALERTS_CONNECT_WEBHOOK_WARNING','ar','البوت لا يستجيب بشكل صحيح حاليًا، لذا قد لا يردّ عند ضغطك على ابدأ. حاول مرة أخرى بعد بضع دقائق.'),
('ALERTS_CONNECT_WEBHOOK_WARNING','ru','Бот сейчас отвечает некорректно, поэтому может не ответить на «Старт». Попробуйте через несколько минут.'),
('ALERTS_CONNECTED_DESC','ko','텔레그램 계정이 연결되었습니다. 알림은 텔레그램 대화로 전송됩니다.'),
('ALERTS_CONNECTED_DESC','zh','您的 Telegram 账户已连接。提醒将发送到您的 Telegram 聊天中。'),
('ALERTS_CONNECTED_DESC','ar','تم ربط حساب تيليجرام الخاص بك. تصلك التنبيهات في محادثة تيليجرام.'),
('ALERTS_CONNECTED_DESC','ru','Ваш аккаунт Telegram подключён. Оповещения приходят в чат Telegram.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same rows against lhq_dev_labels (already applied live).
