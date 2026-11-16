'use client';
import { useLabels } from '@/lib/labels';
import { useGraceElapsed } from '@/lib/useGrace';

/* The sign-in button stays disabled until the security check hands back a token. If its script is blocked or never loads, that is a button
   disabled for ever with no reason (OWNER-RULES 21). After 6 s without a token this says what is wrong and what to do. */
export default function CaptchaStuckHint({ waiting }: { waiting: boolean }) {
  const { t } = useLabels();
  const over = useGraceElapsed(6_000);
  return (
    <div role="status" data-testid="captcha-stuck-hint" style={{ display: waiting && over ? undefined : 'none', color: 'var(--red)', fontSize: 'var(--fs-caption)', marginTop: 8 }}>
      {t('LOGIN_CAPTCHA_STUCK')}
    </div>
  );
}
