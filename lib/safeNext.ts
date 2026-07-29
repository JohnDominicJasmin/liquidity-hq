// Shared post-auth redirect validation for ?next=, used by the login page and
// the OAuth/magic-link callback. It lived in both files as
// `raw.startsWith('/') && !raw.startsWith('//')`, which lets a BACKSLASH
// through: `/\evil.com` starts with a single slash, so it passed - and the
// WHATWG URL parser treats `\` as `/` in the authority position, so the
// browser resolves it to `https://evil.com`. That turns the sign-in flow into
// an open redirect, which is worth more to a phisher than a normal one because
// the victim arrives having just been asked for credentials.
//
// Deliberately a regex over a path, not `new URL(raw, location.origin)`: these
// call sites also render on the server, where `location` does not exist, and a
// redirect check that throws during SSR is a worse failure than a strict one.
//
// Allows: a leading `/`, second character not `/` or `\`, and no whitespace or
// control characters anywhere. Everything else falls back to the caller's
// default. Query strings and fragments are fine - only the authority is the
// dangerous part.
const SAFE_PATH = /^\/(?![/\\])[^\s\x00-\x1f]*$/;

export function safeNextPath(raw: string | null | undefined, fallback: string): string {
  return raw && SAFE_PATH.test(raw) ? raw : fallback;
}
