-- NOT YET APPLIED TO ANY DATABASE.
-- Short mute from a Telegram alert (#1651 Telegram checklist, #2560 open list): OI spike, CVD divergence and rapid-move alerts carry "Mute 1 h" / "Mute 4 h"
-- buttons; a tap mutes that alert type for that user until the time stored here.
--
-- alert_type_mutes   jsonb, { "<ruleKey>": "<ISO time until>" }, ruleKey one of oi_spike / cvd / rapid_move (lib/alertTypeMute.ts). null = nothing muted.
--                    Nullable with no default: old rows stay null, which is exactly "nothing muted". ADDITIVE.
--
-- SERVER ONLY, SO NO GRANT: written by the Telegram webhook and read by the alert cron, both with the service role. 20261021e revoked table-wide
-- insert/update on lhq_user_settings from authenticated and re-granted an allowlist of columns; this column is deliberately left off it, so the browser
-- can read it (select *) but never write it.
--
-- ORDER: APPLY BEFORE THE DEPLOY THAT USES IT. Without the column: a tap on the buttons answers "Could not mute. Try again." and saves nothing; the alert
-- cron reads no type mutes and logs that, and every other alert goes on as before (that read fails open on purpose); /alerts shows no "Muted from
-- Telegram" line. Nothing else breaks.
--
-- Run ONE block per project (per 20260912b): prod block on prod qdpwhnvmhqgzijuwopso, the commented dev block on dev wdtjhrilakoitfcezxpx (qa and staging use it).
--
-- Roll back: alter table lhq_user_settings drop column alert_type_mutes;

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
alter table lhq_user_settings add column if not exists alert_type_mutes jsonb;
comment on column lhq_user_settings.alert_type_mutes is 'Alert types muted from a Telegram button, { ruleKey: ISO time until }; server-only.';

-- ── dev: wdtjhrilakoitfcezxpx (apply separately) ────────────────────────────
-- alter table lhq_dev_user_settings add column if not exists alert_type_mutes jsonb;
-- comment on column lhq_dev_user_settings.alert_type_mutes is 'Alert types muted from a Telegram button, { ruleKey: ISO time until }; server-only.';
