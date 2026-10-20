-- #1606 (owner, 2026-10-21): the Whop checkout is embedded on /upgrade, with the account email filled and locked, and a four-line explanation of that email above it
-- (copy approved by the owner). SEVEN NEW keys, five locales: UPGRADE_WHOP_EMAIL_SENTENCE ({email} = the account's address; the owner's one-sentence wording, 2026-10-20, replaces the four
-- separate lines of the first version), UPGRADE_WHOP_FINAL_NOTE, UPGRADE_WHOP_EMBED_LOADING, UPGRADE_WHOP_EMBED_FALLBACK, UPGRADE_RETURN_PENDING,
-- UPGRADE_RETURN_FAILED, UPGRADE_RETURN_CANCELED. New keys, so no live label row is overwritten.
--
-- The English text is the default in lib/labelDefaults.en.json; ar/ko/ru/zh are machine-translated by Dev and NOT native-reviewed. "Whop" and "Pro" stay in Latin
-- script. Copy says only what exists today: the return line says the payment arrived and that Pro follows (the webhook unlocks it), never that Pro is on.
--
-- Until these rows exist the page shows the English default in every locale (the build-time fallback), which is correct, just not translated.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out (apply one section at a time, to dev only when QA says no test pass is
-- running). Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('UPGRADE_WHOP_EMAIL_SENTENCE','en','You''ll pay as {email}: Pro unlocks automatically, and Whop uses this email for receipts and to manage or cancel your plan.'),
('UPGRADE_WHOP_EMAIL_SENTENCE','ar','ستدفع باسم {email}: يتم تفعيل Pro تلقائيًا، وتستخدم Whop هذا البريد للإيصالات ولإدارة خطتك أو إلغائها.'),
('UPGRADE_WHOP_EMAIL_SENTENCE','ko','{email}(으)로 결제됩니다: Pro가 자동으로 활성화되며, Whop은 이 이메일로 영수증을 보내고 플랜을 관리하거나 취소할 때 사용합니다.'),
('UPGRADE_WHOP_EMAIL_SENTENCE','ru','Вы оплачиваете как {email}: Pro включится автоматически, а Whop использует эту почту для квитанций и для управления тарифом или его отмены.'),
('UPGRADE_WHOP_EMAIL_SENTENCE','zh','您将以 {email} 付款：Pro 会自动开通，Whop 使用此邮箱发送收据，并用于管理或取消您的方案。'),
('UPGRADE_WHOP_FINAL_NOTE','en','All sales are final.'),
('UPGRADE_WHOP_FINAL_NOTE','ar','جميع المبيعات نهائية.'),
('UPGRADE_WHOP_FINAL_NOTE','ko','모든 판매는 최종입니다.'),
('UPGRADE_WHOP_FINAL_NOTE','ru','Все продажи окончательные.'),
('UPGRADE_WHOP_FINAL_NOTE','zh','所有销售均为最终交易。'),
('UPGRADE_WHOP_EMBED_LOADING','en','Loading checkout…'),
('UPGRADE_WHOP_EMBED_LOADING','ar','جارٍ تحميل صفحة الدفع…'),
('UPGRADE_WHOP_EMBED_LOADING','ko','결제 화면을 불러오는 중…'),
('UPGRADE_WHOP_EMBED_LOADING','ru','Загрузка оплаты…'),
('UPGRADE_WHOP_EMBED_LOADING','zh','正在加载结账…'),
('UPGRADE_WHOP_EMBED_FALLBACK','en','Checkout could not load here. Continue on Whop instead:'),
('UPGRADE_WHOP_EMBED_FALLBACK','ar','تعذّر تحميل صفحة الدفع هنا. تابع على Whop بدلًا من ذلك:'),
('UPGRADE_WHOP_EMBED_FALLBACK','ko','여기서는 결제 화면을 불러올 수 없습니다. 대신 Whop에서 계속하세요:'),
('UPGRADE_WHOP_EMBED_FALLBACK','ru','Не удалось загрузить оплату здесь. Продолжите на Whop:'),
('UPGRADE_WHOP_EMBED_FALLBACK','zh','此处无法加载结账。请改为在 Whop 上继续：'),
('UPGRADE_RETURN_PENDING','en','Payment received. Pro unlocks within a minute.'),
('UPGRADE_RETURN_PENDING','ar','تم استلام الدفع. يتم تفعيل Pro خلال دقيقة.'),
('UPGRADE_RETURN_PENDING','ko','결제가 확인되었습니다. 1분 안에 Pro가 활성화됩니다.'),
('UPGRADE_RETURN_PENDING','ru','Платёж получен. Pro включится в течение минуты.'),
('UPGRADE_RETURN_PENDING','zh','已收到付款。Pro 将在一分钟内开通。'),
('UPGRADE_RETURN_FAILED','en','That payment did not go through. Pick a plan to try again.'),
('UPGRADE_RETURN_FAILED','ar','لم تتم عملية الدفع. اختر خطة للمحاولة مرة أخرى.'),
('UPGRADE_RETURN_FAILED','ko','결제가 완료되지 않았습니다. 플랜을 선택해 다시 시도하세요.'),
('UPGRADE_RETURN_FAILED','ru','Платёж не прошёл. Выберите тариф и попробуйте снова.'),
('UPGRADE_RETURN_FAILED','zh','该笔付款未成功。请选择方案后重试。'),
('UPGRADE_RETURN_CANCELED','en','Checkout was canceled. Pick a plan to try again.'),
('UPGRADE_RETURN_CANCELED','ar','تم إلغاء عملية الدفع. اختر خطة للمحاولة مرة أخرى.'),
('UPGRADE_RETURN_CANCELED','ko','결제가 취소되었습니다. 플랜을 선택해 다시 시도하세요.'),
('UPGRADE_RETURN_CANCELED','ru','Оплата отменена. Выберите тариф и попробуйте снова.'),
('UPGRADE_RETURN_CANCELED','zh','结账已取消。请选择方案后重试。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('UPGRADE_WHOP_EMAIL_SENTENCE','en','You''ll pay as {email}: Pro unlocks automatically, and Whop uses this email for receipts and to manage or cancel your plan.'),
-- ('UPGRADE_WHOP_EMAIL_SENTENCE','ar','ستدفع باسم {email}: يتم تفعيل Pro تلقائيًا، وتستخدم Whop هذا البريد للإيصالات ولإدارة خطتك أو إلغائها.'),
-- ('UPGRADE_WHOP_EMAIL_SENTENCE','ko','{email}(으)로 결제됩니다: Pro가 자동으로 활성화되며, Whop은 이 이메일로 영수증을 보내고 플랜을 관리하거나 취소할 때 사용합니다.'),
-- ('UPGRADE_WHOP_EMAIL_SENTENCE','ru','Вы оплачиваете как {email}: Pro включится автоматически, а Whop использует эту почту для квитанций и для управления тарифом или его отмены.'),
-- ('UPGRADE_WHOP_EMAIL_SENTENCE','zh','您将以 {email} 付款：Pro 会自动开通，Whop 使用此邮箱发送收据，并用于管理或取消您的方案。'),
-- ('UPGRADE_WHOP_FINAL_NOTE','en','All sales are final.'),
-- ('UPGRADE_WHOP_FINAL_NOTE','ar','جميع المبيعات نهائية.'),
-- ('UPGRADE_WHOP_FINAL_NOTE','ko','모든 판매는 최종입니다.'),
-- ('UPGRADE_WHOP_FINAL_NOTE','ru','Все продажи окончательные.'),
-- ('UPGRADE_WHOP_FINAL_NOTE','zh','所有销售均为最终交易。'),
-- ('UPGRADE_WHOP_EMBED_LOADING','en','Loading checkout…'),
-- ('UPGRADE_WHOP_EMBED_LOADING','ar','جارٍ تحميل صفحة الدفع…'),
-- ('UPGRADE_WHOP_EMBED_LOADING','ko','결제 화면을 불러오는 중…'),
-- ('UPGRADE_WHOP_EMBED_LOADING','ru','Загрузка оплаты…'),
-- ('UPGRADE_WHOP_EMBED_LOADING','zh','正在加载结账…'),
-- ('UPGRADE_WHOP_EMBED_FALLBACK','en','Checkout could not load here. Continue on Whop instead:'),
-- ('UPGRADE_WHOP_EMBED_FALLBACK','ar','تعذّر تحميل صفحة الدفع هنا. تابع على Whop بدلًا من ذلك:'),
-- ('UPGRADE_WHOP_EMBED_FALLBACK','ko','여기서는 결제 화면을 불러올 수 없습니다. 대신 Whop에서 계속하세요:'),
-- ('UPGRADE_WHOP_EMBED_FALLBACK','ru','Не удалось загрузить оплату здесь. Продолжите на Whop:'),
-- ('UPGRADE_WHOP_EMBED_FALLBACK','zh','此处无法加载结账。请改为在 Whop 上继续：'),
-- ('UPGRADE_RETURN_PENDING','en','Payment received. Pro unlocks within a minute.'),
-- ('UPGRADE_RETURN_PENDING','ar','تم استلام الدفع. يتم تفعيل Pro خلال دقيقة.'),
-- ('UPGRADE_RETURN_PENDING','ko','결제가 확인되었습니다. 1분 안에 Pro가 활성화됩니다.'),
-- ('UPGRADE_RETURN_PENDING','ru','Платёж получен. Pro включится в течение минуты.'),
-- ('UPGRADE_RETURN_PENDING','zh','已收到付款。Pro 将在一分钟内开通。'),
-- ('UPGRADE_RETURN_FAILED','en','That payment did not go through. Pick a plan to try again.'),
-- ('UPGRADE_RETURN_FAILED','ar','لم تتم عملية الدفع. اختر خطة للمحاولة مرة أخرى.'),
-- ('UPGRADE_RETURN_FAILED','ko','결제가 완료되지 않았습니다. 플랜을 선택해 다시 시도하세요.'),
-- ('UPGRADE_RETURN_FAILED','ru','Платёж не прошёл. Выберите тариф и попробуйте снова.'),
-- ('UPGRADE_RETURN_FAILED','zh','该笔付款未成功。请选择方案后重试。'),
-- ('UPGRADE_RETURN_CANCELED','en','Checkout was canceled. Pick a plan to try again.'),
-- ('UPGRADE_RETURN_CANCELED','ar','تم إلغاء عملية الدفع. اختر خطة للمحاولة مرة أخرى.'),
-- ('UPGRADE_RETURN_CANCELED','ko','결제가 취소되었습니다. 플랜을 선택해 다시 시도하세요.'),
-- ('UPGRADE_RETURN_CANCELED','ru','Оплата отменена. Выберите тариф и попробуйте снова.'),
-- ('UPGRADE_RETURN_CANCELED','zh','结账已取消。请选择方案后重试。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
