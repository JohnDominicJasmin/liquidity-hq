'use client';
import { useEffect, useState } from 'react';
import { useLabels } from '@/lib/labels';
import { useGraceElapsed } from '@/lib/useGrace';

/* The sign-in button stays disabled until the security check hands back a token. If its script is blocked or never loads, that is a button
   disabled for ever with no reason (OWNER-RULES 21), so this says what is wrong and what to do.

   IT SPEAKS ONLY WHEN THE CHECK REALLY FAILED. Before, it showed after 6 s without a token even when the Cloudflare widget HAD rendered and was just waiting for the visitor (an interactive
   challenge, a slow solve), a red error on a page that was working. Now it shows when (a) the widget reported an error (`errored`), or (b) 6 s passed and no widget iframe exists inside
   the widget's container (`widgetId`: the script was blocked or never loaded). A visible widget that is simply waiting gets no red text. */
export default function CaptchaStuckHint({ waiting, widgetId, errored = false }: { waiting: boolean; widgetId: string; errored?: boolean }) {
  const { t } = useLabels();
  const over = useGraceElapsed(6_000);
  const [hasFrame, setHasFrame] = useState(false);
  useEffect(() => {
    if (!waiting) return;
    const check = () => setHasFrame(!!document.getElementById(widgetId)?.querySelector('iframe'));
    check();
    const id = setInterval(check, 1_000);
    return () => clearInterval(id);
  }, [waiting, widgetId]);
  const failed = waiting && (errored || (over && !hasFrame));
  return (
    <div role="status" data-testid="captcha-stuck-hint" style={{ display: failed ? undefined : 'none', color: 'var(--red)', fontSize: 'var(--fs-caption)', marginTop: 8 }}>
      {t('LOGIN_CAPTCHA_STUCK')}
    </div>
  );
}
