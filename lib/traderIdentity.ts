/* WHO THE BUYER IS BUYING FROM, in one place (#1810 item 6).
 *
 * EU and UK distance-selling rules expect a consumer to be able to see the
 * trader's identity and a means of contact BEFORE paying - not only buried in
 * Terms. Owner's decision, 2026-10-29: NAME + COUNTRY + SUPPORT EMAIL, and
 * deliberately NO STREET ADDRESS. That was a choice between the strict reading
 * of the rule and publishing a home address, and he took the middle.
 *
 * ── THE LEGAL NAME IS A PLACEHOLDER AND MUST NOT REACH PRODUCTION ──────────
 *
 * The owner has NOT confirmed the exact legal name to print, and said
 * explicitly not to guess it from the GitHub account or the domain
 * registration. LEGAL_NAME_CONFIRMED is the switch: while it is false, every
 * surface that would print the name renders the placeholder instead, so the
 * gap is visible on the page rather than silently filled with a wrong name.
 *
 * To ship: get the exact name from the owner, put it in TRADER_LEGAL_NAME, and
 * set LEGAL_NAME_CONFIRMED to true. Nothing else changes.
 */

import { SUPPORT_EMAIL } from './supportContact.ts';

/** Flip to true in the SAME commit that puts the owner's confirmed legal name above. */
export const LEGAL_NAME_CONFIRMED = false;

/** The registered/legal name of the person operating LiquidityHQ. Unconfirmed - see the file header. */
export const TRADER_LEGAL_NAME = 'PLACEHOLDER - LEGAL NAME NOT YET CONFIRMED';

/* Already stated in the Privacy Policy ("LiquidityHQ is operated from the Philippines"),
   so this is the same fact in the one place a buyer looks for it, not a new claim. */
export const TRADER_COUNTRY = 'the Philippines';

export const TRADER_CONTACT_EMAIL = SUPPORT_EMAIL;
