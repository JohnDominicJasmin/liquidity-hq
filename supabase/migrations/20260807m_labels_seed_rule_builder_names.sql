-- Accessible names for the three rule-builder selects in TradeJournal
-- (/journal -> Rules -> "+ Custom Rule"). Issue #48.
--
-- Those selects are a sentence-shaped row - [field] [operator] [value] - with no
-- visible label of any kind: no class, no id, no <label>. A screen reader
-- announced each one as "combo box" with nothing else, and voice control had no
-- phrase to match, so they could not be operated by voice at all.
-- WCAG 2.2 SC 4.1.2 Name, Role, Value, Level A.
--
-- aria-label is the right tool HERE specifically because there is no visible
-- label to override. Where visible text already exists (the inline-edit fields
-- fixed in the same commit) the fix is id/htmlFor, never aria-label - adding
-- aria-label alongside a real association overrides the visible text and breaks
-- voice control, which is the docs/HANDOVER.md section 14 defect.
--
-- Additive only: three INSERTs, no schema change, no drop, safe to re-run.
--
-- Run in the Supabase SQL Editor against BOTH prefixed tables
-- (lhq_labels for prod, lhq_dev_labels for dev + qa, which share one project).
--
-- NOT deploy-order critical, deliberately. t() falls back to the key itself when
-- a row is missing, which would make a screen reader read
-- "TRADE_JOURNAL_RULES_FIELD_ARIA" aloud - so components/TradeJournal.tsx wraps
-- these in a helper that substitutes readable English when the lookup returns
-- the key unchanged. Applying this migration late degrades to English rather
-- than to gibberish.

insert into lhq_labels (key, locale, value) values
('TRADE_JOURNAL_RULES_FIELD_ARIA','en','Rule field'),
('TRADE_JOURNAL_RULES_OPERATOR_ARIA','en','Rule condition'),
('TRADE_JOURNAL_RULES_VALUE_ARIA','en','Rule value')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();
