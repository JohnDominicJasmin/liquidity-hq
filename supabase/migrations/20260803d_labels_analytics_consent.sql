-- Labels for the analytics consent gate (components/CookieConsent.tsx, the
-- AnalyticsConsentToggle in app/settings/page.tsx).
--
-- Context: PostHog previously initialised on mount for every visitor, setting
-- its own cookie and starting session replay before anyone agreed to anything.
-- It is now gated on explicit consent (lib/consent.ts) and defaults to off.
--
-- PRIVACY_SECTION_COOKIES_BODY is rewritten again here. The previous revision
-- (20260803c) corrected the policy to admit that analytics and session replay
-- happen at all; now that they only happen after consent, the policy has to say
-- that too, and say where to withdraw it - a policy that undersells the user's
-- control is as inaccurate as one that oversells our restraint.
--
-- Accept/Decline are deliberately equal-weight in the UI, so the copy here
-- avoids nudging language for the same reason.
--
-- English-only, matching current convention while i18n translation is paused
-- (see pendings/PENDING.md). app/api/labels/route.ts merges English as the
-- base layer for every locale, so no locale renders a raw KEY_NAME - which
-- would be a particularly bad outcome for a consent prompt.

insert into lhq_labels (key, locale, value) values
('CONSENT_BODY','en','We use analytics cookies and session recordings to understand how the app is used. These do not run unless you accept. Cookies needed to sign you in are always on.'),
('CONSENT_ACCEPT','en','Accept'),
('CONSENT_DECLINE','en','Decline'),
('CONSENT_PRIVACY_LINK','en','Privacy Policy'),
('CONSENT_ARIA_LABEL','en','Cookie and analytics consent'),
('SETTINGS_ANALYTICS_TITLE','en','Analytics and session recording'),
('SETTINGS_ANALYTICS_DESC','en','When on, we collect anonymous usage events and session recordings to improve the app. Form inputs and your Trade Journal notes, thesis, and profit-and-loss figures are always masked. Turning this off stops collection immediately.'),
('SETTINGS_ANALYTICS_ON','en','On'),
('SETTINGS_ANALYTICS_OFF','en','Off'),
('PRIVACY_SECTION_COOKIES_BODY','en','We use session cookies necessary for authentication and platform functionality; these are always active because you cannot sign in without them. We also use PostHog, a third-party product-analytics service, which sets its own cookie and stores an identifier in your browser local storage in order to recognise returning sessions. PostHog captures usage events and session recordings - a replay of your interactions with the Platform, including pages viewed, clicks, and navigation. Analytics and session recording do not run unless you accept them when first asked, and you can turn them back off at any time under Settings, which stops collection immediately. Recordings mask all form inputs, and mask the contents of Trade Journal notes, thesis text, and profit-and-loss figures, so those values are not captured. We do not use advertising cookies and do not track you across other websites.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV:
-- insert into lhq_dev_labels (key, locale, value) values (... same rows ...)
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
