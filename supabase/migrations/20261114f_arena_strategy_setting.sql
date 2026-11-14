-- The Arena strategy a trader picked (lib/strategies), saved per account like arena_sound. Nullable text: null = none. ADDITIVE; nothing is written by applying it.
-- ORDER: APPLY BEFORE the deploy that sends arena_strategy to the settings route (until then the route's update of this column errors).
-- Run ONE block per project: PROD on qdpwhnvmhqgzijuwopso, the commented DEV block on wdtjhrilakoitfcezxpx (names differ, so it must not run on prod).
-- Roll back: alter table lhq_user_settings drop column arena_strategy;

-- ── prod: qdpwhnvmhqgzijuwopso ──
alter table lhq_user_settings add column if not exists arena_strategy text;
grant insert (arena_strategy), update (arena_strategy) on public.lhq_user_settings to authenticated;

-- ── dev: wdtjhrilakoitfcezxpx ──
-- alter table lhq_dev_user_settings add column if not exists arena_strategy text;
-- grant insert (arena_strategy), update (arena_strategy) on public.lhq_dev_user_settings to authenticated;
