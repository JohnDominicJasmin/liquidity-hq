-- Owner, 2026-10-07: the support address must be visibly displayed. Measured on production the day this was written: it appeared ONLY on
-- /about; /terms and /privacy still sent the reader to "the email address listed on the About page" instead of giving it, and
-- payment-processor reviewers look for contact details on exactly those two pages.
--
-- Two keys, five locales: the Contact paragraph of the Terms and of the Privacy Policy now state the address. The Privacy
-- paragraph also loses "We take privacy inquiries seriously and will respond promptly": a response-time promise nobody has
-- committed to. (The Refund page's "We aim to respond within 2 business days" is NOT touched here; flagged to PM.)
-- The address is identical in every locale, as in 20260918b: a translated address is a broken address. The page turns it into a
-- mailto link (components/EmailLinked.tsx), so no extra key is needed. The /contact page reuses ABOUT_CONTACT_LABEL and
-- ABOUT_CONTACT_BODY, which 20260918b already put in all five locales.
--
-- ar/ko/ru/zh are MACHINE-TRANSLATED and not native-reviewed, the same standard as the rest of this audit's translation waves. The
-- ru rows for these two keys are written fresh: no migration file holds a ru value for them, and the label DB is the record, so
-- READ THE LIVE ru ROWS BEFORE APPLYING.
--
-- NOT APPLIED. Production write needs the owner's word; the dev section is commented out per 20260912b's convention (apply one
-- section at a time, to dev only when QA says no test pass is running).
-- `do update`: these rows exist and are being replaced.
--
-- Run against BOTH lhq_labels (prod, qdpwhnvmhqgzijuwopso) and lhq_dev_labels (dev, wdtjhrilakoitfcezxpx).

insert into lhq_labels (key, locale, value) values
('PRIVACY_SECTION_CONTACT_BODY','en','If you have questions about this Privacy Policy or how we handle your data, contact us at support@liquidity-hq.com.'),
('PRIVACY_SECTION_CONTACT_BODY','ar','إذا كانت لديك أسئلة حول سياسة الخصوصية هذه أو كيفية تعاملنا مع بياناتك، يُرجى التواصل معنا على support@liquidity-hq.com.'),
('PRIVACY_SECTION_CONTACT_BODY','ko','본 개인정보 처리방침이나 당사의 데이터 처리 방식에 대해 궁금한 점이 있으시면 support@liquidity-hq.com 으로 문의해 주세요.'),
('PRIVACY_SECTION_CONTACT_BODY','ru','Если у вас есть вопросы об этой Политике конфиденциальности или о том, как мы обрабатываем ваши данные, напишите нам: support@liquidity-hq.com.'),
('PRIVACY_SECTION_CONTACT_BODY','zh','如果您对本隐私政策或我们处理数据的方式有任何疑问，请联系 support@liquidity-hq.com。'),
('TERMS_SECTION_CONTACT_BODY','en','If you have questions about these Terms of Use, contact us at support@liquidity-hq.com.'),
('TERMS_SECTION_CONTACT_BODY','ar','إذا كانت لديك أسئلة حول شروط الاستخدام هذه، يرجى التواصل معنا على support@liquidity-hq.com.'),
('TERMS_SECTION_CONTACT_BODY','ko','본 이용약관에 대해 문의사항이 있으시면 support@liquidity-hq.com 으로 연락해 주세요.'),
('TERMS_SECTION_CONTACT_BODY','ru','Если у вас есть вопросы об этих Условиях использования, напишите нам: support@liquidity-hq.com.'),
('TERMS_SECTION_CONTACT_BODY','zh','如对本使用条款有任何疑问，请联系 support@liquidity-hq.com。')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: the same rows against lhq_dev_labels.
--
-- insert into lhq_dev_labels (key, locale, value) values
-- ('PRIVACY_SECTION_CONTACT_BODY','en','If you have questions about this Privacy Policy or how we handle your data, contact us at support@liquidity-hq.com.'),
-- ('PRIVACY_SECTION_CONTACT_BODY','ar','إذا كانت لديك أسئلة حول سياسة الخصوصية هذه أو كيفية تعاملنا مع بياناتك، يُرجى التواصل معنا على support@liquidity-hq.com.'),
-- ('PRIVACY_SECTION_CONTACT_BODY','ko','본 개인정보 처리방침이나 당사의 데이터 처리 방식에 대해 궁금한 점이 있으시면 support@liquidity-hq.com 으로 문의해 주세요.'),
-- ('PRIVACY_SECTION_CONTACT_BODY','ru','Если у вас есть вопросы об этой Политике конфиденциальности или о том, как мы обрабатываем ваши данные, напишите нам: support@liquidity-hq.com.'),
-- ('PRIVACY_SECTION_CONTACT_BODY','zh','如果您对本隐私政策或我们处理数据的方式有任何疑问，请联系 support@liquidity-hq.com。'),
-- ('TERMS_SECTION_CONTACT_BODY','en','If you have questions about these Terms of Use, contact us at support@liquidity-hq.com.'),
-- ('TERMS_SECTION_CONTACT_BODY','ar','إذا كانت لديك أسئلة حول شروط الاستخدام هذه، يرجى التواصل معنا على support@liquidity-hq.com.'),
-- ('TERMS_SECTION_CONTACT_BODY','ko','본 이용약관에 대해 문의사항이 있으시면 support@liquidity-hq.com 으로 연락해 주세요.'),
-- ('TERMS_SECTION_CONTACT_BODY','ru','Если у вас есть вопросы об этих Условиях использования, напишите нам: support@liquidity-hq.com.'),
-- ('TERMS_SECTION_CONTACT_BODY','zh','如对本使用条款有任何疑问，请联系 support@liquidity-hq.com。')
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
