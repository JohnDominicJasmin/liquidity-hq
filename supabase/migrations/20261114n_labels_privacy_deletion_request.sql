-- NOT YET APPLIED TO ANY DATABASE. Apply ONE block per project: the PROD block on prod (qdpwhnvmhqgzijuwopso) by PM/DevOps with the release; the DEV block on dev (wdtjhrilakoitfcezxpx, shared by dev/qa/staging).
--
-- Launch-readiness item G3 (#1413): /privacy said "If you delete your account, we will remove your personal data..." but the product has no delete-account control. Reworded to
-- "If you ask us to delete your account, ..." in all five locales. This is a legal-page label: the English row is written explicitly (the page reads the DB first, so a stale English
-- row would keep the old sentence), and ko/zh/ar are the existing translations with only that clause changed; ru is a new AI-drafted row (no ru row existed). Upserts by (key, locale).
--
-- ===================== PROD (liquidity-hq, qdpwhnvmhqgzijuwopso) =====================
insert into lhq_labels (key, locale, value) values
('PRIVACY_SECTION_DATA_RETENTION_BODY','en','We retain your account data for as long as your account is active. If you ask us to delete your account, we will remove your personal data from active systems within 30 days, except where retention is required by law or for legitimate business purposes such as fraud prevention.'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','ko','당사는 계정이 활성 상태인 동안 계정 데이터를 보관합니다. 계정 삭제를 요청하시면 30일 이내에 활성 시스템에서 개인 데이터를 제거합니다. 단, 법률에 따라 보관이 요구되거나 부정 행위 방지 등 정당한 사업 목적이 있는 경우는 예외입니다.'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','zh','只要您的账户处于活跃状态,我们就会保留您的账户数据。如果您要求我们删除账户,我们将在 30 天内从活跃系统中移除您的个人数据,但法律要求保留或出于防欺诈等正当业务目的需要保留的情况除外。'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','ru','Мы храним данные вашей учётной записи, пока она активна. Если вы попросите нас удалить учётную запись, мы удалим ваши персональные данные из активных систем в течение 30 дней, за исключением случаев, когда хранение требуется по закону или необходимо для законных деловых целей, например для предотвращения мошенничества.'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','ar','نحتفظ ببيانات حسابك طالما كان حسابك نشطًا. إذا طلبت منا حذف حسابك، فسنزيل بياناتك الشخصية من الأنظمة النشطة خلال 30 يومًا، إلا في الحالات التي يقتضي فيها القانون الاحتفاظ بها أو لأغراض تجارية مشروعة مثل منع الاحتيال.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- ============ DEV (shared by dev/qa/staging, wdtjhrilakoitfcezxpx) ============
insert into lhq_dev_labels (key, locale, value) values
('PRIVACY_SECTION_DATA_RETENTION_BODY','en','We retain your account data for as long as your account is active. If you ask us to delete your account, we will remove your personal data from active systems within 30 days, except where retention is required by law or for legitimate business purposes such as fraud prevention.'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','ko','당사는 계정이 활성 상태인 동안 계정 데이터를 보관합니다. 계정 삭제를 요청하시면 30일 이내에 활성 시스템에서 개인 데이터를 제거합니다. 단, 법률에 따라 보관이 요구되거나 부정 행위 방지 등 정당한 사업 목적이 있는 경우는 예외입니다.'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','zh','只要您的账户处于活跃状态,我们就会保留您的账户数据。如果您要求我们删除账户,我们将在 30 天内从活跃系统中移除您的个人数据,但法律要求保留或出于防欺诈等正当业务目的需要保留的情况除外。'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','ru','Мы храним данные вашей учётной записи, пока она активна. Если вы попросите нас удалить учётную запись, мы удалим ваши персональные данные из активных систем в течение 30 дней, за исключением случаев, когда хранение требуется по закону или необходимо для законных деловых целей, например для предотвращения мошенничества.'),
('PRIVACY_SECTION_DATA_RETENTION_BODY','ar','نحتفظ ببيانات حسابك طالما كان حسابك نشطًا. إذا طلبت منا حذف حسابك، فسنزيل بياناتك الشخصية من الأنظمة النشطة خلال 30 يومًا، إلا في الحالات التي يقتضي فيها القانون الاحتفاظ بها أو لأغراض تجارية مشروعة مثل منع الاحتيال.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
