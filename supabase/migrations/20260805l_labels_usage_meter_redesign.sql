-- Redesign of the Arena UsageMeter (components/UsageMeter.tsx): drops the
-- "X left" countdown framing + live ticking reset-countdown, which the
-- component's own prior comment admitted was a deliberate scarcity/urgency
-- conversion tactic ("Visible scarcity converts far better than a
-- silently-disabled button (freemium plan, move #3)") - it read as "burn
-- through it before it resets," not a neutral usage tracker. New copy is
-- "{used}/{limit}" (no verbal framing at all, a thin fill bar carries the
-- ambient signal) + a static local clock-time fact instead of a countdown.
--
-- USAGE_METER_LEFT_SUFFIX and USAGE_METER_RESETS_IN are no longer
-- referenced anywhere (removed from lib/labelKeys.ts too) - leaving their
-- old rows in place, harmless stale data, same pattern as prior key
-- removals in this project.
--
-- English-only for now - ko/zh/ar/ru will fall back to English for this one
-- key via the labels API's merge behavior until translated (i18n paused
-- project-wide, PENDING.md).
-- Applied live against both lhq_labels (prod, qdpwhnvmhqgzijuwopso) and
-- lhq_dev_labels (dev, wdtjhrilakoitfcezxpx) via execute_sql.

insert into lhq_labels (key, locale, value) values
('USAGE_METER_RESET_FACT','en','Resets {time}')
on conflict (key, locale) do update set value = excluded.value, updated_at = now();

-- Same row, run against lhq_dev_labels on wdtjhrilakoitfcezxpx (already applied).
