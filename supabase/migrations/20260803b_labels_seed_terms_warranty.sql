-- Adds a "No Warranties" section to the Terms of Use (app/terms/page.tsx).
--
-- The ToS already capped liability and required indemnification, but never
-- disclaimed warranties - so it said what is not owed when something goes
-- wrong without ever saying what was not promised in the first place. For a
-- market-data product the specific complaint to defend against is "your feed
-- lagged and I got liquidated", which the accuracy/timeliness disclaimer
-- addresses more directly than the liability cap does.
--
-- /disclaimer already covers this in substance (DISCLAIMER_SECTION_DATA_
-- PROVIDERS_BODY: "Feeds can lag, drop, or briefly disagree with the exchange
-- you actually trade on"), but that page is a notice document; the ToS is the
-- binding agreement, which is where the formal clause belongs.
--
-- TERMS_LAST_UPDATED bumped July -> August 2026: this is a material change to
-- the terms, and TERMS_SECTION_ACCEPTANCE_BODY tells users that continued use
-- after a change constitutes acceptance - which only means anything if the
-- date actually moves when the terms do.
--
-- English-only, matching current convention while i18n translation is paused
-- (see pendings/PENDING.md). app/api/labels/route.ts merges English as the
-- base layer for every locale, so no locale renders a raw KEY_NAME.

insert into lhq_labels (key, locale, value) values
('TERMS_SECTION_WARRANTY_TITLE','en','No Warranties'),
('TERMS_SECTION_WARRANTY_BODY','en','The Platform is provided "AS IS" and "AS AVAILABLE", without warranties of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, non-infringement, or accuracy. We do not warrant that the Platform will be uninterrupted, timely, secure, or error-free, or that market data, signals, scores, or AI analysis will be accurate, complete, or current. Market data may lag, drop, or disagree with the exchange you trade on. You must not rely on the Platform as your sole basis for any trading decision.'),
('TERMS_LAST_UPDATED','en','Last updated: August 2026')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV:
-- insert into lhq_dev_labels (key, locale, value) values (... same rows ...)
-- on conflict (key, locale) do update set value = excluded.value, updated_at = now();
