/**
 * IS THIS URL SAFE TO PUT IN AN `href` OR `src`?
 *
 * **An allowlist, never a blacklist.** Blocking `javascript:` and `data:` by name is the version
 * that keeps losing: the scheme set is open (`vbscript:`, `blob:`, `filesystem:`, whatever a future
 * engine adds), whitespace and control characters inside a scheme are tolerated by browsers
 * (`java\nscript:`), and percent-encoding gives another spelling of each. So this answers the only
 * question with a closed set of acceptable answers: **is the parsed protocol exactly http or
 * https?** Everything else - a different scheme, a relative string, a parse failure, a non-string -
 * is not safe, and the caller renders plain text instead of a link.
 *
 * `new URL()` does the parsing rather than a regex, so the browser's own scheme rules apply instead
 * of our guess at them. It throws on anything it cannot parse, which is the answer we want.
 *
 * WHY THIS EXISTS (#1631, found by PM 2026-11-10): `ReasoningText` in Arena matched `[label](url)`
 * in **model-written text** and rendered `<a href={url}>` with no check at all, so a `javascript:`
 * URL became a clickable link. Deep mode searches the web, so a crafted page could seed the text,
 * and the read is stored in history, so it persisted. Live since 2026-05-29 (`b96393e0`).
 *
 * Exported on its own so a test can target the predicate directly rather than through a component.
 */
export function isSafeHttpUrl(raw: unknown): boolean {
  if (typeof raw !== 'string' || raw === '') return false;
  try {
    const u = new URL(raw);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    /* Not parseable as an absolute URL - a relative path, a bare word, or a mangled scheme. None of
       those belong in an href built from text we did not write. */
    return false;
  }
}
