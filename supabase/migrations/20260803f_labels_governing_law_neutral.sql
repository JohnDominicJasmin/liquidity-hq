-- Governing law: keep it country-neutral, but stop it being circular.
--
-- The previous text defined nothing - "governed by ... applicable law" and
-- "the exclusive jurisdiction of the competent courts in the applicable
-- jurisdiction" is a placeholder wearing a clause's clothing.
--
-- Deliberately still names no country, by decision: the audience is worldwide,
-- not Philippines-only. Instead it points at the jurisdiction LiquidityHQ is
-- operated from, which the Privacy Policy already discloses
-- (PRIVACY_SECTION_INTERNATIONAL_USERS_BODY), so the two documents agree
-- without this one hardcoding a country name.
--
-- Adds an explicit carve-out for mandatory local consumer-protection rights.
-- That is not a giveaway: for EU/UK consumers those rights cannot be
-- contracted away no matter what this clause says, so claiming otherwise would
-- make the clause less credible, not more protective.
--
-- Standing caveat, unchanged: a named jurisdiction is what most global SaaS
-- terms use, because it fixes the forum instead of leaving it arguable. This
-- wording is the best country-neutral version, not a substitute for a lawyer
-- deciding whether to name one before payments go live.

insert into lhq_labels (key, locale, value) values
('TERMS_SECTION_GOVERNING_LAW_BODY','en','These Terms of Use are governed by the laws of the jurisdiction in which LiquidityHQ is operated, without regard to its conflict-of-law rules, and any dispute arising out of or relating to them is subject to the courts of that jurisdiction. LiquidityHQ is available worldwide, and nothing in this section removes any mandatory consumer-protection right you have under the law of your country of residence, including any right to bring proceedings in your local courts where that law grants it.')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- DEV: same row against lhq_dev_labels (already applied live).
