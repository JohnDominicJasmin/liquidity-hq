'use client';
import { useState } from 'react';
import { getAuthToken } from '@/lib/supabase';
import { useLabels } from '@/lib/labels';

/* "Send test alert" on /alerts, shown only once Telegram is connected. POSTs app/api/telegram/test-alert, which sends one short message to
   the caller's own chat (3 per 10 minutes). Shows sent / failed / limit reached. */
export default function TelegramTestAlertButton() {
  const { t } = useLabels();
  const [state, setState] = useState<'idle' | 'sending' | 'sent' | 'failed' | 'limited'>('idle');

  const send = async () => {
    setState('sending');
    try {
      const token = await getAuthToken();
      const res = await fetch('/api/telegram/test-alert', {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      const d = await res.json().catch(() => null) as { ok?: boolean; sent?: boolean } | null;
      if (res.ok && d?.ok && d.sent) setState('sent');
      else setState(res.status === 429 ? 'limited' : 'failed');
    } catch {
      setState('failed');
    }
  };

  const label = state === 'sending' ? t('ALERTS_TEST_SENDING')
    : state === 'sent' ? t('ALERTS_TEST_ALERT_SENT')
    : state === 'failed' ? t('ALERTS_TEST_ALERT_FAILED')
    : t('ALERTS_SEND_TEST_ALERT_BUTTON');

  return (
    <>
      <button
        className={`tg-action-btn tg-btn-secondary${state === 'sent' ? ' tg-btn-ok' : state === 'failed' || state === 'limited' ? ' tg-btn-err' : ''}`}
        onClick={send}
        disabled={state === 'sending'}
      >
        {label}
      </button>
      {state === 'limited' && (
        <div role="status" style={{ flexBasis: '100%', fontSize: 'var(--fs-caption)', color: 'var(--red)' }}>{t('ALERTS_TEST_ALERT_LIMIT')}</div>
      )}
    </>
  );
}
