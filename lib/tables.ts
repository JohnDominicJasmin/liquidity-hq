// Central table name registry — switches between lhq_ (prod) and lhq_dev_ (dev)
// based on NEXT_PUBLIC_APP_ENV. Set in Render dashboard per service.
const p = process.env.NEXT_PUBLIC_APP_ENV === 'dev' ? 'lhq_dev_' : 'lhq_';

export const T = {
  signals:            `${p}signals`,
  trades:             `${p}trades`,
  clusters:           `${p}clusters`,
  price_alerts:       `${p}price_alerts`,
  grok_usage:         `${p}grok_usage`,
  liq_events:         `${p}liq_events`,
  user_settings:      `${p}user_settings`,
  muted_alerts:       `${p}muted_alerts`,
  user_onboarding:    `${p}user_onboarding`,
  user_subscriptions: `${p}user_subscriptions`,
  alert_grok_log:     `${p}alert_grok_log`,
  live_signals:       `${p}live_signals`,
} as const;
