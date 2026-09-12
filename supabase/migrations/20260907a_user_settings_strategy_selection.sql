-- Persist Arena's per-user Strategy Panel selection and any edited calc
-- params, account-level so it survives reload / syncs across devices (#1020).
--
-- Previously plain `useState` in app/arena/page.tsx (`strategySelection`,
-- `strategyParams`) - lost on every reload with no warning given. #1020's own
-- framing: "the same shape as #1008 - a paid feature that visibly works and
-- silently doesn't hold."
--
-- Null = never saved - not "explicitly cleared" - so an existing row with
-- nulls here behaves exactly as it did before this column existed (empty
-- selection, registry defaults for every param).
--
-- strategy_selection: JSON array of indicator ids, e.g. ["SMA","PSAR"] - see
-- lib/strategyRegistry.ts for the id set. Matches app/arena/page.tsx's
-- `strategySelection` state shape exactly.
--
-- strategy_params: JSON object keyed by indicator id, each value itself an
-- object of that indicator's OVERRIDDEN calc params only, e.g.
-- {"PSAR": {"Start": 0.5}} - matches `strategyParams` state exactly. Absent
-- keys fall back to the registry default, both client-side and here; this
-- column never needs a full snapshot of every param for every indicator.
--
-- Apply to both projects when ready:
--   prod qdpwhnvmhqgzijuwopso -> lhq_user_settings
--   dev  wdtjhrilakoitfcezxpx -> lhq_dev_user_settings
-- NOT YET APPLIED to either - shared-database writes go to the owner (#1020).

alter table lhq_user_settings
  add column if not exists strategy_selection jsonb,
  add column if not exists strategy_params jsonb;

comment on column lhq_user_settings.strategy_selection is
  'Arena Strategy Panel selection - JSON array of indicator ids. Null = never saved, client defaults to an empty selection.';
comment on column lhq_user_settings.strategy_params is
  'Arena per-indicator calc-param overrides - JSON object keyed by indicator id, values are that indicator''s overridden params only. Null = never saved, registry defaults apply.';

-- dev equivalent:
-- alter table lhq_dev_user_settings
--   add column if not exists strategy_selection jsonb,
--   add column if not exists strategy_params jsonb;
-- comment on column lhq_dev_user_settings.strategy_selection is
--   'Arena Strategy Panel selection - JSON array of indicator ids. Null = never saved, client defaults to an empty selection.';
-- comment on column lhq_dev_user_settings.strategy_params is
--   'Arena per-indicator calc-param overrides - JSON object keyed by indicator id, values are that indicator''s overridden params only. Null = never saved, registry defaults apply.';
