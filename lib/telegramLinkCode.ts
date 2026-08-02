// Extracted from app/api/telegram/link-code/route.ts so it's independently
// testable. Issues a one-time code the user sends to the bot to prove they
// control a Telegram chat - see supabase/migrations/20260807j.
//
// Ambiguous characters (0/O, 1/I/L) are left out so the code survives being
// read off one screen and typed on another.
import { randomBytes } from 'crypto';

export const LINK_CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const LINK_CODE_LEN = 10; // ~49 bits, single-use, 10-minute window

export function makeLinkCode(): string {
  // rejection-free: 31 symbols from a 256-value byte would bias slightly, so
  // take 5 bits at a time and discard the one dead value.
  let out = '';
  while (out.length < LINK_CODE_LEN) {
    for (const b of randomBytes(LINK_CODE_LEN)) {
      const i = b & 31;
      if (i < LINK_CODE_ALPHABET.length) out += LINK_CODE_ALPHABET[i];
      if (out.length === LINK_CODE_LEN) break;
    }
  }
  return out;
}
