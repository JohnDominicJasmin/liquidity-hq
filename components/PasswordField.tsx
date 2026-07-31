'use client';
import { useId, useState } from 'react';
import { useLabels } from '@/lib/labels';

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
}

/* A password input with a reveal toggle. Every password field in the app uses
   this - login, reset-password, settings - so the control exists in one place
   and behaves the same everywhere.

   The toggle is a button with type="button": inside the login form a bare
   <button> defaults to type="submit", which would submit the form on click. */
export default function PasswordField({
  value, onChange, label, placeholder, autoComplete, onEnter, style,
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
          tabIndex={-1}
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
    </div>
  );
}
