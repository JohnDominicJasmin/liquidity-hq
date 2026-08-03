-- Sign-in-wrap consent notice on /login (app/login/page.tsx).
--
-- Why this exists: PlatformFooter returns null on '/' and '/login', so /login
-- was the only page in the app that showed no terms, no disclaimer and no
-- legal links at all - and it is the page where the account, and with it the
-- agreement, is actually created. Every other surface (app pages, landing,
-- onboarding, /terms) already carried the disclaimer; the one moment of
-- contract formation did not.
--
-- English-only, matching the current convention for new keys while i18n
-- translation is paused (see pendings/PENDING.md). app/api/labels/route.ts
-- merges English as the base layer for every locale, so ko/zh/ar/ru/tr/etc
-- resolve to these values rather than showing a raw KEY_NAME - which would be
-- an especially bad failure mode for a consent notice.

insert into lhq_labels (key, locale, value) values
('LOGIN_LEGAL_CONSENT','en','By creating an account or signing in, you agree to:'),
('LOGIN_LEGAL_TERMS','en','Terms of Use'),
('LOGIN_LEGAL_PRIVACY','en','Privacy Policy'),
('LOGIN_LEGAL_DISCLAIMER','en','Disclaimer')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV:
-- insert into lhq_dev_labels (key, locale, value) values (... same rows ...)
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
