'use client';
import { useId, useState } from 'react';
import { useLabels } from '@/lib/labels';
import { PASSWORD_RULES, PASSWORD_MIN_LENGTH } from '@/lib/passwordPolicy';

interface Props {
  value:        string;
  onChange:     (v: string) => void;
  /* Rendered as a real <label for>, which is what names the field for screen
     readers, voice control and Chrome autofill. Deliberately NOT paired with an
     aria-label: aria-label would win over the visible text, so "click Password"
     would stop matching what the user can see. */
  label:        string;
  placeholder?: string;
  autoComplete: 'new-password' | 'current-password';
  onEnter?:     () => void;
  style?:       React.CSSProperties;
  /* Live policy checklist under the field. Set it on every screen that CREATES
     a password - sign-up, reset-password, settings - so the rules arrive while
     the user types instead of as one lumped error after a rejected submit.
     That failure was fixed on sign-up first and the other two screens were left
     behind, which is the whole reason this lives in the shared component now.
     Off for sign-in, where the policy is not being applied to what is typed. */
  showRules?:   boolean;
}

/* A password input with a reveal toggle. Every password field in the app uses
   this - login, reset-password, settings - so the control exists in one place
   and behaves the same everywhere.

   The toggle is a button with type="button": inside the login form a bare
   <button> defaults to type="submit", which would submit the form on click. */
export default function PasswordField({
  value, onChange, label, placeholder, autoComplete, onEnter, style, showRules,
}: Props) {
  const [shown, setShown] = useState(false);
  const { t } = useLabels();
  const id = useId();

  return (
    <div className="login-field" style={style}>
      <label className="login-field-label" htmlFor={id}>{label}</label>
      <div className="pw-field">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          className="login-email-input pw-field-input"
          placeholder={placeholder}
          value={value}
          onChange={e => onChange(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter' && onEnter) onEnter(); }}
          autoComplete={autoComplete}
        />
        <button
          type="button"
          className="pw-field-toggle"
          onClick={() => setShown(s => !s)}
          aria-label={shown ? t('LOGIN_PASSWORD_HIDE') : t('LOGIN_PASSWORD_SHOW')}
          aria-pressed={shown}
        >
          {shown ? (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 10 8 10 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
              <path d="M1 1l22 22" />
              <path d="M6.61 6.61A13.5 13.5 0 0 0 2 12s3 8 10 8a9.7 9.7 0 0 0 5.39-1.61" />
            </svg>
          ) : (
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M2 12s3-8 10-8 10 8 10 8-3 8-10 8-10-8-10-8z" />
              <circle cx="12" cy="12" r="3" />
            </svg>
          )}
        </button>
      </div>
      {/* Shown only once typing starts, so an untouched form is not a wall of
          red - but shown BEFORE submitting, which is the point.
          The tick/circle is deliberately NOT aria-hidden: it is the only
          non-colour signal of met/unmet, and hiding it would leave the state
          conveyed by colour alone. */}
      {showRules && value && (
        <div className="pw-rules">
          {PASSWORD_RULES.map(rule => {
            const met = rule.test(value);
            return (
              <div key={rule.key} className={`pw-rule${met ? ' met' : ''}`}>
                <span className="pw-rule-dot">{met ? '✓' : '○'}</span>
                {t(rule.key, { n: PASSWORD_MIN_LENGTH })}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
