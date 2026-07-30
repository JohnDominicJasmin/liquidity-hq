// Central table name registry - switches between lhq_ (prod) and lhq_dev_ (dev)
// based on NEXT_PUBLIC_APP_ENV. Set in Render dashboard per service.
const p = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_';

export const T = {
  signals:            `${p}signals`,
  trades:             `${p}trades`,
  clusters:           `${p}clusters`,
  price_alerts:       `${p}price_alerts`,
  grok_usage:         `${p}grok_usage`,
  global_ai_usage:    `${p}global_ai_usage`,
  liq_events:         `${p}liq_events`,
  user_settings:      `${p}user_settings`,
  muted_alerts:       `${p}muted_alerts`,
  user_onboarding:    `${p}user_onboarding`,
  user_subscriptions: `${p}user_subscriptions`,
  alert_grok_log:     `${p}alert_grok_log`,
  live_signals:       `${p}live_signals`,
  hypotheses:          `${p}hypotheses`,
  hypothesis_evidence: `${p}hypothesis_evidence`,
  push_subscriptions:  `${p}push_subscriptions`,
  alert_fires:         `${p}alert_fires`,
  admin_audit_log:     `${p}admin_audit_log`,
  admin_users:         `${p}admin_users`,
  app_config:          `${p}app_config`,
  user_status:         `${p}user_status`,
  labels:              `${p}labels`,
  telegram_link_codes: `${p}telegram_link_codes`,
  ls_webhook_events:   `${p}ls_webhook_events`,
  news:                `${p}news`,
  econ_snapshot:       `${p}econ_snapshot`,
} as const;
