'use client';
import { useEffect, useRef, useState } from 'react';
import { getSupabase } from '@/lib/supabase';
import { useLabels } from '@/lib/labels';
import styles from './ops.module.css';

/* The second factor for the console (#1632): an authenticator app code. The server refuses every admin route until the session carries it
 * (lib/admin-auth.ts); this screen only gets the session there. An admin with no factor yet sets one up here; one who has it enters a code. */
type Step =
  | { kind: 'loading' }
  | { kind: 'failed' }
  | { kind: 'verify'; factorId: string }
  | { kind: 'enroll'; factorId: string; qr: string; secret: string };

export default function OpsSecondFactor({ onVerified, onSignOut, signingOut }: { onVerified: () => void; onSignOut: () => void; signingOut: boolean }) {
  const { t } = useLabels();
  const [step, setStep] = useState<Step>({ kind: 'loading' });
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState(false);
  // Setting up writes a new factor, so it must run once even when the effect runs twice.
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    (async () => {
      const sb = getSupabase();
      if (!sb) { setStep({ kind: 'failed' }); return; }
      try {
        const list = await sb.auth.mfa.listFactors();
        if (list.error) throw list.error;
        const ready = list.data.totp.find(f => f.status === 'verified');
        if (ready) { setStep({ kind: 'verify', factorId: ready.id }); return; }
        // A setup that was never finished blocks a new one with the same name.
        for (const f of list.data.all) {
          if (f.factor_type === 'totp' && f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
        }
        const made = await sb.auth.mfa.enroll({ factorType: 'totp' });
        if (made.error) throw made.error;
        setStep({ kind: 'enroll', factorId: made.data.id, qr: made.data.totp.qr_code, secret: made.data.totp.secret });
      } catch {
        setStep({ kind: 'failed' });
      }
    })();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy || (step.kind !== 'verify' && step.kind !== 'enroll')) return;
    const sb = getSupabase();
    if (!sb) return;
    setBusy(true);
    setWrong(false);
    try {
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId: step.factorId, code: code.trim() });
      if (error) { setWrong(true); return; }
      onVerified();
    } catch {
      setWrong(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={styles.loginWrap}>
      <form className={styles.loginCard} onSubmit={submit}>
        <div className={styles.loginTitle}>{t('OPS_LAYOUT_MFA_TITLE')}</div>
        {step.kind === 'loading' && <div className={styles.spinner} aria-hidden />}
        {step.kind === 'failed' && <div className={styles.err} role="alert">{t('OPS_LAYOUT_MFA_LOAD_FAILED')}</div>}
        {(step.kind === 'verify' || step.kind === 'enroll') && (
          <>
            <div className={styles.loginSub}>{t(step.kind === 'enroll' ? 'OPS_LAYOUT_MFA_ENROLL_HINT' : 'OPS_LAYOUT_MFA_VERIFY_HINT')}</div>
            {step.kind === 'enroll' && (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element -- a data: image made by the auth service, nothing to optimise */}
                <img src={step.qr} alt={t('OPS_LAYOUT_MFA_QR_ALT')} width={180} height={180} style={{ alignSelf: 'center', background: '#fff', padding: 8, borderRadius: 8 }} />
                <div className={styles.loginSub}>{t('OPS_LAYOUT_MFA_SECRET_LABEL')}: <code style={{ wordBreak: 'break-all' }}>{step.secret}</code></div>
              </>
            )}
            <label className={styles.loginLabel}>
              {t('OPS_LAYOUT_MFA_CODE_LABEL')}
              <input
                className={styles.loginInput}
                inputMode="numeric"
                autoComplete="one-time-code"
                pattern="[0-9]{6}"
                maxLength={6}
                value={code}
                onChange={e => setCode(e.target.value)}
                required
              />
            </label>
            {wrong && <div className={styles.err} role="alert">{t('OPS_LAYOUT_MFA_WRONG_CODE')}</div>}
            <button className={styles.loginBtn} type="submit" disabled={busy}>
              {busy ? t('OPS_LAYOUT_MFA_BUSY') : t('OPS_LAYOUT_MFA_SUBMIT')}
            </button>
          </>
        )}
        <button className={styles.pagerBtn} type="button" disabled={signingOut} onClick={onSignOut}>{t('OPS_LAYOUT_NAV_SIGN_OUT')}</button>
      </form>
    </div>
  );
}
