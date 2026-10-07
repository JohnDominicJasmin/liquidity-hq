/* The support mailbox, in one place. Owner, 2026-10-07: it must be visibly displayed on every page, as a working mailto link (payment
   reviewers look for contact details on the Terms and the Privacy page). It is the sole mailbox on the domain's mail plan
   (see supabase/migrations/20260918b). The address is identical in every locale: a translated address is a broken address. */
export const SUPPORT_EMAIL = 'support@liquidity-hq.com';
export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
