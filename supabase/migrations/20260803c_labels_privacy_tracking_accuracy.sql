-- Corrects the Privacy Policy to match what the code actually does.
--
-- The Cookies and Tracking section claimed we use "session cookies necessary
-- for authentication and platform functionality" and do not use third-party
-- tracking. components/PostHogProvider.tsx initialises PostHog on mount for
-- every visitor with persistence: 'localStorage+cookie' (its own third-party
-- cookie, not an auth cookie) AND session_recording enabled - session replay
-- of the user's interactions, which the policy did not mention anywhere.
--
-- An inaccurate privacy policy is worse than a vague one: it is an affirmative
-- misstatement that anyone can disprove by opening devtools. Three sections
-- corrected so the published policy matches observable behaviour:
--
--   INFO_COLLECTED - now names session recordings alongside usage data,
--     rather than implying collection stops at "pages visited".
--   THIRD_PARTY    - PostHog was missing from the integrations list entirely.
--   COOKIES        - now discloses the PostHog cookie, the local-storage
--     identifier, what recordings capture, and what is masked (form inputs
--     plus the Trade Journal selectors in PostHogProvider's maskTextSelector).
--
-- Deliberately NOT claimed here: any consent mechanism. There is still no
-- cookie banner or opt-out - analytics and replay start on mount. That gap is
-- real and unaddressed (relevant to EU/UK ePrivacy and to RA 10173 at home);
-- this migration only stops the policy from describing a stricter posture than
-- the code implements.
--
-- PRIVACY_LAST_UPDATED bumped July -> August 2026: PRIVACY_SECTION_CHANGES_BODY
-- promises the date at the top of the page moves whenever the policy changes.
--
-- English-only, matching current convention while i18n translation is paused
-- (see pendings/PENDING.md). app/api/labels/route.ts merges English as the
-- base layer for every locale, so no locale renders a raw KEY_NAME.

insert into lhq_labels (key, locale, value) values
('PRIVACY_SECTION_COOKIES_BODY','en','We use session cookies necessary for authentication and platform functionality. We also use PostHog, a third-party product-analytics service, which sets its own cookie and stores an identifier in your browser local storage in order to recognise returning sessions. PostHog captures usage events and session recordings - a replay of your interactions with the Platform, including pages viewed, clicks, and navigation. Recordings mask all form inputs, and mask the contents of Trade Journal notes, thesis text, and profit-and-loss figures, so those values are not captured. We do not use advertising cookies and do not track you across other websites. You may disable cookies in your browser, but doing so will prevent you from logging in.'),
('PRIVACY_SECTION_THIRD_PARTY_BODY','en','LiquidityHQ integrates with third-party services including Supabase (database), PostHog (product analytics and session recording), xAI Grok (AI analysis), Binance, Bybit, Finnhub, and Alternative.me (market data). These providers have their own privacy policies and data practices. We are not responsible for their data handling.'),
('PRIVACY_SECTION_INFO_COLLECTED_BODY','en','We collect information you provide directly: email address and password when creating an account, and any preferences or settings you configure within the Platform. We also automatically collect usage data - pages visited, features used, session duration - and session recordings that replay your interactions with the Platform, in order to improve the service. See the Cookies and Tracking section below for what recordings capture and what is masked.'),
('PRIVACY_LAST_UPDATED','en','Last updated: August 2026')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV:
-- insert into lhq_dev_labels (key, locale, value) values (... same rows ...)
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
