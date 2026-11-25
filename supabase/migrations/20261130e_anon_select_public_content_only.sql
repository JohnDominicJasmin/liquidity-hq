-- The browser's public key reads public content and nothing else (#1632, PM decision 2026-11-25).
--
-- NOT YET APPLIED TO ANY DATABASE. Run ONE block per project: the prod block on prod (qdpwhnvmhqgzijuwopso), the dev block on dev (wdtjhrilakoitfcezxpx). Dev first.
-- ORDER: after the deploy of the same release (the /live-tracking page treats "not allowed" as an empty list from that release on).
--
-- KEEPS anon SELECT (public content): labels, news, econ_snapshot, market_snapshot, liq_events (public market liquidations; the feed reads it signed out).
-- LOSES anon SELECT: every table below. None is read by a signed-out browser, except live_signals on /live-tracking, where row level security already returned no rows.
-- Measured on dev 2026-11-25 with the public key: each table below answered 200 (the grant exists) with 0 visible rows (row level security), so no visible data changes.
-- Already refused to anon there (42501), not repeated: admin_audit_log, admin_users, api_health, boomfi_webhook_events, disposable_email_domains, ls_webhook_events,
-- push_subscriptions, rate_limits, telegram_link_codes, whop_webhook_events, signup_ip_log.
--
-- `authenticated` and the service role are NOT touched. Idempotent: revoking a privilege that is not held is a no-op. Data is not touched.
--
-- BEFORE AND AFTER, signed-in grants must be identical:
--   select table_name, string_agg(privilege_type, ',' order by privilege_type) from information_schema.role_table_grants
--    where table_schema='public' and grantee='authenticated' and table_name like 'lhq_%' group by 1 order by 1;
-- READ BACK (expected on each project: only the five public-content tables, plus any table added after this file):
--   select table_name from information_schema.role_table_grants where table_schema='public' and grantee='anon' and privilege_type='SELECT' and table_name like 'lhq_%' order by 1;
-- Roll back: grant select on public.<table> to anon;

-- ── prod: qdpwhnvmhqgzijuwopso ──────────────────────────────────────────────
revoke select on public.lhq_ai_call_log from anon;
revoke select on public.lhq_alert_fires from anon;
revoke select on public.lhq_alert_grok_log from anon;
revoke select on public.lhq_app_config from anon;
revoke select on public.lhq_clusters from anon;
revoke select on public.lhq_global_ai_usage from anon;
revoke select on public.lhq_grok_usage from anon;
revoke select on public.lhq_hypotheses from anon;
revoke select on public.lhq_hypothesis_evidence from anon;
revoke select on public.lhq_live_signals from anon;
revoke select on public.lhq_muted_alerts from anon;
revoke select on public.lhq_price_alerts from anon;
revoke select on public.lhq_signals from anon;
revoke select on public.lhq_trades from anon;
revoke select on public.lhq_trial_claims from anon;
revoke select on public.lhq_user_onboarding from anon;
revoke select on public.lhq_user_settings from anon;
revoke select on public.lhq_user_status from anon;
revoke select on public.lhq_user_subscriptions from anon;

-- ── dev: wdtjhrilakoitfcezxpx ───────────────────────────────────────────────
revoke select on public.lhq_dev_ai_call_log from anon;
revoke select on public.lhq_dev_alert_fires from anon;
revoke select on public.lhq_dev_alert_grok_log from anon;
revoke select on public.lhq_dev_app_config from anon;
revoke select on public.lhq_dev_clusters from anon;
revoke select on public.lhq_dev_global_ai_usage from anon;
revoke select on public.lhq_dev_grok_usage from anon;
revoke select on public.lhq_dev_hypotheses from anon;
revoke select on public.lhq_dev_hypothesis_evidence from anon;
revoke select on public.lhq_dev_live_signals from anon;
revoke select on public.lhq_dev_muted_alerts from anon;
revoke select on public.lhq_dev_price_alerts from anon;
revoke select on public.lhq_dev_signals from anon;
revoke select on public.lhq_dev_trades from anon;
revoke select on public.lhq_dev_trial_claims from anon;
revoke select on public.lhq_dev_user_onboarding from anon;
revoke select on public.lhq_dev_user_settings from anon;
revoke select on public.lhq_dev_user_status from anon;
revoke select on public.lhq_dev_user_subscriptions from anon;
