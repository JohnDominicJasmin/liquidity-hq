import type { LabelKey } from '@/lib/labelKeys';

/* Mirrors the password policy configured in Supabase Auth (Dashboard →
   Authentication → Policies) on BOTH projects: minimum 12 characters, and at
   least one lowercase letter, one uppercase letter and one digit. No symbol is
   required.

   This exists because the client used to check `length < 8` in three separate
   places while the server enforced 12-plus-classes. The form accepted the
   password, the signup round-tripped, and GoTrue rejected it with its own raw
   string - "Password should contain at least one character of each:
   abcdefghijklmnopqrstuvwxyz, ABCDEFGHIJKLMNOPQRSTUVWXYZ, 0123456789." - which
   is what the user actually saw. Wrong threshold AND an error written for a
   developer, at the first screen of the product.

   If the dashboard policy is ever changed, change it here in the same sitting.
   A client that is more permissive than the server produces exactly the bug
   above; a client that is stricter silently rejects passwords the server would
   have taken. Neither failure is visible from reading this file alone. */

export const PASSWORD_MIN_LENGTH = 12;

export interface PasswordRule {
  /* A label key rather than English: this renders on the sign-up screen, which
     is translated. The rules are also never joined into a sentence for the same
     reason - comma-splicing fragments does not survive translation. Callers
     render the list, or show LOGIN_PASSWORD_POLICY_ERROR as one whole sentence. */
  key:  LabelKey;
  test: (pw: string) => boolean;
}

export const PASSWORD_RULES: PasswordRule[] = [
  { key: 'LOGIN_PASSWORD_RULE_LENGTH', test: pw => pw.length >= PASSWORD_MIN_LENGTH },
  { key: 'LOGIN_PASSWORD_RULE_LOWER',  test: pw => /[a-z]/.test(pw) },
  { key: 'LOGIN_PASSWORD_RULE_UPPER',  test: pw => /[A-Z]/.test(pw) },
  { key: 'LOGIN_PASSWORD_RULE_NUMBER', test: pw => /[0-9]/.test(pw) },
];

export function passwordMeetsPolicy(pw: string): boolean {
  return PASSWORD_RULES.every(r => r.test(pw));
}
